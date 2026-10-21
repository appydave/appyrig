import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FLEET_EVENTS,
  type FleetMachine,
  type FleetUpdate,
  type QueueItem,
} from '@appydave/shared';
import App from '../../app/App.js';
import { listRigs } from '../../domain/fleet/views.js';
import type { FleetSocket } from '../../domain/fleet/useFleet.js';
import { fleetMachine, snapshot, update } from '../../test/fleetFixtures.js';
import type { FrozenFile } from '../../app/frozen/frozenSocket.js';
import type { PageContext } from '../../app/types.js';
import { GraphScreen, page, SHOW_STOPPED_KEY } from './index.js';
import {
  buildGraph,
  crossRigEdges,
  endpointGroup,
  looseKey,
  pairEdges,
} from '../../domain/graph/model.js';
import { routeLines } from '../../domain/graph/lineRoute.js';
import { relativeWidthLines } from '../../kit/index.js';
import RigBox, { lastWords } from './RigBox.js';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    attachCustomKeyEventHandler() {}
    loadAddon() {}
    open() {}
    reset() {}
    write() {}
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class {} }));

const NOW = Date.parse('2026-10-10T08:00:00.000Z');

const q = (over: Partial<QueueItem>): QueueItem => ({
  id: over.id ?? 'q1',
  source: 'a',
  destination: 'b',
  state: 'done',
  priority: null,
  tags: [],
  summary: null,
  createdAt: '2026-10-10T07:00:00.000Z',
  updatedAt: '2026-10-10T07:05:00.000Z',
  ...over,
});

const withQueue = (fm: FleetMachine, queue: QueueItem[]): FleetMachine => ({
  ...fm,
  snapshot: { ...fm.snapshot, queue },
});

/** Roamy (kernel + starter + a loose openrig-orch) and the M2, with traffic between rigs. */
function crossFleet(): FleetMachine[] {
  const roamy = withQueue(fleetMachine(snapshot('roamy')), [
    q({ id: 'r1', source: 'dev-build@starter', destination: 'advisor-lead@kernel' }),
    q({ id: 'r2', source: 'dev-build@starter', destination: 'advisor-lead@kernel' }),
    q({
      id: 'r3',
      source: 'dev-build@starter',
      destination: 'advisor-lead@kernel',
      state: 'pending',
      createdAt: '2026-10-10T07:50:00.000Z',
    }),
    q({ id: 'r4', source: 'queue-worker@kernel', destination: 'dev-review@starter' }),
    q({ id: 'r5', source: 'openrig-orch', destination: 'dev-build@starter' }),
    q({ id: 'r6', source: 'openrig-orch', destination: 'dev-build@starter' }),
    // in-rig, David's mailbox, and a name no machine reports: none is a cross-rig line
    q({ id: 'r7', source: 'dev-build@starter', destination: 'dev-review@starter' }),
    q({ id: 'r8', source: 'dev-build@starter', destination: 'human@kernel', state: 'pending' }),
    q({ id: 'r9', source: 'ghost@gone-rig', destination: 'dev-build@starter' }),
    // the same row as the M2's m2: read first on the M2, so it counts once
    q({ id: 'm2', source: 'orch-boss@control', destination: 'dev-build@starter' }),
  ]);
  const m2 = withQueue(fleetMachine(snapshot('m2')), [
    // `gone-orch` is no seat on Roamy (a session that ended): the line must still reach Roamy's column
    q({ id: 'm1', source: 'orch-lead@factory-claude', destination: 'gone-orch@roamy' }),
    q({ id: 'm2', source: 'orch-boss@control', destination: 'dev-build@starter' }),
  ]);
  return [m2, roamy];
}

type Handler = (...args: unknown[]) => void;
function spySocket() {
  const handlers = new Map<string, Set<Handler>>();
  const sent: string[] = [];
  const s = {
    connected: true,
    on(ev: string, h: Handler) {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev)!.add(h);
      return s;
    },
    off(ev: string, h: Handler) {
      handlers.get(ev)?.delete(h);
      return s;
    },
    emit: vi.fn((ev: string) => sent.push(ev)),
    timeout: vi.fn(() => ({
      emit: (_ev: string, req: { verb: string }) => sent.push(req.verb),
    })),
  };
  const fire = (ev: string, ...args: unknown[]) =>
    act(() => handlers.get(ev)?.forEach((h) => h(...args)));
  return { socket: s as unknown as FleetSocket, fire, sent };
}

/** A socket whose verbs get an answer (the hub's), so a hover card's ssh lookup completes. */
function ctxFor(machines: FleetMachine[], over: Partial<PageContext> = {}): PageContext {
  const spy = spySocket();
  return {
    machines,
    allMachines: machines,
    rigs: listRigs(machines),
    activeRig: null,
    chooseRig: vi.fn(),
    pickedRig: null,
    now: NOW,
    link: 'connected',
    hubConnected: true,
    received: true,
    getSocket: () => spy.socket,
    keys: true,
    agentKey: null,
    openAgentPage: vi.fn(),
    openAgentPanel: vi.fn(),
    closeAgentPanel: vi.fn(),
    agentPanel: null,
    focusNonce: 0,
    // Left unset on purpose: the Graph then keeps the open set itself (these tests render a static
    // ctx). The nav-owned path has its own test below, which passes both.
    openRigs: undefined as unknown as string[],
    setOpenRigs: undefined as unknown as (keys: string[]) => void,
    onOpenFiles: vi.fn(),
    goTo: vi.fn(),
    ...over,
  };
}

const Graph = page.component;
const rigKeys = () => screen.getAllByTestId('g2-rig').map((r) => r.dataset.rigKey);
const frame = (key: string) =>
  screen.getAllByTestId('g2-rig').find((r) => r.dataset.rigKey === key)!;

function busy(): { machines: FleetMachine[]; now: number } {
  const file = JSON.parse(
    readFileSync(
      path.resolve(__dirname, '../../../../test/fixtures/frozen/busy-2026-10-18.json'),
      'utf8'
    )
  ) as FrozenFile;
  return { machines: (file.update as FleetUpdate).machines, now: Date.parse(file.recordedAt) };
}

