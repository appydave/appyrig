import { describe, expect, it } from 'vitest';
import type { AccountUsage, FleetMachine, QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import {
  buildAccounts,
  buildFlow,
  buildRigMap,
  flowRange,
  isOpen,
  listRigs,
  median,
  mostHeadroom,
  resetsIn,
  resolveEndpoint,
  rigQueue,
  stageOf,
} from './views.js';

const NOW = Date.parse('2026-10-10T08:00:00.000Z');
const m2 = () => fleetMachine(snapshot('m2'));
const roamy = () => fleetMachine(snapshot('roamy'));

const q = (over: Partial<QueueItem>): QueueItem => ({
  id: over.id ?? 'q1',
  source: 'orch-lead@x',
  destination: 'dev-build@x',
  state: 'done',
  priority: null,
  tags: [],
  summary: null,
  createdAt: '2026-10-09T10:00:00.000Z',
  updatedAt: '2026-10-09T10:05:00.000Z',
  ...over,
});

const account = (over: Partial<AccountUsage>): AccountUsage => ({
  email: 'a@example.com',
  plan: 'claude_max',
  fiveHourPct: 40,
  fiveHourResetsAt: '2026-10-10T09:00:00.000Z',
  sevenDayPct: 30,
  sevenDayResetsAt: '2026-10-12T20:00:00.000Z',
  sampledAt: '2026-10-10T07:59:00.000Z',
  ...over,
});

const withAccount = (fm: FleetMachine, acct: AccountUsage | null | undefined): FleetMachine => ({
  ...fm,
  snapshot: { ...fm.snapshot, account: acct },
});

describe('queue basics', () => {
  it('handed-off and done are closed; pending, in-progress and unknown states are open', () => {
    expect(isOpen(q({ state: 'done' }))).toBe(false);
    expect(isOpen(q({ state: 'handed-off' }))).toBe(false);
    expect(isOpen(q({ state: 'pending' }))).toBe(true);
    expect(isOpen(q({ state: 'in-progress' }))).toBe(true);
    expect(isOpen(q({ state: 'something-new' }))).toBe(true);
  });

  it('stages follow the seat-name convention', () => {
    expect(stageOf('orch-lead')).toBe('lead');
    expect(stageOf('orch-boss')).toBe('lead');
    expect(stageOf('dev-collector')).toBe('build');
    expect(stageOf('dev-qa-backend')).toBe('qa');
    expect(stageOf('dev-qa')).toBe('qa');
    expect(stageOf('review-r1')).toBe('review');
    expect(stageOf('dev-review')).toBe('review');
  });

  it('median of odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('listRigs', () => {
  it('lists every rig on every machine, most recent activity first', () => {
    const rigs = listRigs([m2(), roamy()]);
    expect(rigs.map((r) => r.key)).toContain('roamy:starter');
    const latest = rigs
      .map((r) => r.lastActivity ?? '')
      .sort()
      .at(-1);
    expect(rigs[0]!.lastActivity).toBe(latest);
    const fliedit = rigs.find((r) => r.key === 'm2:fliedit-team')!;
    expect(fliedit.handoffs).toBe(rigQueue(m2(), 'fliedit-team').length);
    const empty = rigs.filter((r) => r.handoffs === 0);
    // Rigs with no handoffs sort after every rig that has some.
    expect(rigs.slice(rigs.length - empty.length).every((r) => r.handoffs === 0)).toBe(true);
  });
});

describe('Rig Map', () => {
  it('puts the rig seats in pods on their machine, with edges counted from the queue', () => {
    const map = buildRigMap([m2(), roamy()], 'm2:fliedit-team')!;
    expect(map.lanes[0]!.label).toBe('M2');
    const pods = map.lanes[0]!.pods.map((p) => p.name);
    expect(pods.indexOf('orch')).toBeLessThan(pods.indexOf('dev'));
    const total = map.edges.reduce((n, e) => n + e.count, 0);
    expect(total).toBe(map.handoffs);
    const verdicts = map.edges.find(
      (e) => e.from === 'm2/review-r1@fliedit-team' && e.to === 'm2/orch-lead@fliedit-team'
    );
    expect(verdicts?.count).toBe(21);
  });

  it('resolves another machine by name@machine, and leaves unknown names unplaced', () => {
    const [home, other] = [m2(), roamy()];
    const seat = other.snapshot.seats[0]!;
    const name = seat.id.split('@')[0]!;
    const ep = resolveEndpoint(`${name}@roamy`, home, [home, other]);
    expect(ep.machineId).toBe('roamy');
    expect(resolveEndpoint('ghost@nowhere', home, [home, other]).key).toBe('?/ghost@nowhere');
  });

  it('returns null for a rig nobody reports', () => {
    expect(buildRigMap([m2()], 'm2:no-such-rig')).toBeNull();
  });
});

describe('Handoff Flow', () => {
  it('at the end of a run: all handoffs counted, rework is QA/review sending back to builders', () => {
    const fm = m2();
    const range = flowRange(rigQueue(fm, 'fliedit-team'))!;
    const flow = buildFlow(fm, 'fliedit-team', range.end, NOW)!;
    expect(flow.total).toBe(rigQueue(fm, 'fliedit-team').length);
    const back = flow.edges.filter((e) => e.rework);
    expect(back.length).toBeGreaterThan(0);
    expect(back.every((e) => e.to === 'build' || e.to === 'qa')).toBe(true);
    expect(flow.rework).toBe(back.reduce((n, e) => n + e.count, 0));
  });

  it('replaying to the start shows only what had happened by then', () => {
    const fm = m2();
    const range = flowRange(rigQueue(fm, 'fliedit-team'))!;
    const flow = buildFlow(fm, 'fliedit-team', range.start, NOW)!;
    expect(flow.total).toBeGreaterThanOrEqual(1);
    expect(flow.total).toBeLessThan(rigQueue(fm, 'fliedit-team').length);
  });

  it('an item is in flight between its handoff and its close, and waits at its destination', () => {
    const fm = withAccount(m2(), undefined);
    fm.snapshot.queue = [
      q({
        id: 'a',
        source: 'dev-build@x',
        destination: 'dev-qa@x',
        createdAt: '2026-10-09T10:00:00.000Z',
        updatedAt: '2026-10-09T10:20:00.000Z',
      }),
    ];
    const mid = buildFlow(fm, 'x', Date.parse('2026-10-09T10:10:00.000Z'), NOW)!;
    expect(mid.edges[0]!.inFlight.map((i) => i.id)).toEqual(['a']);
    expect(mid.stages.find((s) => s.stage === 'qa')!.waiting).toBe(1);
    expect(mid.bottleneck).toBe('qa');
    const after = buildFlow(fm, 'x', Date.parse('2026-10-09T10:30:00.000Z'), NOW)!;
    expect(after.edges[0]!.inFlight).toEqual([]);
    expect(after.medianTurnaroundMin).toBe(20);
  });

  it('no queue rows → no flow', () => {
    const fm = m2();
    fm.snapshot.queue = [];
    expect(buildFlow(fm, 'fliedit-team', NOW, NOW)).toBeNull();
  });
});

describe('Accounts', () => {
  it('groups machines by account; the freshest reading wins; old collectors are named', () => {
    const a = withAccount(
      m2(),
      account({ sampledAt: '2026-10-10T07:00:00.000Z', fiveHourPct: 10 })
    );
    const b = withAccount(
      { ...roamy(), machine: { id: 'm4', label: 'M4', hostname: null } },
      account({ fiveHourPct: 25 })
    );
    const old = withAccount(
      { ...roamy(), machine: { id: 'old', label: 'Old', hostname: null } },
      undefined
    );
    const none = withAccount(
      { ...roamy(), machine: { id: 'nl', label: 'NoLogin', hostname: null } },
      null
    );
    const { accounts, unknown } = buildAccounts([a, b, old, none]);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.machines).toEqual(['M2', 'M4']);
    expect(accounts[0]!.reading?.fiveHourPct).toBe(25);
    expect(accounts[0]!.reading?.from).toBe('M4');
    expect(accounts[0]!.planLabel).toMatch(/Max/);
    expect(unknown).toEqual([
      { label: 'Old', reason: 'old-collector' },
      { label: 'NoLogin', reason: 'no-login' },
    ]);
  });

  it('a machine with a login but no sampler gives no reading, never 0%', () => {
    const fm = withAccount(
      m2(),
      account({ fiveHourPct: null, sevenDayPct: null, sampledAt: null })
    );
    const { accounts } = buildAccounts([fm]);
    expect(accounts[0]!.reading).toBeNull();
  });

  it('most headroom = lowest 5-hour use among accounts with a reading', () => {
    const x = withAccount(m2(), account({ email: 'x@e.com', fiveHourPct: 80 }));
    const y = withAccount(roamy(), account({ email: 'y@e.com', fiveHourPct: 15 }));
    expect(mostHeadroom(buildAccounts([x, y]).accounts)?.email).toBe('y@e.com');
  });

  it('reset times read as plain durations', () => {
    expect(resetsIn('2026-10-10T09:30:00.000Z', NOW)).toBe('in 1h 30m');
    expect(resetsIn('2026-10-12T20:00:00.000Z', NOW)).toBe('in 2d 12h');
    expect(resetsIn('2026-10-10T07:00:00.000Z', NOW)).toBe('now');
    expect(resetsIn(null, NOW)).toBeNull();
  });
});
