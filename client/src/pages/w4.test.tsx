import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FLEET_EVENTS,
  type AccountWindow,
  type FleetMachine,
  type FleetUpdate,
  type QueueItem,
} from '@appydave/shared';
import App from '../app/App.js';
import { listRigs } from '../domain/fleet/views.js';
import type { FleetSocket } from '../domain/fleet/useFleet.js';
import { fleetMachine, snapshot, update } from '../test/fleetFixtures.js';
import type { FrozenFile } from '../app/frozen/frozenSocket.js';
import type { PageContext } from '../app/types.js';
import { page as timelinePage } from './timeline/index.js';
import { buildRun, dur } from '../domain/timeline/model.js';
import { page as accountsPage } from './accounts/index.js';
import { burnPerHour, hoursToEmpty } from '../domain/accounts/model.js';
import { page as machinesPage } from './machines/index.js';
import {
  behindWords,
  isPrerelease,
  machineView,
  newestVersion,
  parseVersion,
  versionState,
} from '../domain/machines/model.js';
import { page as schemaPage } from './schema/index.js';
import { sampleChanges } from '../domain/schema/model.js';
import { CommandsPanel } from './learn/index.js';
import { filterCommands, groupsOf, type RigCommands } from '../domain/learn/commands.js';

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

type Handler = (...args: unknown[]) => void;

function spySocket(answers: Record<string, unknown> = {}) {
  const handlers = new Map<string, Set<Handler>>();
  const sent: { verb: string; input: unknown }[] = [];
  const s = {
    connected: true,
    on(ev: string, h: Handler) {
      if (!handlers.has(ev)) {
        handlers.set(ev, new Set());
      }

      handlers.get(ev)!.add(h);

      return s;
    },
    off(ev: string, h: Handler) {
      handlers.get(ev)?.delete(h);

      return s;
    },
    emit: vi.fn(),
    timeout: vi.fn(() => ({
      emit: (
        _ev: string,
        req: { verb: string; input: unknown },
        cb: (err: unknown, a: unknown) => void
      ) => {
        sent.push(req);

        const a = answers[req.verb];

        if (a !== undefined) {
          queueMicrotask(() => cb(null, a));
        }
      },
    })),
  };
  const fire = (ev: string, ...args: unknown[]) =>
    act(() => handlers.get(ev)?.forEach((h) => h(...args)));

  return { socket: s as unknown as FleetSocket, sent, fire };
}

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
    openRigs: [],
    setOpenRigs: vi.fn(),
    onOpenFiles: vi.fn(),
    goTo: vi.fn(),
    ...over,
  };
}

function busy(): { machines: FleetMachine[]; now: number } {
  const file = JSON.parse(
    readFileSync(
      path.resolve(__dirname, '../../../test/fixtures/frozen/busy-2026-10-18.json'),
      'utf8'
    )
  ) as FrozenFile;

  return { machines: (file.update as FleetUpdate).machines, now: Date.parse(file.recordedAt) };
}

const q = (over: Partial<QueueItem>): QueueItem => ({
  id: over.id ?? 'q1',
  source: 'dev-build@starter',
  destination: 'dev-review@starter',
  state: 'done',
  priority: null,
  tags: [],
  summary: null,
  createdAt: '2026-10-10T07:00:00.000Z',
  updatedAt: '2026-10-10T07:05:00.000Z',
  ...over,
});