beforeEach(() => {
  try {
    localStorage.clear();
    // most tests look at stopped rigs: show them unless a test says otherwise
    localStorage.setItem(SHOW_STOPPED_KEY, '1');
  } catch {
    /* ignore */
  }
  history.replaceState(null, '', '/');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const css = () => readFileSync(path.resolve(__dirname, 'graph.css'), 'utf8');

describe('Graph model (the overview: one box per rig)', () => {
  it('counts traffic between rigs from every queue, once per row, and not inside a rig', () => {
    const machines = crossFleet();
    const { edges, unplaced } = crossRigEdges(machines, NOW);
    const byPair = Object.fromEntries(edges.map((e) => [`${e.from}→${e.to}`, e]));
    expect(Object.keys(byPair).sort()).toEqual(
      [
        'roamy:starter→roamy:kernel',
        'roamy:kernel→roamy:starter',
        `${looseKey('roamy')}→roamy:starter`,
        `m2:factory-claude→${looseKey('roamy')}`,
        'm2:control→m2:starter',
      ].sort()
    );
    expect(byPair['roamy:starter→roamy:kernel']).toMatchObject({ count: 3, open: 1, stale: 0 });
    expect(unplaced).toEqual({
      count: 1,
      names: [{ name: 'gone-rig', count: 1, kind: 'rig' }],
      byKind: { machine: 0, rig: 1 },
    });
  });

  it('one line per rig PAIR: both directions together, the split kept', () => {
    const { edges } = crossRigEdges(crossFleet(), NOW);
    const pairs = pairEdges(edges);
    expect(pairs).toHaveLength(4); // 5 directed edges, two of them one pair
    const both = pairs.find((p) => p.a === 'roamy:kernel' && p.b === 'roamy:starter')!;
    expect(both).toMatchObject({ total: 4, aToB: 1, bToA: 3, waiting: 1 });
    expect(both.items.map((i) => i.id)).toEqual(
      [...both.items].sort((x, y) => x.createdAt.localeCompare(y.createdAt)).map((i) => i.id)
    );
  });

  it('places an endpoint on its rig, a machine’s loose sessions, or nowhere', () => {
    const [m2, roamy] = crossFleet() as [FleetMachine, FleetMachine];
    const all = [m2, roamy];
    expect(endpointGroup('dev-build@starter', roamy, all)).toBe('roamy:starter');
    expect(endpointGroup('openrig-orch@roamy', m2, all)).toBe(looseKey('roamy'));
    expect(endpointGroup('gone-orch@roamy', m2, all)).toBe(looseKey('roamy'));
    expect(endpointGroup('human@kernel', roamy, all)).toBeNull();
    expect(endpointGroup('ghost@gone-rig', roamy, all)).toBeNull();
  });

  it('builds a box per rig from the busy snapshot (23 rigs, 91 agents) with names, flags and a last handoff', () => {
    const { machines, now } = busy();
    const g = buildGraph(machines, now);
    expect(g.machines.map((m) => m.label)).toEqual(['M2', 'M4', 'Roamy']);
    expect(g.totals).toMatchObject({ rigs: 23, agents: 91 });
    for (const r of g.machines.flatMap((m) => m.rigs)) {
      expect(r.agentNames).toHaveLength(r.agents);
      expect(r).not.toHaveProperty('pods'); // no agents drawn, no in-rig lines
      expect(r).not.toHaveProperty('edges');
    }
    const withLast = g.machines.flatMap((m) => m.rigs).filter((r) => r.last);
    expect(withLast.length).toBeGreaterThan(0);
    expect(lastWords(withLast[0]!, now)).toMatch(/ → .* · \d+[smhd] ago$/);
  });

  it('recovers lines from sessions that are no seat any more, as pairs, on the busy snapshot', () => {
    const { machines, now } = busy();
    const g = buildGraph(machines, now);
    const pair = (x: string, y: string) =>
      g.pairs.find((p) => (p.a === x && p.b === y) || (p.a === y && p.b === x));
    expect(pair(looseKey('roamy'), 'm2:flicut-ab')?.total).toBe(3);
    expect(pair(looseKey('m4'), 'm2:d09-crew')?.total).toBe(4);
    expect(g.unplaced.byKind.machine).toBe(0);
  });

  it('an unchanged machine is not rebuilt; only the machine that changed is', () => {
    const [m2, roamy] = crossFleet() as [FleetMachine, FleetMachine];
    const first = buildGraph([m2, roamy], NOW);
    const second = buildGraph([m2, { ...roamy, snapshot: { ...roamy.snapshot } }], NOW);
    const rigsOf = (g: ReturnType<typeof buildGraph>, id: string) =>
      g.machines.find((m) => m.id === id)!.rigs;
    rigsOf(first, 'm2').forEach((r, i) => expect(rigsOf(second, 'm2')[i]).toBe(r));
    rigsOf(first, 'roamy').forEach((r, i) => expect(rigsOf(second, 'roamy')[i]).toEqual(r));
    expect((RigBox as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });
});

describe('Graph page', () => {
  it('renders every rig as one box, grouped by machine, with no agent cards or in-rig lines', () => {
    const { machines, now } = busy();
    render(<Graph ctx={ctxFor(machines, { now })} />);
    expect(screen.getAllByTestId('g2-machine')).toHaveLength(3);
    const keys = rigKeys();
    expect(keys.filter((k) => !k!.endsWith('~loose'))).toHaveLength(23);
    expect(keys.filter((k) => k!.endsWith('~loose'))).toHaveLength(3);
    expect(screen.queryAllByTestId('g2-card')).toHaveLength(0);
    expect(screen.queryAllByTestId('g2-edge')).toHaveLength(0);
    expect(screen.getByTestId('g2-caption')).toHaveTextContent('23 rigs');
    expect(screen.getByTestId('g2-caption')).toHaveTextContent('91 agents');
  });

  it('a box says its name, machine, state, agents, flag and last handoff in words', () => {
    render(<Graph ctx={ctxFor(crossFleet())} />);
    const starter = frame('roamy:starter');
    expect(within(starter).getByTestId('g2-rig-name')).toHaveTextContent('starter');
    expect(starter).toHaveTextContent('Roamy');
    expect(starter.querySelector('.rig-state')).not.toBeNull();
    expect(within(starter).getByTestId('g2-rig-counts')).toHaveTextContent('2 agents');
    expect(within(starter).getByTestId('g2-rig-cross')).toHaveTextContent('↗3 ↙3');
    expect(within(starter).getByTestId('g2-last').textContent).toMatch(/ → .* ago$/);
    expect(within(frame('m2:kernel')).getByTestId('g2-last')).toHaveTextContent('No handoffs yet');
    expect(within(frame(looseKey('roamy'))).getByTestId('g2-last')).toHaveTextContent(
      'belong to no rig'
    );
  });

  it('opening a box shows its inside in place; Expand all / Collapse all; the loose group lists names', () => {
    render(<Graph ctx={ctxFor(crossFleet())} />);
    const box = frame('m2:kernel');
    expect(within(box).queryByTestId('g2-inside')).toBeNull();
    fireEvent.click(within(box).getByTestId('g2-rig-toggle'));
    const inside = within(box).getByTestId('g2-inside');
    expect(within(inside).getAllByTestId('g2-pod').length).toBeGreaterThan(0);
    expect(within(inside).getAllByTestId('g2-agent-card').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('g2-collapse-all'));
    expect(screen.queryAllByTestId('g2-inside')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('g2-expand-all'));
    // several rigs open at once
    expect(screen.getAllByTestId('g2-inside').length).toBeGreaterThan(1);
    // a machine's no-rig group still lists its names on one line
    expect(screen.getAllByTestId('g2-agent-names').length).toBeGreaterThan(0);
  });

  it('opening a box chooses the rig and stays on the Graph (no page change)', () => {
    const ctx = ctxFor(crossFleet());
    render(<Graph ctx={ctx} />);
    fireEvent.click(within(frame('roamy:kernel')).getByTestId('g2-rig-name'));
    expect(ctx.chooseRig).toHaveBeenCalledWith('roamy:kernel');
    expect(ctx.goTo).not.toHaveBeenCalled();
    expect(within(frame('roamy:kernel')).getByTestId('g2-inside')).toBeInTheDocument();
    // the box body opens it too; closing it does not choose again
    fireEvent.click(frame('roamy:starter'));
    expect(ctx.chooseRig).toHaveBeenLastCalledWith('roamy:starter');
    const chosen = vi.mocked(ctx.chooseRig).mock.calls.length;
    fireEvent.click(within(frame('roamy:starter')).getByTestId('g2-rig-toggle'));
    expect(vi.mocked(ctx.chooseRig).mock.calls.length).toBe(chosen);
    expect(within(frame('roamy:starter')).queryByTestId('g2-inside')).toBeNull();
    // the machine's no-rig group only folds the agent list
    fireEvent.click(within(frame(looseKey('roamy'))).getByTestId('g2-rig-name'));
    expect(ctx.chooseRig).toHaveBeenCalledTimes(chosen);
  });

  it('shows the lines between rigs, one per pair, thin and faint with the count both ways; none says so in one line', () => {
    const { unmount } = render(<Graph ctx={ctxFor(crossFleet())} />);
    const lines = screen.getAllByTestId('g2-cross');
    expect(lines).toHaveLength(4);
    // the kit's quiet style: absolute width steps (these counts are all under 10: thin), faint by default
    for (const g of lines) {
      const w = Number(g.querySelector('path.hl-line')!.getAttribute('stroke-width'));
      expect(w).toBeLessThanOrEqual(3);
      expect(w).toBe(Number(g.dataset.count) < 10 ? 1.5 : w);
      expect(g).toHaveAttribute('data-state', 'faint');
      expect(g.querySelector('.hl-line')).toHaveClass('hl-faint');
    }
    // one line per pair, labelled with both directions
    const labels = screen
      .getAllByTestId('g2-cross-label')
      .map((l) => l.querySelector('.g2-label-text')!.textContent);
    expect(labels).toContain('1 ⇄ 3');
    expect(screen.getByTestId('hl-explain')).toBeInTheDocument();
    expect(screen.getByTestId('g2-caption')).toHaveTextContent('4 lines between rigs');
    expect(screen.getByTestId('g2-unplaced')).toHaveTextContent('+1 not drawn');
    expect(screen.queryByTestId('g2-no-lines')).toBeNull();
    unmount();
    const quiet = crossFleet().map((m) => withQueue(m, []));
    render(<Graph ctx={ctxFor(quiet)} />);
    expect(screen.getByTestId('g2-no-lines')).toHaveTextContent(
      'No handoffs between the rigs shown'
    );
    expect(screen.queryAllByTestId('g2-cross')).toHaveLength(0);
  });

  it('hovering a line lights it and its two boxes and dims the rest; so does a box; focus does too', () => {
    render(<Graph ctx={ctxFor(crossFleet())} />);
    const line = screen
      .getAllByTestId('g2-cross')
      .find((g) => g.dataset.from === 'roamy:kernel' && g.dataset.to === 'roamy:starter')!;
    fireEvent.pointerEnter(line);
    const lines = screen.getAllByTestId('g2-cross');
    expect(lines.filter((g) => g.dataset.state === 'lit')).toEqual([line]);
    expect(lines.filter((g) => g.dataset.state === 'dimmed')).toHaveLength(lines.length - 1);
    expect(frame('roamy:starter')).toHaveAttribute('data-trace');
    expect(frame('roamy:kernel')).toHaveAttribute('data-trace');
    expect(frame(looseKey('roamy'))).not.toHaveAttribute('data-trace');
    expect(screen.getByTestId('g2-line-card')).toHaveTextContent('4 handoffs between rigs');
    fireEvent.pointerLeave(line);
    expect(screen.queryByTestId('g2-line-card')).toBeNull();
    // a box lights the lines that touch it
    fireEvent.pointerEnter(frame('roamy:kernel'));
    for (const g of screen.getAllByTestId('g2-cross')) {
      const touches = g.dataset.from === 'roamy:kernel' || g.dataset.to === 'roamy:kernel';
      expect(g.dataset.state).toBe(touches ? 'lit' : 'dimmed');
    }
    fireEvent.pointerLeave(frame('roamy:kernel'));
    fireEvent.focus(line);
    expect(line).toHaveAttribute('data-state', 'lit');
    fireEvent.click(line);
    expect(screen.getByTestId('g2-drawer')).toBeInTheDocument();
    expect(screen.getAllByTestId('g2-drawer-item').length).toBe(4);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('g2-drawer')).toBeNull();
  });

  it('a line is read from the current fleet: an item closing (same count) removes the waiting badge', () => {
    vi.useFakeTimers();
    const before = crossFleet();
    const { rerender } = render(<Graph ctx={ctxFor(before)} />);
    const waiting = () => {
      const lab = screen
        .getAllByTestId('g2-cross-label')
        .find((l) => l.textContent?.startsWith('1 ⇄ 3'));
      return lab?.querySelector('[data-testid="hl-waiting"]') ?? null;
    };
    expect(waiting()).not.toBeNull(); // r3 is still pending: an amber badge, not a line style
    const roamy = before[1]!;
    const after = [
      before[0]!,
      withQueue(
        roamy,
        roamy.snapshot.queue.map((x) => (x.id === 'r3' ? { ...x, state: 'done' } : x))
      ),
    ];
    rerender(<Graph ctx={ctxFor(after)} />);
    act(() => vi.advanceTimersByTime(3100));
    expect(waiting()).toBeNull();
  });

  it('the rebuild is throttled with a leading edge: the first update lands at once, later ones wait ~3 s', () => {
    vi.useFakeTimers();
    const a = crossFleet();
    const { rerender } = render(<Graph ctx={ctxFor(a)} />);
    const caption = () => screen.getByTestId('g2-caption').textContent;
    const mk = (n: number) => [a[0]!, withQueue(a[1]!, a[1]!.snapshot.queue.slice(0, n))];
    const c0 = caption();
    rerender(<Graph ctx={ctxFor(mk(4))} />);
    const c1 = caption();
    expect(c1).not.toBe(c0);
    rerender(<Graph ctx={ctxFor(mk(1))} />);
    expect(caption()).toBe(c1);
    act(() => vi.advanceTimersByTime(3100));
    expect(caption()).not.toBe(c1);
  });

  it('stopped rigs are hidden by default; Show stopped (N) brings them back and is remembered', () => {
    localStorage.removeItem(SHOW_STOPPED_KEY);
    const { machines, now } = busy();
    const total = buildGraph(machines, now).machines.flatMap((m) => m.rigs);
    const stopped = total.filter((r) => r.ref!.status !== 'running').length;
    expect(stopped).toBeGreaterThan(0);
    const { unmount } = render(<Graph ctx={ctxFor(machines, { now })} />);
    const rigs = () => rigKeys().filter((k) => !k!.endsWith('~loose'));
    expect(rigs()).toHaveLength(total.length - stopped);
    const btn = screen.getByTestId('g2-show-stopped');
    expect(btn).toHaveTextContent(`Show stopped (${stopped})`);
    fireEvent.click(btn);
    expect(rigs()).toHaveLength(total.length);
    expect(localStorage.getItem(SHOW_STOPPED_KEY)).toBe('1');
    unmount();
    render(<Graph ctx={ctxFor(machines, { now })} />);
    expect(rigKeys().filter((k) => !k!.endsWith('~loose'))).toHaveLength(total.length);
    fireEvent.click(screen.getByTestId('g2-show-stopped'));
    expect(localStorage.getItem(SHOW_STOPPED_KEY)).toBe('0');
  });

  it('a line to a hidden stopped rig is counted, not dropped; the picked rig stays shown', () => {
    localStorage.removeItem(SHOW_STOPPED_KEY);
    const machines = crossFleet();
    const { unmount } = render(<Graph ctx={ctxFor(machines)} />);
    expect(screen.getByTestId('g2-hidden-lines')).toHaveTextContent('to hidden stopped rig');
    fireEvent.click(screen.getByTestId('g2-show-stopped'));
    expect(screen.queryByTestId('g2-hidden-lines')).toBeNull();
    unmount();
    localStorage.removeItem(SHOW_STOPPED_KEY);
    const picked = listRigs(machines).find((r) => r.key === 'm2:kernel')!;
    render(<Graph ctx={ctxFor(machines, { activeRig: picked })} />);
    expect(rigKeys()).toContain('m2:kernel');
  });

  it('Needs me / Failing filters keep only matching rigs', () => {
    const blocked = fleetMachine(snapshot('roamy--blocked'));
    const failing = {
      ...blocked,
      snapshot: {
        ...blocked.snapshot,
        rigs: blocked.snapshot.rigs.map((r) => ({ ...r, attentionCount: 0 })),
        seats: blocked.snapshot.seats.map((s) =>
          s.id === 'queue-worker@kernel' ? { ...s, status: 'stopped' as const } : s
        ),
      },
    };
    render(<Graph ctx={ctxFor([fleetMachine(snapshot('m2')), failing])} />);
    fireEvent.click(screen.getByTestId('g2-filter-needsMe'));
    expect(rigKeys()).toEqual(['roamy:starter']);
    expect(within(frame('roamy:starter')).getByTestId('g2-rig-counts')).toHaveTextContent('▲ 1');
    fireEvent.click(screen.getByTestId('g2-filter-failing'));
    expect(rigKeys()).toEqual(['roamy:kernel']);
    fireEvent.click(screen.getByTestId('g2-filter-failing'));
    expect(rigKeys().length).toBeGreaterThan(2);
  });

  it('Start / Restore / Launch are on the ⋯ menu, send nothing, and the box rises above its neighbours', () => {
    vi.useFakeTimers();
    const spy = spySocket();
    render(<Graph ctx={ctxFor(crossFleet(), { getSocket: () => spy.socket })} />);
    const box = frame('m2:kernel');
    expect(within(box).queryByTestId('g2-fake-start')).toBeNull();
    expect(box).not.toHaveAttribute('data-menu-open');
    fireEvent.click(within(box).getByTestId('g2-rig-menu'));
    expect(box).toHaveAttribute('data-menu-open', 'true');
    fireEvent.click(within(box).getByTestId('g2-fake-start'));
    expect(screen.getByTestId('g2-fake-dialog')).toHaveTextContent('Start kernel on the M2?');
    expect(
      within(screen.getByTestId('g2-fake-dialog')).getByTestId('mock-mark')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('g2-fake-yes'));
    act(() => vi.advanceTimersByTime(1300));
    expect(screen.getByTestId('g2-toast')).toHaveTextContent('kernel started on the M2 (pretend)');
    expect(box).not.toHaveAttribute('data-menu-open'); // the menu closed itself
    // Start is off on a running rig; Escape closes the menu
    fireEvent.click(within(frame('roamy:starter')).getByTestId('g2-rig-menu'));
    expect(within(frame('roamy:starter')).getByTestId('g2-fake-start')).toBeDisabled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(within(frame('roamy:starter')).queryByTestId('g2-fake-start')).toBeNull();
    expect(spy.sent).toEqual([]);
  });

  it('one mock note, behind the page’s ⋯ menu; a box’s own badge sits with its ⋯ button and shows only on hover, focus or open', () => {
    render(<Graph ctx={ctxFor(crossFleet())} />);
    expect(screen.getByTestId('g2-mock-note')).toHaveTextContent('controls on this page are mocks');
    expect(screen.getAllByTestId('mock-note')).toHaveLength(1);
    for (const m of screen.getAllByTestId('mock-mark'))
      expect(m.closest('.g2-menu-wrap, .ar-mock-menu')).not.toBeNull();
    expect(css()).toMatch(/\.g2-menu-wrap \.ar-mock-mark \{\s*display: none;/);
    expect(css()).toMatch(/\.g2-menu-wrap:hover \.ar-mock-mark/);
    expect(css()).toMatch(/\.g2-menu-wrap\[data-open\] \.ar-mock-mark/);
  });

  it('the layout wraps instead of using fixed wide columns, so every machine fits at 1440 px', () => {
    const c = css();
    expect(c).toMatch(
      /\.g2-machines \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 320px\), 1fr\)\)/s
    );
    expect(c).toMatch(
      /\.g2-boxes \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(190px, 1fr\)\)/s
    );
    expect(c).not.toMatch(/\b4[0-9]{2}px\b[^;]*;\s*\n\s*display: flex/);
    expect(c).not.toMatch(/overflow-x:\s*(auto|scroll)/);
    expect(c).not.toContain('prefers-color-scheme');
  });
});

