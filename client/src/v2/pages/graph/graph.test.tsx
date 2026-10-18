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
import App from '../../../App.js';
import { listRigs, plannedWord } from '../../../fleet/views.js';
import type { FleetSocket } from '../../../fleet/useFleet.js';
import { fleetMachine, snapshot, update } from '../../../test/fleetFixtures.js';
import type { FrozenFile } from '../../frozen/frozenSocket.js';
import type { V2Context } from '../../types.js';
import { page } from './index.js';
import {
  buildGraph,
  crossRigEdges,
  endpointGroup,
  isCrowded,
  looseKey,
  openByDefault,
  rigMatches,
} from './model.js';
import { routeCross, PAIR_GAP } from './crossRoute.js';
import { avoidCards } from './labels.js';
import RigFrame from './RigFrame.js';

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
function answeringSocket(answer: (verb: string) => unknown) {
  const sent: string[] = [];
  const s = {
    connected: true,
    on() {
      return s;
    },
    off() {
      return s;
    },
    emit: vi.fn(),
    timeout: vi.fn(() => ({
      emit: (_ev: string, req: { verb: string }, cb: (e: Error | null, a?: unknown) => void) => {
        sent.push(req.verb);
        cb(null, answer(req.verb));
      },
    })),
  };
  return { socket: s as unknown as FleetSocket, sent };
}
const okSsh = (ssh: string | null) => ({
  ok: true,
  value: { machine: 'roamy', rig: 'starter', ssh, gates: [], scanned: 0, bodiesMissing: 0 },
});
const refused = { ok: false, error: { failureMode: 'internal', message: 'no' } };