/** Roamy's starter with a two-phase run: three handoffs, a 40-minute pause, then one open. */
function runMachine(last: Partial<QueueItem> = {}): FleetMachine {
  const fm = fleetMachine(snapshot('roamy'));

  return {
    ...fm,
    snapshot: {
      ...fm.snapshot,
      queue: [
        q({
          id: 'a',
          createdAt: '2026-10-10T06:00:00.000Z',
          updatedAt: '2026-10-10T06:04:00.000Z',
        }),
        q({
          id: 'b',
          source: 'dev-review@starter',
          destination: 'dev-build@starter',
          createdAt: '2026-10-10T06:05:00.000Z',
          updatedAt: '2026-10-10T06:06:00.000Z',
        }),
        q({
          id: 'c',
          createdAt: '2026-10-10T06:10:00.000Z',
          updatedAt: '2026-10-10T06:20:00.000Z',
        }),
        q({
          id: 'd',
          state: 'pending',
          createdAt: '2026-10-10T07:00:00.000Z',
          updatedAt: '2026-10-10T07:00:00.000Z',
          ...last,
        }),
      ],
    },
  };
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

describe('v2 Run Timeline', () => {
  it('reads the run: outcome, phases, who waited on whom', () => {
    const run = buildRun(runMachine(), 'starter', NOW)!;

    expect(run.outcome).toBe('running');
    expect(run.phases.map((p) => p.count)).toEqual([3, 1]);
    expect(run.phases[0]!.senders[0]).toEqual({ name: 'dev-build', count: 2 });

    const w = run.waits.find((x) => x.from === 'dev-build' && x.to === 'dev-review')!;

    // closed waits 4 and 10 min (median 7), one open for 60 min
    expect(w).toMatchObject({ count: 3, open: 1, medianMs: 7 * 60_000, longestMs: 60 * 60_000 });
    expect(buildRun(runMachine({ state: 'done' }), 'starter', NOW)!.outcome).toBe('finished');
    expect(buildRun(runMachine({ state: 'blocked' }), 'starter', NOW)!.outcome).toBe('running');
    expect(
      buildRun(
        runMachine({ state: 'blocked', createdAt: '2026-10-10T03:00:00.000Z' }),
        'starter',
        NOW
      )!.outcome
    ).toBe('stalled');
    expect(buildRun(runMachine({ state: 'rejected' }), 'starter', NOW)!.outcome).toBe('stopped');
    expect(dur(125 * 60_000)).toBe('2 h 5 min');
  });

  it('renders the outcome, the strip, phases and waits; a seat name opens the agent panel', () => {
    const fm = runMachine();
    const rigs = listRigs([fm]);
    const ctx = ctxFor([fm], { activeRig: rigs.find((r) => r.name === 'starter')! });
    const Page = timelinePage.component;

    render(<Page ctx={ctx} />);
    expect(screen.getByTestId('tl2-outcome')).toHaveAttribute('data-outcome', 'running');
    expect(screen.getByTestId('tl2-total')).toHaveTextContent('4');
    expect(screen.getAllByTestId('tl2-phase')).toHaveLength(2);
    expect(screen.getByTestId('tl2-strip')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('tl2-waits')).getAllByTestId('tl2-seat')[0]!);
    expect(ctx.openAgentPage).toHaveBeenCalledWith('roamy/dev-build@starter');
  });

  it('says so when the chosen rig has no handoffs', () => {
    const fm = { ...runMachine(), snapshot: { ...runMachine().snapshot, queue: [] } };
    const ctx = ctxFor([fm], { activeRig: listRigs([fm])[0]! });
    const Page = timelinePage.component;

    render(<Page ctx={ctx} />);
    expect(screen.getByTestId('tl2-empty')).toBeInTheDocument();
  });
});

const win = (over: Partial<AccountWindow>): AccountWindow => ({
  status: 'reading',
  usedPct: 50,
  resetsAt: '2026-10-10T10:00:00.000Z',
  windowMs: 5 * 3_600_000,
  startsAt: '2026-10-10T05:00:00.000Z',
  elapsedPct: 40,
  elapsedNowPct: 60,
  paceDeltaPct: 10,
  projectedPct: 125,
  ...over,
});

describe('v2 Accounts', () => {
  it('burn rate is used ÷ hours gone; time to empty at that pace', () => {
    // 50% in 2 h → 25%/h, the other 50% in 2 h
    expect(burnPerHour(win({}))).toBe(25);
    expect(hoursToEmpty(win({}))).toBe(2);
    expect(burnPerHour(win({ status: 'no-reading', usedPct: null }))).toBeNull();
  });

  it('shows each account’s two windows and every machine, with a mock switch that sends nothing', () => {
    vi.useFakeTimers();

    const { machines, now } = busy();
    const spy = spySocket();
    const Page = accountsPage.component;

    render(<Page ctx={ctxFor(machines, { now, getSocket: () => spy.socket })} />);
    expect(screen.getAllByTestId('ac2-account')).toHaveLength(1);
    expect(screen.getAllByTestId('ac2-window')).toHaveLength(2);
    expect(screen.getAllByTestId('ac2-used')[0]).toHaveTextContent('11%');
    expect(screen.getAllByTestId('ac2-burn')[0]).toHaveTextContent('%/h');
    expect(screen.getAllByTestId('ac2-burn')[1]).toHaveTextContent('%/day');
    expect(screen.getAllByTestId('ac2-machine')).toHaveLength(3);

    const row = screen.getAllByTestId('ac2-machine')[1]!;

    fireEvent.click(within(row).getByRole('button', { name: 'Switch account' }));
    fireEvent.click(within(row).getByTestId('fake-confirm'));
    act(() => vi.advanceTimersByTime(1500));
    expect(within(row).getByTestId('fake-result')).toHaveTextContent('switched (pretend)');
    expect(spy.sent).toEqual([]);
  });
});