describe('Graph lines use the shared kit', () => {
  it('on the busy snapshot no line is wider than 3 px, the width follows the count steps, and there is no glow', () => {
    const { machines, now } = busy();
    render(<Graph ctx={ctxFor(machines, { now })} />);
    const lines = screen.getAllByTestId('g2-cross');
    expect(lines.length).toBeGreaterThan(3);
    for (const g of lines) {
      const w = Number(g.querySelector('path.hl-line')!.getAttribute('stroke-width'));
      const n = Number(g.dataset.count);
      expect(w).toBeLessThanOrEqual(3);
      expect(w).toBe(n >= 50 ? 3 : n >= 10 ? 2.2 : 1.5);
    }
    expect(document.querySelector('.g2-glow')).toBeNull();
    expect(document.querySelectorAll('[stroke-dasharray]').length).toBe(0); // dotted is for planned only
  });

  it('no Graph source sizes a stroke by a share of the busiest pair (the kit guard, run on this lane)', () => {
    for (const f of [
      'index.tsx',
      'RigBox.tsx',
      '../../domain/graph/lineRoute.ts',
      '../../domain/graph/model.ts',
    ]) {
      expect(relativeWidthLines(readFileSync(path.resolve(__dirname, f), 'utf8')), f).toEqual([]);
    }
    expect(css()).not.toMatch(/glow/);
  });
});