function ctxFor(machines: FleetMachine[], over: Partial<V2Context> = {}): V2Context {
  const spy = spySocket();
  return {
    machines,
    allMachines: machines,
    rigs: listRigs(machines),
    activeRig: null,
    chooseRig: vi.fn(),
    pickedRig: null,
    groupBy: 'rig',
    now: NOW,
    link: 'connected',
    hubConnected: true,
    received: true,
    getSocket: () => spy.socket,
    keys: true,
    hidden: [],
    onShowMachine: vi.fn(),
    onOpenSeat: vi.fn(),
    onOpenSkills: vi.fn(),
    onOpenAgent: vi.fn(),
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
      path.resolve(__dirname, '../../../../../test/fixtures/frozen/busy-2026-10-18.json'),
      'utf8'
    )
  ) as FrozenFile;
  return { machines: (file.update as FleetUpdate).machines, now: Date.parse(file.recordedAt) };
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
  history.replaceState(null, '', '/');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Graph model', () => {
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
    expect(byPair[`${looseKey('roamy')}→roamy:starter`]!.count).toBe(2);
    // a name no machine reports is counted, named, and not drawn
    expect(unplaced).toEqual({
      count: 1,
      names: [{ name: 'gone-rig', count: 1, kind: 'rig' }],
      byKind: { machine: 0, rig: 1 },
    });
  });

  it('places an endpoint on its rig, a machine’s loose sessions, or nowhere', () => {
    const [m2, roamy] = crossFleet() as [FleetMachine, FleetMachine];
    const all = [m2, roamy];
    expect(endpointGroup('dev-build@starter', roamy, all)).toBe('roamy:starter');
    expect(endpointGroup('openrig-orch@roamy', m2, all)).toBe(looseKey('roamy'));
    // MEDIUM-2: a session that is no seat any more still belongs to its machine's no-rig group
    expect(endpointGroup('gone-orch@roamy', m2, all)).toBe(looseKey('roamy'));
    // ... but only where that group exists; a machine with every session in a rig has none
    const allInRigs = {
      ...m2,
      snapshot: {
        ...m2.snapshot,
        seats: m2.snapshot.seats.map((x) => ({ ...x, rig: m2.snapshot.rigs[0]!.name })),
      },
    };
    expect(endpointGroup('gone-orch@m2', roamy, [allInRigs, roamy])).toBeNull();
    expect(endpointGroup('human@kernel', roamy, all)).toBeNull();
    expect(endpointGroup('ghost@gone-rig', roamy, all)).toBeNull();
  });

  it('MEDIUM-2: on the busy snapshot, lines from sessions that are no seat on Roamy / the M4 reach the M2', () => {
    const { machines, now } = busy();
    const g = buildGraph(machines, now);
    const pair = (a: string, b: string) => g.cross.find((e) => e.from === a && e.to === b);
    expect(pair(looseKey('roamy'), 'm2:flicut-ab')?.count).toBe(3);
    expect(pair(looseKey('roamy'), 'm2:appyrig-build')?.count).toBe(2);
    expect(pair(looseKey('m4'), 'm2:d09-crew')?.count).toBe(4);
    // what is still not drawn names a rig no machine reports, not a machine
    expect(g.unplaced.byKind.machine).toBe(0);
    expect(g.unplaced.names.some((n) => n.name === 'roamy' || n.name === 'm4')).toBe(false);
    expect(g.unplaced.count).toBe(g.unplaced.byKind.rig + g.unplaced.byKind.machine);
  });

  it('perf: an unchanged machine is not rebuilt; only the machine that changed is', () => {
    const [m2, roamy] = crossFleet() as [FleetMachine, FleetMachine];
    const first = buildGraph([m2, roamy], NOW);
    const roamy2 = { ...roamy, snapshot: { ...roamy.snapshot } }; // a new push from Roamy only
    const second = buildGraph([m2, roamy2], NOW);
    const rigsOf = (g: ReturnType<typeof buildGraph>, id: string) =>
      g.machines.find((m) => m.id === id)!.rigs;
    rigsOf(first, 'm2').forEach((r, i) => expect(rigsOf(second, 'm2')[i]).toBe(r));
    rigsOf(first, 'roamy').forEach((r, i) => {
      expect(rigsOf(second, 'roamy')[i]).not.toBe(r);
      expect(rigsOf(second, 'roamy')[i]).toEqual(r);
    });
    // the rig frame skips a render when its rig object is the same
    expect((RigFrame as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });

  it('UX 2: on a machine with more than 8 rigs only the picked and the flagged ones start open', () => {
    const roamy = fleetMachine(snapshot('roamy'));
    const extra = Array.from({ length: 9 }, (_, i) => ({
      id: `x${i}`,
      name: `extra-${i}`,
      status: 'running',
      lifecycleState: 'running',
      nodeCount: 0,
      runningCount: 0,
      attentionCount: i === 3 ? 2 : 0,
    }));
    const crowded: FleetMachine = {
      ...roamy,
      snapshot: {
        ...roamy.snapshot,
        rigs: [...roamy.snapshot.rigs.map((r) => ({ ...r, attentionCount: 0 })), ...extra],
        queue: [],
      },
    };
    const g = buildGraph([crowded], NOW);
    const rig = (name: string) => g.machines[0]!.rigs.find((r) => r.name === name)!;
    expect(isCrowded(g, rig('extra-0'))).toBe(true);
    expect(openByDefault(rig('extra-0'), null, true)).toBe(false);
    expect(openByDefault(rig('extra-3'), null, true)).toBe(true); // OpenRig flags it
    expect(openByDefault(rig('extra-0'), 'roamy:extra-0', true)).toBe(true); // picked
    // and a machine with 8 or fewer still opens every running rig
    expect(openByDefault(rig('extra-0'), null, false)).toBe(true);
    render(<Graph ctx={ctxFor([crowded])} />);
    expect(frame('roamy:extra-0')).toHaveAttribute('aria-expanded', 'false');
    expect(frame('roamy:extra-3')).toHaveAttribute('aria-expanded', 'true');
  });

  it('builds every rig on every machine from the busy snapshot (23 rigs, 91 seats)', () => {
    const { machines, now } = busy();
    const g = buildGraph(machines, now);
    expect(g.machines.map((m) => m.label)).toEqual(['M2', 'M4', 'Roamy']);
    expect(g.totals.rigs).toBe(23);
    expect(g.totals.agents).toBe(91);
    expect(g.cross.length).toBeGreaterThan(0);
    // in-rig lines keep both ends inside the rig
    for (const r of g.machines.flatMap((m) => m.rigs)) {
      const mine = new Set(r.pods.flatMap((p) => p.seats.map((s) => s.key)));
      for (const e of r.edges) expect(mine.has(e.from) && mine.has(e.to)).toBe(true);
    }
  });

  it('routes same-column arcs into the right gap and labels cross-column lines in the first gap', () => {
    const boxes: Record<string, { x: number; y: number; w: number; h: number; col: number }> = {
      a: { x: 0, y: 0, w: 400, h: 30, col: 0 },
      b: { x: 0, y: 200, w: 400, h: 30, col: 0 },
      c: { x: 500, y: 100, w: 400, h: 30, col: 1 },
    };
    const e = (from: string, to: string) => ({ from, to, count: 1, open: 0, stale: 0, items: [] });
    const out = routeCross([e('a', 'b'), e('a', 'c')], (k) => boxes[k] ?? null, 100);
    const arc = out.find((p) => p.edge.to === 'b')!;
    expect(arc.lx).toBeGreaterThan(400);
    const across = out.find((p) => p.edge.to === 'c')!;
    expect(across.lx).toBeGreaterThan(400);
    expect(across.lx).toBeLessThan(500);
  });
});