describe('v2 Machines', () => {
  it('compares versions with the latest release', () => {
    expect(versionState('0.6.6 (2620dea8)', '0.6.11')).toBe('behind');
    expect(versionState('0.6.11', '0.6.11')).toBe('current');
    expect(versionState(null, '0.6.11')).toBe('unknown');
    expect(behindWords('0.6.6 (2620dea8)', '0.6.11')).toBe('5 patch releases behind');
    expect(behindWords('0.5.9', '0.6.11')).toBe('1 minor release behind');
  });

  it('a card per machine: memory, swap, pressure, OpenRig and collector versions, mock upgrade', () => {
    const { machines, now } = busy();

    expect(machineView(machines[1]!, now, '0.6.13')).toMatchObject({
      openrig: '0.6.6',
      collector: '0.1.0',
      version: 'behind',
    });
    // one machine on a newer OpenRig makes the others "behind" it (and nothing else can)
    machines[2]!.snapshot.sources.daemon.version = '0.6.13';

    const Page = machinesPage.component;

    render(<Page ctx={ctxFor(machines, { now })} />);

    const cards = screen.getAllByTestId('mc2-machine');

    expect(cards).toHaveLength(3);
    expect(within(cards[0]!).getByTestId('mc2-mem')).toHaveTextContent('32 GB');
    expect(within(cards[0]!).getByTestId('mc2-openrig')).toHaveTextContent('0.6.6');
    expect(within(cards[0]!).getByTestId('mc2-vstate')).toHaveTextContent(
      'the newest on the fleet'
    );
    // no made-up "latest release": the panel names only what the machines report
    expect(screen.queryByTestId('mc2-latest')).toBeNull();
    expect(screen.getByTestId('mc2-watch')).not.toHaveTextContent('latest release');
    // load is not collected: labelled sample data
    expect(within(cards[0]!).getAllByTestId('sample-label').length).toBeGreaterThan(0);
    expect(within(cards[0]!).getByRole('button', { name: 'Upgrade OpenRig' })).toBeInTheDocument();
  });
});

describe('v2 OpenRig DB', () => {
  const out = (machine: string, changes: unknown) => ({
    ok: true,
    value: {
      machine,
      status: 'ok',
      reason: null,
      openrigVersion: '0.6.6 (2620dea8)',
      sampledAt: '2026-10-10T07:59:00.000Z',
      sampleAgeMs: 1000,
      tables: [
        { name: 'nodes', columns: [], foreignKeys: [] },
        { name: 'queue_items', columns: [], foreignKeys: [] },
      ],
      changes,
    },
  });

  it('a real change reads as a diff; no sample shown then', async () => {
    const changed = {
      status: 'changed',
      comparedTo: '0.6.5',
      addedTables: ['bindings'],
      removedTables: ['old_thing'],
      changedTables: [
        {
          name: 'nodes',
          addedColumns: ['context_tokens'],
          removedColumns: ['legacy'],
          changedColumns: [{ name: 'status', from: 'TEXT', to: 'TEXT NOT NULL' }],
          addedForeignKeys: [],
          removedForeignKeys: [],
        },
      ],
    };
    const spy = spySocket({ 'db.schema': out('roamy', changed) });
    const Page = schemaPage.component;

    render(
      <Page ctx={ctxFor([fleetMachine(snapshot('roamy'))], { getSocket: () => spy.socket })} />
    );
    await waitFor(() => expect(screen.getByTestId('db2-diff')).toBeInTheDocument());

    const diff = screen.getByTestId('db2-diff');

    expect(diff).toHaveTextContent('+ table bindings');
    expect(diff).toHaveTextContent('− table old_thing');
    expect(diff).toHaveTextContent('~ status: TEXT → TEXT NOT NULL');
    expect(screen.queryByTestId('sample-data')).toBeNull();
    // the table browser is kept
    expect(screen.getAllByText('nodes').length).toBeGreaterThan(0);
  });

  it('with only baselines, a labelled sample diff from the real table names', async () => {
    const spy = spySocket({
      'db.schema': out('roamy', {
        status: 'baseline',
        comparedTo: null,
        addedTables: [],
        removedTables: [],
        changedTables: [],
      }),
    });
    const Page = schemaPage.component;

    render(
      <Page ctx={ctxFor([fleetMachine(snapshot('roamy'))], { getSocket: () => spy.socket })} />
    );
    await waitFor(() => expect(screen.getByTestId('sample-data')).toBeInTheDocument());
    expect(screen.getByTestId('sample-data')).toHaveTextContent('+ table queue_items_history');
    expect(sampleChanges(['a', 'b'], '0.6.6').changedTables[0]!.name).toBe('a');
    expect(spy.sent.every((s) => s.verb === 'db.schema')).toBe(true);
  });
});