describe('Graph line routing', () => {
  const box = (x: number, y: number, w = 200, h = 90) => ({ x, y, w, h });
  const pair = (a: string, b: string, count = 1) => ({
    a,
    b,
    aToB: count,
    bToA: 0,
    total: count,
    waiting: 0,
    leftOpen: 0,
    planned: false,
    items: [],
  });
  const start = (d: string) =>
    /^M([\d.]+),([\d.]+)/.exec(d)!.slice(1).map(Number) as [number, number];

  it('boxes side by side join right to left; stacked boxes join bottom to top', () => {
    const boxes: Record<string, ReturnType<typeof box>> = {
      a: box(0, 0),
      b: box(300, 0),
      c: box(0, 200),
    };
    const out = routeLines([pair('a', 'b'), pair('a', 'c')], (k) => boxes[k] ?? null);
    const [ax, ay] = start(out[0]!.d);
    expect(ax).toBe(200); // a's right edge
    expect(ay).toBeGreaterThan(0);
    expect(ay).toBeLessThan(90);
    const [cx, cy] = start(out[1]!.d);
    expect(cy).toBe(90); // a's bottom edge
    expect(cx).toBeGreaterThan(0);
    expect(cx).toBeLessThan(200);
  });

  it('lines meeting one box side leave from different points, and their labels do not sit on each other', () => {
    const boxes: Record<string, ReturnType<typeof box>> = {
      a: box(0, 0),
      b: box(300, 0),
      c: box(300, 120),
      d: box(300, 240),
    };
    const out = routeLines(
      [pair('a', 'b'), pair('a', 'c'), pair('a', 'd')],
      (k) => boxes[k] ?? null
    );
    const ys = out.map((l) => Math.round(start(l.d)[1]));
    expect(new Set(ys).size).toBe(3);
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++)
        expect(
          Math.abs(out[i]!.lx - out[j]!.lx) >= 28 || Math.abs(out[i]!.ly - out[j]!.ly) >= 18
        ).toBe(true);
  });

  it('a pair with a box that is not on the page is skipped, not drawn to nowhere', () => {
    expect(routeLines([pair('a', 'zzz')], (k) => (k === 'a' ? box(0, 0) : null))).toEqual([]);
  });
});