describe('Graph page', () => {
  it('renders every rig on every machine, plus each machine’s sessions in no rig', () => {
    const { machines, now } = busy();
    render(<Graph ctx={ctxFor(machines, { now })} />);
    expect(screen.getAllByTestId('g2-machine')).toHaveLength(3);
    const keys = rigKeys();
    expect(keys.filter((k) => !k!.endsWith('~loose'))).toHaveLength(23);
    expect(keys.filter((k) => k!.endsWith('~loose'))).toHaveLength(3);
    expect(screen.getByTestId('g2-caption')).toHaveTextContent('23 rigs');
    expect(screen.getByTestId('g2-caption')).toHaveTextContent('91 agents');
  });

  it('a running rig opens by default, a stopped one is folded; toggles, Expand all and Collapse all', () => {
    const machines = crossFleet();
    render(<Graph ctx={ctxFor(machines)} />);
    expect(frame('roamy:starter')).toHaveAttribute('aria-expanded', 'true');
    expect(frame('m2:kernel')).toHaveAttribute('aria-expanded', 'false');
    // folded: name, state, machine, counts; no cards
    expect(within(frame('m2:kernel')).getByTestId('g2-rig-counts')).toHaveTextContent(
      '4 agents · 0 active'
    );
    expect(within(frame('m2:kernel')).queryAllByTestId('g2-card')).toHaveLength(0);
    fireEvent.click(within(frame('m2:kernel')).getByTestId('g2-rig-toggle'));
    expect(frame('m2:kernel')).toHaveAttribute('aria-expanded', 'true');
    expect(within(frame('m2:kernel')).getAllByTestId('g2-card')).toHaveLength(4);
    fireEvent.click(screen.getByTestId('g2-collapse-all'));
    expect(screen.queryAllByTestId('g2-card')).toHaveLength(0);
    fireEvent.click(screen.getByTestId('g2-expand-all'));
    expect(
      screen.getAllByTestId('g2-rig').every((r) => r.getAttribute('aria-expanded') === 'true')
    ).toBe(true);
  });

  it('shows the cross-rig traffic counts on the frames', () => {
    render(<Graph ctx={ctxFor(crossFleet())} />);
    expect(within(frame('roamy:starter')).getByTestId('g2-rig-cross')).toHaveTextContent('↗3 ↙3');
    expect(within(frame('roamy:kernel')).getByTestId('g2-rig-cross')).toHaveTextContent('↗1 ↙3');
    expect(screen.getByTestId('g2-caption')).toHaveTextContent('5 lines between rigs');
    // shrunk to "+N not drawn ⓘ"; the breakdown by kind is in its tooltip
    expect(screen.getByTestId('g2-unplaced')).toHaveTextContent('+1 not drawn');
    expect(screen.getByTestId('g2-unplaced')).not.toHaveTextContent('gone-rig');
    expect(screen.getByTestId('g2-unplaced')).toHaveAttribute(
      'title',
      expect.stringMatching(/1 name a rig no machine reports \(gone-rig 1\)/)
    );
  });

  it('a tree click opens the rig, highlights the item and picks the rig', () => {
    const ctx = ctxFor(crossFleet());
    render(<Graph ctx={ctx} />);
    // unfold M2 → kernel → pod operator, then pick the seat
    const tree = screen.getByTestId('g2-tree');
    const caret = (k: string) =>
      within(tree)
        .getAllByTestId('g2-tree-caret')
        .find((c) => c.dataset.key === k)!;
    const item = (k: string) =>
      within(tree)
        .getAllByTestId('g2-tree-item')
        .find((c) => c.dataset.key === k)!;
    fireEvent.click(caret('m2:kernel'));
    fireEvent.click(caret('m2:kernel/pod/operator'));
    fireEvent.click(item('m2/operator-agent@kernel'));
    expect(frame('m2:kernel')).toHaveAttribute('aria-expanded', 'true');
    const card = within(frame('m2:kernel'))
      .getAllByTestId('g2-card')
      .find((c) => c.dataset.nodeKey === 'm2/operator-agent@kernel')!;
    expect(card).toHaveAttribute('data-highlight', 'true');
    expect(item('m2/operator-agent@kernel')).toHaveAttribute('aria-current', 'true');
    expect(ctx.chooseRig).toHaveBeenCalledWith('m2:kernel');
    // a rig in the tree highlights its frame
    fireEvent.click(item('roamy:starter'));
    expect(frame('roamy:starter')).toHaveAttribute('data-highlight', 'true');
  });

  it('clicking a card opens the shared agent panel', () => {
    const ctx = ctxFor(crossFleet());
    render(<Graph ctx={ctx} />);
    const card = within(frame('roamy:starter')).getAllByTestId('g2-card')[0]!;
    fireEvent.click(card);
    expect(ctx.onOpenAgent).toHaveBeenCalledWith(card.dataset.nodeKey);
  });

  it('Needs me / Failing filters keep only matching rigs and dim the other seats; Teams picks rigs', () => {
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
    const { unmount } = render(<Graph ctx={ctxFor([fleetMachine(snapshot('m2')), failing])} />);
    fireEvent.click(screen.getByTestId('g2-filter-needsMe'));
    expect(rigKeys()).toEqual(['roamy:starter']);
    const cards = within(frame('roamy:starter')).getAllByTestId('g2-card');
    expect(cards.find((c) => c.dataset.nodeKey === 'roamy/dev-build@starter')).not.toHaveAttribute(
      'data-dim'
    );
    expect(cards.find((c) => c.dataset.nodeKey === 'roamy/dev-review@starter')).toHaveAttribute(
      'data-dim',
      'true'
    );
    fireEvent.click(screen.getByTestId('g2-filter-failing'));
    expect(rigKeys()).toEqual(['roamy:kernel']);
    fireEvent.click(screen.getByTestId('g2-filter-failing'));
    expect(rigKeys().length).toBeGreaterThan(2);
    // Teams: running only, then one team off
    fireEvent.click(screen.getByTestId('g2-teams'));
    fireEvent.click(screen.getByTestId('g2-teams-running'));
    expect(rigKeys().sort()).toEqual(['roamy:kernel', 'roamy:starter']);
    fireEvent.click(
      screen.getAllByTestId('g2-team').find((c) => c.dataset.key === 'roamy:kernel')!
    );
    expect(rigKeys()).toEqual(['roamy:starter']);
    expect(screen.getAllByTestId('g2-col-empty').length).toBeGreaterThan(0);
    unmount();
    expect(rigMatches(buildGraph([failing], NOW).machines[0]!.rigs[0]!, null)).toBe(true);
  });

  it('fake Start / Restore / Restart confirm, show progress and a toast, and send nothing', () => {
    vi.useFakeTimers();
    const spy = spySocket();
    render(<Graph ctx={ctxFor(crossFleet(), { getSocket: () => spy.socket })} />);
    fireEvent.click(within(frame('m2:kernel')).getByTestId('g2-rig-toggle'));
    // the rig's actions sit behind "⋯"; the mock mark is on the header whether it is open or not
    expect(within(frame('m2:kernel')).queryByTestId('g2-fake-start')).toBeNull();
    expect(
      within(within(frame('m2:kernel')).getByTestId('g2-rig-head')).getByTestId('mock-mark')
    ).toBeInTheDocument();
    fireEvent.click(within(frame('m2:kernel')).getByTestId('g2-rig-menu'));
    fireEvent.click(within(frame('m2:kernel')).getByTestId('g2-fake-start'));
    expect(screen.getByTestId('g2-fake-dialog')).toHaveTextContent('Start kernel on the M2?');
    expect(
      within(screen.getByTestId('g2-fake-dialog')).getByTestId('mock-mark')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('g2-fake-yes'));
    expect(screen.getByTestId('g2-fake-working')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1300));
    expect(screen.getByTestId('g2-toast')).toHaveTextContent('kernel started on the M2 (pretend)');
    // Start is off on a running rig
    fireEvent.click(within(frame('roamy:starter')).getByTestId('g2-rig-menu'));
    expect(within(frame('roamy:starter')).getByTestId('g2-fake-start')).toBeDisabled();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(within(frame('roamy:starter')).queryByTestId('g2-fake-start')).toBeNull();
    // per agent: the hover card's Restart (cancel leaves nothing behind)
    const card = within(frame('roamy:starter')).getAllByTestId('g2-card')[0]!;
    fireEvent.pointerEnter(card);
    fireEvent.click(within(screen.getByTestId('g2-detail')).getByTestId('g2-fake-restart'));
    fireEvent.click(screen.getByTestId('g2-fake-cancel'));
    expect(screen.queryByTestId('g2-fake-dialog')).toBeNull();
    fireEvent.click(within(screen.getByTestId('g2-detail')).getByTestId('g2-fake-stop'));
    fireEvent.click(screen.getByTestId('g2-fake-yes'));
    act(() => vi.advanceTimersByTime(1300));
    expect(screen.getAllByTestId('g2-toast').at(-1)).toHaveTextContent('stopped (pretend)');
    // the only thing ever sent is the hover card's read-only ssh lookup
    expect(spy.sent.filter((v) => v !== 'rig.waiting')).toEqual([]);
  });

  it('the hover card offers copy attach only with an ssh address from the hub', async () => {
    const spy = spySocket();
    const machines = crossFleet();
    render(<Graph ctx={ctxFor(machines, { getSocket: () => spy.socket })} />);
    const card = within(frame('roamy:starter')).getAllByTestId('g2-card')[0]!;
    fireEvent.pointerEnter(card);
    // no answer from the hub yet: no attach line, never a guess
    expect(within(screen.getByTestId('g2-detail')).queryByTestId('copy-attach')).toBeNull();
    expect(screen.getByTestId('g2-no-attach')).toBeInTheDocument();
    expect(spy.sent).toContain('rig.waiting');
  });
});