const cmds: RigCommands = {
  schema: 'x',
  openrig_version: '0.6.6',
  generated: '2026-10-18',
  source: 'test',
  effects: {},
  commands: [
    {
      command: 'rig ps',
      group: 'teams (rigs)',
      usage: null,
      openrig_says: null,
      plain: 'Lists teams.',
      when_to_use: 'Any time.',
      when_not: null,
      effect: 'read-only',
      where_to_run: 'anywhere',
      example: 'rig ps --nodes',
      curated: true,
      status: 'VERIFIED',
      is_group: false,
    },
    {
      command: 'rig destroy',
      group: 'daemon & install',
      usage: null,
      openrig_says: null,
      plain: 'Wipes local state.',
      when_to_use: 'Last resort.',
      when_not: 'Almost never.',
      effect: 'destructive',
      where_to_run: 'plain terminal',
      example: null,
      curated: true,
      status: 'VERIFIED',
      is_group: false,
    },
    {
      command: 'rig env status',
      group: 'other',
      usage: null,
      openrig_says: 'Show env',
      plain: null,
      when_to_use: null,
      when_not: null,
      effect: 'read-only',
      where_to_run: null,
      example: null,
      curated: false,
      status: 'VERIFIED',
      is_group: false,
    },
  ],
};

describe('v2 Learn: commands panel (C19)', () => {
  it('filters by words, group and plain-words', () => {
    expect(
      filterCommands(cmds.commands, { q: 'wipes', group: null, curatedOnly: true }).map(
        (c) => c.command
      )
    ).toEqual(['rig destroy']);
    expect(
      filterCommands(cmds.commands, { q: '', group: 'teams (rigs)', curatedOnly: true })
    ).toHaveLength(1);
    expect(filterCommands(cmds.commands, { q: '', group: null, curatedOnly: false })).toHaveLength(
      3
    );
    expect(groupsOf(cmds.commands).map((g) => g.group)).toEqual([
      'daemon & install',
      'other',
      'teams (rigs)',
    ]);
  });

  it('search, groups, when / when NOT, and a copy button', async () => {
    render(<CommandsPanel load={() => Promise.resolve(cmds)} />);
    await waitFor(() => expect(screen.getAllByTestId('lr2-command')).toHaveLength(2));
    expect(screen.getByText('when NOT')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('lr2-search'), { target: { value: 'teams' } });
    expect(screen.getAllByTestId('lr2-command')).toHaveLength(1);
    fireEvent.change(screen.getByTestId('lr2-search'), { target: { value: '' } });
    fireEvent.click(
      screen.getAllByTestId('lr2-group').find((g) => g.dataset.group === 'daemon & install')!
    );
    expect(screen.getAllByTestId('lr2-command').map((c) => c.dataset.effect)).toEqual([
      'destructive',
    ]);
    fireEvent.click(screen.getByTestId('lr2-curated'));
    fireEvent.click(
      screen.getAllByTestId('lr2-group').find((g) => g.dataset.group === 'daemon & install')!
    );
    expect(screen.getAllByTestId('lr2-command')).toHaveLength(3);

    const writeText = vi.fn(() => Promise.resolve());

    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const ps = screen.getAllByTestId('lr2-command').find((c) => c.textContent?.includes('rig ps'))!;

    fireEvent.click(within(ps).getByTestId('lr2-copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('rig ps --nodes'));
  });

  it('the real list loads: 371 commands, 51 in plain words', async () => {
    const { loadCommands } = await import('../domain/learn/commands.js');
    const d = await loadCommands();

    expect(d.commands).toHaveLength(371);
    expect(d.commands.filter((c) => c.curated)).toHaveLength(51);
  });
});

describe('W4 pages in the app: registered in their groups', () => {
  it.each([
    ['fleet', 'accounts', 'ar-accounts'],
    ['fleet', 'machines', 'ar-machines'],
    ['hood', 'schema', 'ar-schema'],
    ['hood', 'learn', 'ar-learn'],
    ['work', 'timeline', 'ar-timeline'],
  ])('%s / %s', (group, key, pageTestId) => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}

        disconnect() {}
      }
    );
    history.replaceState(null, '', '/');

    const spy = spySocket();

    render(<App getSocket={() => spy.socket} />);
    spy.fire(
      FLEET_EVENTS.UPDATE,
      update([fleetMachine(snapshot('roamy')), fleetMachine(snapshot('m2'))])
    );
    fireEvent.click(screen.getByTestId(`ar-group-${group}`));
    fireEvent.click(screen.getByTestId(`ar-page-${key}`));
    expect(screen.getByTestId(pageTestId)).toBeInTheDocument();
    expect(screen.getByTestId(`ar-page-${key}`)).toHaveAttribute('aria-current', 'page');
  });
});