describe('Graph in the app', () => {
  const live = () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const spy = spySocket();
    history.replaceState(null, '', '/');
    render(<App getSocket={() => spy.socket} />);
    spy.fire(
      FLEET_EVENTS.UPDATE,
      update([fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))])
    );
  };

  it('Graph is a page in the Fleet group', () => {
    live();
    expect(screen.getByTestId('ar-page-graph')).toHaveTextContent('Graph');
    fireEvent.click(screen.getByTestId('ar-page-graph'));
    expect(screen.getByTestId('ar-graph')).toBeInTheDocument();
  });

  it('opening a rig box keeps the Graph; "Open in Rig Map" goes to the Rig Map page on that rig', () => {
    live();
    fireEvent.click(screen.getByTestId('ar-page-graph'));
    fireEvent.click(within(frame('roamy:starter')).getByTestId('g2-rig-name'));
    expect(screen.getByTestId('ar-graph')).toBeInTheDocument();
    expect(within(frame('roamy:starter')).getByTestId('g2-inside')).toBeInTheDocument();
    fireEvent.click(within(frame('roamy:starter')).getByTestId('g2-rig-menu'));
    fireEvent.click(screen.getByTestId('g2-open-map'));
    expect(screen.queryByTestId('ar-graph')).toBeNull();
    expect(screen.getByTestId('ar-rigmap')).toBeInTheDocument();
    expect(screen.getByTestId('rm-body')).toHaveAttribute('data-rig-key', 'roamy:starter');
    expect(screen.getAllByTestId('g2-inside')).toHaveLength(1);
    // the rig it opened on is the chosen rig, in the address too
    expect(new URLSearchParams(location.search).get('rig')).toBe('starter@roamy');
  });
});