describe('Graph review fold', () => {
  it('MEDIUM-3: a line reads its state from the current fleet, so an item closing (same count) changes its class', () => {
    vi.useFakeTimers();
    const before = crossFleet();
    const { rerender } = render(<Graph ctx={ctxFor(before)} />);
    const lineClass = (from: string, to: string) =>
      screen
        .getAllByTestId('g2-cross')
        .find((g) => g.dataset.from === from && g.dataset.to === to)!
        .querySelector('.g2-cross-path')!
        .getAttribute('class');
    expect(lineClass('roamy:starter', 'roamy:kernel')).toContain('open'); // r3 is still pending
    const inRig = () =>
      within(frame('roamy:starter'))
        .queryAllByTestId('g2-edge')
        .map((g) => g.querySelector('.rigmap-edge')!.getAttribute('class'));
    expect(inRig().every((c) => !c!.includes('open'))).toBe(true);
    // r3 closes and r7 (inside the rig) opens: no count changes anywhere
    const roamy = before[1]!;
    const after: FleetMachine[] = [
      before[0]!,
      withQueue(
        roamy,
        roamy.snapshot.queue.map((x) =>
          x.id === 'r3'
            ? { ...x, state: 'done' }
            : x.id === 'r7'
              ? { ...x, state: 'pending', createdAt: '2026-10-10T07:55:00.000Z' }
              : x
        )
      ),
    ];
    rerender(<Graph ctx={ctxFor(after)} />);
    act(() => vi.advanceTimersByTime(3100)); // the rebuild is throttled to ~3 s
    expect(lineClass('roamy:starter', 'roamy:kernel')).not.toContain('open');
    expect(inRig().some((c) => c!.includes('open'))).toBe(true);
  });

  it('the rebuild is throttled: a fleet that changes twice within 3 s is read once more, with the latest', () => {
    vi.useFakeTimers();
    const a = crossFleet();
    const { rerender } = render(<Graph ctx={ctxFor(a)} />);
    const mk = (n: number) => [a[0]!, withQueue(a[1]!, a[1]!.snapshot.queue.slice(0, n))];
    rerender(<Graph ctx={ctxFor(mk(9))} />);
    rerender(<Graph ctx={ctxFor(mk(4))} />);
    // nothing yet
    expect(screen.getByTestId('g2-caption')).toHaveTextContent('5 lines between rigs');
    act(() => vi.advanceTimersByTime(3100));
    expect(screen.getByTestId('g2-caption')).not.toHaveTextContent('5 lines between rigs');
  });

  it('MEDIUM-2 on the page: the recovered lines are drawn between the columns', () => {
    const { machines, now } = busy();
    render(<Graph ctx={ctxFor(machines, { now })} />);
    const drawn = screen.getAllByTestId('g2-cross');
    const has = (a: string, b: string) =>
      drawn.some((g) => g.dataset.from === a && g.dataset.to === b);
    expect(has(looseKey('roamy'), 'm2:flicut-ab')).toBe(true);
    expect(has(looseKey('m4'), 'm2:d09-crew')).toBe(true);
    expect(screen.getByTestId('g2-unplaced')).toHaveTextContent('not drawn');
  });

  it('UX 1: Fit never goes below 85 % (a wide fleet scrolls sideways); a wide window still fits at 100 %', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get');
    width.mockReturnValue(500);
    const { machines, now } = busy();
    const { unmount } = render(<Graph ctx={ctxFor(machines, { now })} />);
    expect(screen.getByTestId('g2-zoom')).toHaveTextContent('85%');
    unmount();
    width.mockReturnValue(4000);
    render(<Graph ctx={ctxFor(machines, { now })} />);
    expect(screen.getByTestId('g2-zoom')).toHaveTextContent('100%');
    width.mockRestore();
  });

  it('UX 3: the ⋯ menu holds Start / Restore / Launch, keeps the mock mark, and closes on Escape or a click away', () => {
    render(<Graph ctx={ctxFor(crossFleet())} />);
    const head = within(frame('roamy:starter')).getByTestId('g2-rig-head');
    expect(within(head).getByTestId('mock-mark')).toBeInTheDocument();
    const menu = within(head).getByTestId('g2-rig-menu');
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(menu);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    const actions = within(frame('roamy:starter')).getByTestId('g2-rig-menu-items');
    expect(
      within(actions)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Start', 'Restore', 'Launch']);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(menu).toHaveFocus();
    fireEvent.click(menu);
    fireEvent.pointerDown(document.body);
    expect(within(frame('roamy:starter')).queryByTestId('g2-rig-menu-items')).toBeNull();
  });

  it('UX 5: under Needs me a rig OpenRig itself flags keeps its seats undimmed and says why it is shown', () => {
    const roamy = fleetMachine(snapshot('roamy'));
    const calm: FleetMachine = {
      ...roamy,
      snapshot: {
        ...roamy.snapshot,
        queue: [],
        rigs: roamy.snapshot.rigs.map((r) => ({
          ...r,
          attentionCount: r.name === 'kernel' ? 2 : 0,
        })),
        seats: roamy.snapshot.seats.map((x) => ({
          ...x,
          status: 'idle' as const,
          blockedReason: null,
        })),
      },
    };
    render(<Graph ctx={ctxFor([calm])} />);
    fireEvent.click(screen.getByTestId('g2-filter-needsMe'));
    expect(rigKeys()).toEqual(['roamy:kernel']);
    const cards = within(frame('roamy:kernel')).getAllByTestId('g2-card');
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c).not.toHaveAttribute('data-dim');
    expect(within(frame('roamy:kernel')).getByTestId('g2-rig-reason')).toHaveTextContent(
      'OpenRig flags this rig'
    );
    expect(within(frame('roamy:kernel')).getByTestId('g2-rig-head')).toHaveAttribute(
      'data-rig-match',
      'true'
    );
    // the inline ▲ stays
    expect(
      within(frame('roamy:kernel'))
        .getByTestId('g2-rig-head')
        .querySelector('[data-flag="needsMe"]')
    ).not.toBeNull();
  });

  it('L3: the tree is plain folding buttons (no ARIA tree promising arrow keys), each fold says if it is expanded', () => {
    render(<Graph ctx={ctxFor(crossFleet())} />);
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
    const caret = within(screen.getByTestId('g2-tree')).getAllByTestId('g2-tree-caret')[0]!;
    expect(caret).toHaveAttribute('aria-expanded');
  });

  it('L3: Tab from a card goes into its hover card (Restart / Stop), Shift+Tab and Escape come back', () => {
    render(<Graph ctx={ctxFor(crossFleet())} />);
    const card = within(frame('roamy:starter')).getAllByTestId('g2-card')[0]!;
    card.focus();
    fireEvent.focus(card);
    const detail = screen.getByTestId('g2-detail');
    fireEvent.keyDown(card, { key: 'Tab' });
    expect(detail.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(within(detail).getByTestId('g2-fake-restart'));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(card).toHaveFocus();
    fireEvent.keyDown(card, { key: 'Tab' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('g2-detail')).toBeNull();
    expect(card).toHaveFocus();
  });

  it('L7: with an ssh address from the hub, the hover card offers copy attach', async () => {
    const a = answeringSocket(() => okSsh('david@roamy.local'));
    render(<Graph ctx={ctxFor(crossFleet(), { getSocket: () => a.socket })} />);
    const card = within(frame('roamy:starter')).getAllByTestId('g2-card')[0]!;
    fireEvent.pointerEnter(card);
    expect(await screen.findByTestId('copy-attach')).toBeInTheDocument();
    expect(screen.queryByTestId('g2-no-attach')).toBeNull();
    expect(a.sent).toEqual(['rig.waiting']);
  });

  it('L4: a failed lookup is remembered for 30 s and then asked again; a found address is never asked twice', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let answer: unknown = refused;
    const a = answeringSocket(() => answer);
    render(<Graph ctx={ctxFor(crossFleet(), { getSocket: () => a.socket })} />);
    const cards = () => within(frame('roamy:starter')).getAllByTestId('g2-card');
    const hover = async () => {
      fireEvent.pointerEnter(cards()[0]!);
      await act(async () => {});
    };
    await hover();
    await hover();
    expect(a.sent).toHaveLength(1); // the failure is remembered
    act(() => vi.advanceTimersByTime(31_000));
    answer = okSsh('david@roamy.local');
    await hover();
    expect(a.sent).toHaveLength(2);
    act(() => vi.advanceTimersByTime(10 * 60_000));
    await hover();
    expect(a.sent).toHaveLength(2); // found: kept
  });

  it('L4: a machine with only loose sessions has no rig to ask through, and the card says so', () => {
    const roamy = fleetMachine(snapshot('roamy'));
    const looseOnly: FleetMachine = {
      ...roamy,
      snapshot: {
        ...roamy.snapshot,
        rigs: [],
        seats: roamy.snapshot.seats.map((x) => ({ ...x, rig: null })),
        queue: [],
      },
    };
    const spy = spySocket();
    render(<Graph ctx={ctxFor([looseOnly], { getSocket: () => spy.socket })} />);
    const group = screen.getAllByTestId('g2-rig').find((r) => r.dataset.loose)!;
    fireEvent.click(within(group).getByTestId('g2-rig-toggle')); // loose groups start folded
    fireEvent.pointerEnter(within(group).getAllByTestId('g2-card')[0]!);
    expect(screen.getByTestId('g2-no-attach')).toHaveTextContent('runs no rig');
    expect(spy.sent).toEqual([]);
  });

  it('L5: two directions on one pair sit at least a label height apart, in a column and across columns', () => {
    const e = (from: string, to: string) => ({ from, to, count: 1, open: 0, stale: 0, items: [] });
    const boxes: Record<string, { x: number; y: number; w: number; h: number; col: number }> = {
      a: { x: 0, y: 0, w: 400, h: 30, col: 0 },
      b: { x: 0, y: 200, w: 400, h: 30, col: 0 },
      c: { x: 500, y: 100, w: 400, h: 30, col: 1 },
    };
    expect(PAIR_GAP).toBeGreaterThanOrEqual(18);
    for (const [x, y] of [
      ['a', 'b'],
      ['a', 'c'],
    ] as const) {
      const out = routeCross([e(x, y), e(y, x)], (k) => boxes[k] ?? null, 100);
      const fwd = out.find((p) => p.edge.from === x)!;
      const back = out.find((p) => p.edge.from === y)!;
      expect(Math.abs(fwd.ly - back.ly)).toBeGreaterThanOrEqual(18);
    }
  });

  it('L6: a planned line’s word label slides off an agent card it would cover; counts are left alone', () => {
    const edge = (planned?: string) => ({
      from: 'a',
      to: 'b',
      count: planned ? 0 : 2,
      open: 0,
      stale: 0,
      self: false,
      items: [],
      ...(planned ? { planned } : {}),
    });
    const c: [number, number, number, number, number, number, number, number] = [
      0, 50, 100, 50, 200, 50, 300, 50,
    ];
    const card = { x: 130, y: 20, w: 40, h: 60 }; // sits on the middle of the line
    const planned = { edge: edge('delegates_to'), lx: 150, ly: 50, c, d: '' };
    const counted = { edge: edge(), lx: 150, ly: 50, c, d: '' };
    const [moved, kept] = avoidCards([planned, counted], [card]);
    expect(moved!.lx).not.toBe(150);
    const w = Math.round(plannedWord('delegates_to').length * 6.6 + 14);
    const clear = moved!.lx + w / 2 < card.x - 2 || moved!.lx - w / 2 > card.x + card.w + 2;
    expect(clear).toBe(true);
    expect(kept).toBe(counted);
    // nothing in the way: untouched
    expect(avoidCards([planned], [{ x: 0, y: 200, w: 10, h: 10 }])[0]).toBe(planned);
  });
});