describe('W4 fold: accounts burn never contradicts the verdict (MEDIUM-1/3)', () => {
  it('too early to tell, or under 3% of the window gone: no burn, no time to empty', () => {
    const early = win({ projectedPct: null, elapsedPct: 1, usedPct: 4 });

    expect(burnPerHour(early)).toBeNull();
    expect(hoursToEmpty(early)).toBeNull();

    // a projection but under 3% elapsed: still noise
    const tiny = win({ projectedPct: 300, elapsedPct: 2.9, usedPct: 10 });

    expect(burnPerHour(tiny)).toBeNull();
    expect(burnPerHour(win({ elapsedPct: 3, usedPct: 6 }))).not.toBeNull();
  });

  it('0 use burns nothing and never empties', () => {
    const zero = win({ usedPct: 0, projectedPct: 0 });

    expect(burnPerHour(zero)).toBe(0);
    expect(hoursToEmpty(zero)).toBeNull();
  });

  it('just reset (window ended, no reading) has no burn', () => {
    const ended = win({ status: 'window-ended', usedPct: null, elapsedPct: null });

    expect(burnPerHour(ended)).toBeNull();
    expect(hoursToEmpty(ended)).toBeNull();
  });

  it('100% or more used is spent, not "empty in 0 min"', () => {
    const spent = win({ usedPct: 104, projectedPct: 260 });

    expect(burnPerHour(spent)).toBeGreaterThan(0);
    expect(hoursToEmpty(spent)).toBeNull();
  });

  it('elapsed over 100% (a stale reading) gives no burn', () => {
    expect(burnPerHour(win({ elapsedPct: 101 }))).toBeNull();
  });

  it('the page shows a dash for burn beside "too early to tell"', () => {
    const w = win({ projectedPct: null, elapsedPct: 1, usedPct: 4 });
    const fm = fleetMachine(snapshot('roamy'));

    fm.snapshot.account = {
      email: 'a@x.test',
      plan: 'claude_max',
      fiveHourPct: 4,
      fiveHourResetsAt: w.resetsAt,
      sevenDayPct: null,
      sevenDayResetsAt: null,
      sampledAt: new Date().toISOString(),
      derived: {
        tier: { label: 'Max $100', source: 'config' },
        asOf: new Date().toISOString(),
        readingFrom: 'roamy',
        sampleAgeMs: 1000,
        fiveHour: w,
        sevenDay: win({ status: 'no-reading', usedPct: null }),
        monthly: { status: 'not-reported' },
      } as never,
    };

    const Page = accountsPage.component;

    render(<Page ctx={ctxFor([fm])} />);

    const first = screen.getAllByTestId('ac2-window')[0]!;

    expect(first).toHaveAttribute('data-kind', 'early');
    expect(within(first).getByTestId('ac2-burn')).toHaveTextContent('—');
  });
});