describe('Graph: open rigs, zoom, people', () => {
  const openRig = (key: string) => {
    fireEvent.click(within(frame(key)).getByTestId('g2-rig-toggle'));
    return within(frame(key)).getByTestId('g2-inside');
  };

  it('a rig is closed (a box) or open (full cards plus lines): there is no zoom, no Fit', () => {
    render(<Graph ctx={ctxFor(crossFleet())} />);
    expect(screen.queryByTestId('g2-zoom')).toBeNull();
    expect(screen.queryByTestId('g2-zoom-in')).toBeNull();
    expect(screen.queryByTestId('g2-zoom-out')).toBeNull();
    expect(screen.queryByTestId('g2-fit')).toBeNull();
    expect(screen.getByTestId('g2-canvas')).not.toHaveAttribute('data-zoom');
    expect(screen.queryAllByTestId('g2-inside')).toHaveLength(0);
    const inside = openRig('roamy:starter');
    expect(within(inside).getAllByTestId('g2-agent-card')).toHaveLength(2);
    expect(within(inside).queryAllByTestId('g2-agent-name')).toHaveLength(0);
    expect(within(inside).getAllByTestId('g2-pod-label')[0]).toHaveTextContent(/dev\s*2/);
    // closing it puts the box back
    fireEvent.click(within(frame('roamy:starter')).getByTestId('g2-rig-toggle'));
    expect(within(frame('roamy:starter')).queryByTestId('g2-inside')).toBeNull();
    // Expand all opens every shown rig; Collapse all closes them
    fireEvent.click(screen.getByTestId('g2-expand-all'));
    expect(screen.getAllByTestId('g2-inside').length).toBeGreaterThan(1);
    fireEvent.click(screen.getByTestId('g2-collapse-all'));
    expect(screen.queryAllByTestId('g2-inside')).toHaveLength(0);
  });

  it('a one-line key explains the box styles, and the styles follow one rule', () => {
    render(<Graph ctx={ctxFor(crossFleet())} />);
    const key = screen.getByTestId('g2-key');
    expect(key).toHaveTextContent('running');
    expect(key).toHaveTextContent('stopped');
    expect(key).toHaveTextContent('frosted');
    expect(key).toHaveTextContent('needs you');
    expect(key).toHaveTextContent('machine asleep');
    expect(key).toHaveTextContent('no rig');
    expect(key).toHaveTextContent('plain tmux');
    expect(within(screen.getByTestId('g2-sticky')).getByTestId('g2-key')).toBe(key);
    const c = css();
    // stopped = frosted (pale fill, dashed edge, dimmed text); no rig = its own dotted group
    expect(c).toMatch(
      /\.g2-box\[data-state='stopped'\] \{[^}]*border-style: dashed;[^}]*background: var\(--ar-surface\);/s
    );
    expect(c).toMatch(/\.g2-box\[data-loose\] \{[^}]*border-style: dotted;/s);
    expect(c).toMatch(/\.g2-box\[data-state='attention'\] \{[^}]*--ar-blocked/s);
  });

  it('the stuck chip says how many seats have work waiting over 2 h, in words', () => {
    const rig = {
      key: 'm2:x',
      machineId: 'm2',
      machineLabel: 'M2',
      name: 'x',
      ref: { status: 'running' },
      state: 'idle',
      agents: 3,
      active: 0,
      agentNames: [],
      flags: { needsMe: 0, stuck: 2, failing: 0 },
      last: null,
      crossOut: 0,
      crossIn: 0,
    } as never;
    render(
      <RigBox rig={rig} now={Date.now()} expanded={false} onToggle={() => {}} onTrace={() => {}} />
    );
    const chip = document.querySelector('[data-flag="stuck"]')!;
    expect(chip).toHaveTextContent('2 waiting');
    expect(chip).toHaveAttribute('title', '2 seats with work waiting over 2 h');
  });

  it('agents are fixed-size compact terminal cards; one quiet line per pair; self-handoffs are text', () => {
    const ctx = ctxFor(crossFleet());
    render(<Graph ctx={ctx} />);
    const inside = openRig('roamy:starter');
    const cards = within(inside).getAllByTestId('g2-agent-card');
    for (const c of cards) expect(c).toHaveAttribute('data-size', 'compact');
    const labels = within(inside).getAllByTestId('g2-inside-label');
    expect(labels).toHaveLength(1);
    expect(labels[0]).toHaveTextContent(/^(\d+ ⇄ \d+|\d+ →|← \d+)$/);
    const lines = within(inside).getAllByTestId('g2-inside-line');
    expect(lines.every((g) => g.dataset.state === 'faint')).toBe(true);
    // hovering a card lights its own lines
    fireEvent.pointerEnter(cards[0]!.closest('.g2-cell')!);
    expect(within(inside).getAllByTestId('g2-inside-line')[0]).toHaveAttribute('data-state', 'lit');
    expect(within(inside).getByTestId('seat-detail')).toBeInTheDocument();
    // its hover card opens that agent's documents in the Agent panel, on top of this page
    fireEvent.click(within(inside).getByTestId('g2-hover-docs'));
    expect(ctx.openAgentPanel).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'documents', seatKey: expect.stringMatching(/@starter$/) })
    );
    expect(ctx.goTo).not.toHaveBeenCalled();
  });

  it('self-handoffs are text under the card, never a loop', () => {
    render(<Graph ctx={ctxFor([fleetMachine(snapshot('roamy--blocked'))])} />);
    const inside = openRig('roamy:starter');
    expect(within(inside).getByTestId('g2-self')).toHaveTextContent('↺ 3 to itself');
  });

  it('a person is a dark human card with badges, not a NOT PLACED lane or rail', () => {
    render(<Graph ctx={ctxFor(crossFleet())} />);
    const inside = openRig('roamy:kernel');
    const people = within(inside).getByTestId('g2-humans');
    expect(within(people).getByTestId('g2-human-card')).toHaveTextContent('operator-human');
    expect(inside.textContent).not.toMatch(/not placed|unplaced/i);
    expect(document.querySelector('.rigmap-edges, [data-testid="rig-map-lane"]')).toBeNull();
  });

  it('the open rig has a status line: state, last handoff, waiting on you, Details', () => {
    const ctx = ctxFor(crossFleet());
    render(<Graph ctx={ctx} />);
    const inside = openRig('roamy:starter');
    const status = within(inside).getByTestId('g2-status');
    expect(status).toHaveTextContent(/running|idle|working|attention/i);
    // one header line: the box's machine and agent counts are in the status line
    expect(within(status).getByTestId('g2-status-meta')).toHaveTextContent(/Roamy · 2 agents/);
    expect(css()).toMatch(
      /data-expanded\]:not\(\[data-loose\]\) \.g2-box-meta \{\s*display: none;/
    );
    fireEvent.click(within(status).getByTestId('g2-details'));
    // Details opens the rig's files in the shared documents drawer (Rig + Mission groups)
    expect(screen.getByTestId('docs-drawer')).toHaveAccessibleName('Documents · starter');
  });

  it('the Rig Map alias opens with the chosen rig already open', () => {
    const ctx = ctxFor(crossFleet(), {
      activeRig: listRigs(crossFleet()).find((r) => r.key === 'roamy:starter')!,
    });
    render(<GraphScreen ctx={ctx} focusChosen />);
    expect(within(frame('roamy:starter')).getByTestId('g2-inside')).toBeInTheDocument();
    expect(within(frame('roamy:kernel')).queryByTestId('g2-inside')).toBeNull();
  });
});

