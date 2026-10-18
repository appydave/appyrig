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
import { listRigs } from '../../../fleet/views.js';
import type { FleetSocket } from '../../../fleet/useFleet.js';
import { fleetMachine, snapshot, update } from '../../../test/fleetFixtures.js';
import type { FrozenFile } from '../../frozen/frozenSocket.js';
import type { V2Context } from '../../types.js';
import { page } from './index.js';
import { buildGraph, crossRigEdges, endpointGroup, looseKey, rigMatches } from './model.js';
import { routeCross } from './crossRoute.js';

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
    q({ id: 'm1', source: 'orch-lead@factory-claude', destination: 'openrig-orch@roamy' }),
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
    expect(unplaced).toEqual({ count: 1, names: [{ name: 'gone-rig', count: 1 }] });
  });

  it('places an endpoint on its rig, a machine’s loose sessions, or nowhere', () => {
    const [m2, roamy] = crossFleet() as [FleetMachine, FleetMachine];
    const all = [m2, roamy];
    expect(endpointGroup('dev-build@starter', roamy, all)).toBe('roamy:starter');
    expect(endpointGroup('openrig-orch@roamy', m2, all)).toBe(looseKey('roamy'));
    expect(endpointGroup('human@kernel', roamy, all)).toBeNull();
    expect(endpointGroup('ghost@gone-rig', roamy, all)).toBeNull();
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
    expect(screen.getByTestId('g2-unplaced')).toHaveTextContent('gone-rig 1');
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
    expect(within(frame('roamy:starter')).getByTestId('g2-fake-start')).toBeDisabled();
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