describe('W4 fold: timeline (MEDIUM-2, LOW)', () => {
  it('labels the wait column created → last update (the queue holds no closure time)', () => {
    const fm = runMachine();
    const ctx = ctxFor([fm], { activeRig: listRigs([fm]).find((r) => r.name === 'starter')! });
    const Page = timelinePage.component;

    render(<Page ctx={ctx} />);
    expect(screen.getByTestId('tl2-waits')).toHaveTextContent('created → last update');
  });

  it('shows the shared rig choice (App picks the busiest first), never its own', () => {
    const fm = runMachine();
    const rigs = listRigs([fm]);
    const empty = rigs.find((r) => r.name !== 'starter' && r.handoffs === 0)!;

    expect(empty).toBeTruthy();

    // the shared choice is an empty rig: the page shows exactly that, and picking calls the shared chooseRig
    const ctx = ctxFor([fm], { activeRig: empty });
    const Page = timelinePage.component;

    render(<Page ctx={ctx} />);
    expect(screen.getByTestId('tl2-empty')).toHaveTextContent(empty.name);
    fireEvent.change(screen.getByTestId('rig-select'), { target: { value: 'roamy:starter' } });
    expect(ctx.chooseRig).toHaveBeenCalledWith('roamy:starter');
  });
});

describe('W4 fold: machines version watch (MEDIUM-3, LOW)', () => {
  it('parses a v prefix, a build suffix and a pre-release', () => {
    expect(parseVersion('v0.6.11')).toEqual([0, 6, 11]);
    expect(parseVersion('0.6.11-rc.1')).toEqual([0, 6, 11]);
    expect(parseVersion('0.6.6 (2620dea8)')).toEqual([0, 6, 6]);
    expect(parseVersion('latest')).toBeNull();
    expect(isPrerelease('0.6.11-rc.1')).toBe(true);
    expect(isPrerelease('0.6.11')).toBe(false);
  });

  it('a pre-release is behind its own release, and ahead of nothing', () => {
    expect(versionState('v0.6.11', '0.6.11')).toBe('current');
    expect(versionState('0.6.11-rc.1', '0.6.11')).toBe('behind');
    expect(behindWords('0.6.11-rc.1', '0.6.11')).toBe('a pre-release of the latest');
    expect(versionState('0.6.11', '0.6.11-rc.1')).toBe('ahead');
  });

  it('a major mismatch is said as a major, either way', () => {
    expect(versionState('1.0.0', '0.6.11')).toBe('ahead');
    expect(versionState('0.9.0', '1.0.0')).toBe('behind');
    expect(behindWords('0.9.0', '1.0.0')).toBe('major 0 vs 1');
  });

  it('the newest version is the highest one the fleet reports, never an invented number', () => {
    expect(newestVersion(['0.6.6', '0.6.13 (9eeb2e42)', null, '0.6.11'])).toBe('0.6.13 (9eeb2e42)');
    expect(newestVersion([null, undefined])).toBeNull();

    const fm = fleetMachine(snapshot('roamy'));

    fm.snapshot.sources.daemon.version = '0.6.1';
    expect(machineView(fm, 0, '0.6.13').version).toBe('behind');
    expect(machineView(fm, 0, null).version).toBe('unknown');
  });

  it('the panel compares machines with each other, not with a made-up latest', () => {
    const a = fleetMachine(snapshot('roamy'));

    a.snapshot.sources.daemon.version = '0.6.1';

    const b = fleetMachine(snapshot('m2'));

    b.snapshot.sources.daemon.version = '0.6.13';

    const Page = machinesPage.component;

    render(<Page ctx={ctxFor([a, b], { now: 0 })} />);
    expect(screen.getByTestId('mc2-watch')).toHaveTextContent('1 of 2 behind the newest (0.6.13)');
    expect(screen.getByTestId('mc2-watch')).not.toHaveTextContent('sample');
  });
});

describe('W4 fold: the Learn command list matches the brain copy', () => {
  // A summary of the brain file, written by `npm run rig-commands:sync` (the copy and the summary
  // are regenerated together, so a stale copy fails here).
  const brainPath = path.resolve(
    __dirname,
    '../../../test/fixtures/brain/rig-commands-summary.json'
  );

  it('version, count and curated count agree with the brain file', () => {
    const brain = JSON.parse(readFileSync(brainPath, 'utf8')) as {
      openrig_version: string;
      commands: { curated: boolean }[];
    };
    const copy = JSON.parse(
      readFileSync(path.resolve(__dirname, '../domain/learn/rig-commands.json'), 'utf8')
    ) as RigCommands;

    expect(copy.openrig_version).toBe(brain.openrig_version);
    expect(copy.commands.length).toBe(brain.commands.length);
    expect(copy.commands.filter((c) => c.curated).length).toBe(
      brain.commands.filter((c) => c.curated).length
    );
  });
});