describe('Graph: between-rigs labels stay off the boxes', () => {
  it('slides a label along its own line to the nearest spot clear of every box', async () => {
    const { labelClearOf } = await import('./index.js');
    const fake = {
      setAttribute: () => undefined,
      getTotalLength: () => 100,
      getPointAtLength: (n: number) => ({ x: n, y: 0 }),
    };
    const spy = vi.spyOn(document, 'createElementNS').mockReturnValue(fake as never);
    try {
      const box = { x: 40, y: -50, w: 50, h: 100 };
      // already clear: stays
      expect(labelClearOf('M0,0', 200, 0, [box])).toEqual({ x: 200, y: 0 });
      // on the box: moves along the line to where a 48 px label misses it
      const at = labelClearOf('M0,0 L100,0', 50, 0, [box]);
      expect(at.x + 24).toBeLessThanOrEqual(box.x);
      expect(at.y).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Graph: navigation (rig pick, panel, persistence)', () => {
  const frameOf = (key: string) => frame(key);

  it('a card click opens the Agent panel on this page, never another page', () => {
    const ctx = ctxFor(crossFleet());
    render(<Graph ctx={ctx} />);
    fireEvent.click(within(frameOf('roamy:starter')).getByTestId('g2-rig-toggle'));
    const card = within(frameOf('roamy:starter')).getAllByTestId('terminal-card-open')[0]!;
    fireEvent.click(card);
    expect(ctx.openAgentPanel).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(ctx.openAgentPanel).mock.calls[0]![0];
    expect(arg.machineId).toBe('roamy');
    expect(arg.seatKey).toMatch(/^roamy\/.+@starter$/);
    expect(arg.tab).toBeUndefined();
    expect(ctx.openAgentPage).not.toHaveBeenCalled();
    expect(ctx.goTo).not.toHaveBeenCalled();
  });

  it('every compact card has a visible ⋯ whose Documents opens the panel on its Documents tab', () => {
    const ctx = ctxFor(crossFleet());
    render(<Graph ctx={ctx} />);
    fireEvent.click(within(frameOf('roamy:starter')).getByTestId('g2-rig-toggle'));
    const cards = within(frameOf('roamy:starter')).getAllByTestId('g2-agent-card');
    const more = within(frameOf('roamy:starter')).getAllByTestId('g2-card-more');
    expect(more).toHaveLength(cards.length);
    fireEvent.click(more[0]!);
    fireEvent.click(screen.getByTestId('g2-card-documents'));
    expect(ctx.openAgentPanel).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'documents', machineId: 'roamy' })
    );
    // the menu closed, and the ⋯ did not open the panel by itself
    expect(screen.queryByTestId('g2-card-menu')).toBeNull();
    expect(ctx.openAgentPanel).toHaveBeenCalledTimes(1);
  });

  it('a rig pick opens that rig and scrolls to it; a repeat pick (new nonce) focuses it again', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const machines = crossFleet();
    const rig = (k: string) => listRigs(machines).find((r) => r.key === k)!;
    // cold open: nothing is pre-opened
    const { rerender } = render(
      <Graph ctx={ctxFor(machines, { activeRig: rig('roamy:kernel') })} />
    );
    expect(screen.queryAllByTestId('g2-inside')).toHaveLength(0);
    // a pick of another rig opens it, outlines it and scrolls to it
    rerender(<Graph ctx={ctxFor(machines, { activeRig: rig('roamy:starter'), focusNonce: 1 })} />);
    expect(within(frameOf('roamy:starter')).getByTestId('g2-inside')).toBeInTheDocument();
    expect(frameOf('roamy:starter')).toHaveAttribute('data-focus');
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    expect(scroll.mock.contexts).toContain(frameOf('roamy:starter'));
    // the same rig picked again: the nonce changes, so it is focused again
    fireEvent.click(within(frameOf('roamy:starter')).getByTestId('g2-rig-toggle')); // close it
    expect(within(frameOf('roamy:starter')).queryByTestId('g2-inside')).toBeNull();
    rerender(<Graph ctx={ctxFor(machines, { activeRig: rig('roamy:starter'), focusNonce: 2 })} />);
    expect(within(frameOf('roamy:starter')).getByTestId('g2-inside')).toBeInTheDocument();
  });

  it('which rigs are open survives leaving the page and coming back', () => {
    const machines = crossFleet();
    const first = render(<Graph ctx={ctxFor(machines)} />);
    fireEvent.click(within(frameOf('roamy:starter')).getByTestId('g2-rig-toggle'));
    fireEvent.click(within(frameOf('m2:kernel')).getByTestId('g2-rig-toggle'));
    first.unmount();
    render(<Graph ctx={ctxFor(machines)} />);
    expect(within(frameOf('roamy:starter')).getByTestId('g2-inside')).toBeInTheDocument();
    expect(within(frameOf('m2:kernel')).getByTestId('g2-inside')).toBeInTheDocument();
    expect(within(frameOf('roamy:kernel')).queryByTestId('g2-inside')).toBeNull();
  });

  it('when the nav provides openRigs / setOpenRigs they are the source of truth', () => {
    const machines = crossFleet();
    const setOpenRigs = vi.fn();
    const ctx = ctxFor(machines, {
      openRigs: ['roamy:starter'],
      setOpenRigs,
    } as never);
    render(<Graph ctx={ctx} />);
    expect(within(frameOf('roamy:starter')).getByTestId('g2-inside')).toBeInTheDocument();
    fireEvent.click(within(frameOf('m2:kernel')).getByTestId('g2-rig-toggle'));
    expect(setOpenRigs).toHaveBeenLastCalledWith(
      expect.arrayContaining(['roamy:starter', 'm2:kernel'])
    );
  });

  it('compact cards keep their context and tokens whole, and the chips stay above the banner', () => {
    const c = css();
    expect(c).toMatch(
      /\.g2-inside \.tcard\[data-size='compact'\] \.harness-mark \{\s*font-size: 0;/
    );
    expect(c).toMatch(/\.g2-toolbar \{[^}]*z-index: 80;/s);
  });
});