describe('Graph in the app: B flips Graph ↔ Current Rig Map and keeps the picked rig', () => {
  it('the rig picked on the Rig Map is open and marked in the Graph, and back', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const spy = spySocket();
    render(<App getSocket={() => spy.socket} />);
    spy.fire(
      FLEET_EVENTS.UPDATE,
      update([fleetMachine(snapshot('roamy--blocked')), fleetMachine(snapshot('m2'))])
    );
    fireEvent.click(screen.getByTestId('view-map'));
    fireEvent.click(
      screen.getAllByTestId('rig-chip').find((c) => c.dataset.rigKey === 'm2:kernel')!
    );
    fireEvent.keyDown(document.body, { key: 'b' });
    expect(screen.getByTestId('v2-graph')).toBeInTheDocument();
    expect(frame('m2:kernel')).toHaveAttribute('data-picked', 'true');
    // stopped rigs are folded, but the picked one is open
    expect(frame('m2:kernel')).toHaveAttribute('aria-expanded', 'true');
    expect(frame('m2:starter')).toHaveAttribute('aria-expanded', 'false');
    // pick another rig in the Graph, flip back: the Current Rig Map shows it
    fireEvent.click(within(frame('roamy:starter')).getByTestId('g2-rig-name'));
    fireEvent.keyDown(document.body, { key: 'b' });
    expect(screen.queryByTestId('v2-graph')).toBeNull();
    const chosen = screen
      .getAllByTestId('rig-chip')
      .find((c) => c.getAttribute('aria-pressed') === 'true');
    expect(chosen?.dataset.rigKey).toBe('roamy:starter');
  });

  it('in v2 the Fleet group names the page Graph', () => {
    history.replaceState(null, '', '/?v=2');
    const spy = spySocket();
    render(<App getSocket={() => spy.socket} />);
    spy.fire(FLEET_EVENTS.UPDATE, update([fleetMachine(snapshot('roamy'))]));
    expect(screen.getByTestId('v2-page-map')).toHaveTextContent('Graph');
    fireEvent.click(screen.getByTestId('v2-page-map'));
    expect(screen.getByTestId('v2-graph')).toBeInTheDocument();
  });
});