describe('Graph: acceptance fixes', () => {
  const openStarter = (ctx: ReturnType<typeof ctxFor>) => {
    render(<Graph ctx={ctx} />);
    fireEvent.click(within(frame('roamy:starter')).getByTestId('g2-rig-toggle'));
    const inside = within(frame('roamy:starter')).getByTestId('g2-inside');
    fireEvent.pointerEnter(within(inside).getAllByTestId('g2-agent-card')[0]!.closest('.g2-cell')!);
    return inside;
  };

  it('the hover card goes away when Documents is clicked, and on a press outside it', () => {
    const ctx = ctxFor(crossFleet());
    const inside = openStarter(ctx);
    fireEvent.click(within(inside).getByTestId('g2-hover-docs'));
    expect(ctx.openAgentPanel).toHaveBeenCalledWith(expect.objectContaining({ tab: 'documents' }));
    expect(within(inside).queryByTestId('seat-detail')).toBeNull();
    // for a moment after the click, the card under the pointer does not pop up its own card
    fireEvent.pointerEnter(within(inside).getAllByTestId('g2-agent-card')[1]!.closest('.g2-cell')!);
    expect(within(inside).queryByTestId('seat-detail')).toBeNull();
    const real = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(real + 1000);
    // shown again, then a press elsewhere puts it away
    fireEvent.pointerEnter(within(inside).getAllByTestId('g2-agent-card')[1]!.closest('.g2-cell')!);
    expect(within(inside).getByTestId('seat-detail')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(within(inside).queryByTestId('seat-detail')).toBeNull();
    spy.mockRestore();
  });

  it('a card click puts the hover card away too', () => {
    const ctx = ctxFor(crossFleet());
    const inside = openStarter(ctx);
    fireEvent.click(within(inside).getAllByTestId('terminal-card-open')[0]!);
    expect(within(inside).queryByTestId('seat-detail')).toBeNull();
  });

  it('lines run under the cards, counts above; the box showing a hover card rises over its neighbours; the header is sticky', () => {
    const c = css();
    expect(c).toMatch(/\.g2-inside-lines \{\s*z-index: 1;/);
    expect(c).toMatch(/\.g2-inside-lines-labels \{\s*z-index: 3;/);
    expect(c).toMatch(/\.g2-box:has\(\.g2-hover\) \{\s*z-index: 55;/);
    expect(c).toMatch(/\.g2-sticky \{\s*position: sticky;\s*top: var\(--ar-bar-h, 0px\);/);
    render(<Graph ctx={ctxFor(crossFleet())} />);
    const sticky = screen.getByTestId('g2-sticky');
    expect(within(sticky).getByTestId('g2-expand-all')).toBeInTheDocument();
    expect(within(sticky).getByTestId('ar-page-head')).toBeInTheDocument();
  });
});
