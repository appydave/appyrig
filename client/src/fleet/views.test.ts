import { describe, expect, it } from 'vitest';
import type {
  AccountDerived,
  AccountUsage,
  AccountWindow,
  FleetMachine,
  QueueItem,
} from '@appydave/shared';
import { windowStory } from './accountWindow.js';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import {
  buildAccounts,
  buildFlow,
  buildRigMap,
  consoleLines,
  flowChapters,
  flowModeOf,
  flowRange,
  isOpen,
  listRigs,
  median,
  mostHeadroom,
  resetsIn,
  resolveEndpoint,
  replaySteps,
  rigQueue,
  stageOf,
  STALE_MS,
  rigState,
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
  it('S3: lists every rig on every machine, running first, then most recent', () => {
    const rigs = listRigs([m2(), roamy()]);
    expect(rigs.map((r) => r.key)).toContain('roamy:starter');
    const firstStopped = rigs.findIndex((r) => r.status !== 'running');
    if (firstStopped >= 0) {
      expect(rigs.slice(firstStopped).every((r) => r.status !== 'running')).toBe(true);
    }
    for (const part of [
      rigs.filter((r) => r.status === 'running'),
      rigs.filter((r) => r.status !== 'running'),
    ]) {
      const at = part.map((r) => r.lastActivity ?? '');
      expect(at).toEqual([...at].sort().reverse());
    }
    const fliedit = rigs.find((r) => r.key === 'm2:fliedit-team')!;
    expect(fliedit.handoffs).toBe(rigQueue(m2(), 'fliedit-team').length);
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

  it('splits open items into fresh (amber) and stale (dashed)', () => {
    const fm = m2();
    const rig = 'fliedit-team';
    const seat = fm.snapshot.seats.find((s) => s.rig === rig)!;
    const created = '2026-10-10T07:50:00.000Z';
    fm.snapshot.queue = [
      ...fm.snapshot.queue,
      q({
        id: 'fresh',
        source: 'x@' + rig,
        destination: seat.id,
        state: 'pending',
        createdAt: created,
      }),
      q({
        id: 'stale',
        source: 'x@' + rig,
        destination: seat.id,
        state: 'pending',
        createdAt: '2026-10-09T07:50:00.000Z',
      }),
    ];
    const map = buildRigMap([fm], `m2:${rig}`, NOW)!;
    const edge = map.edges.find((e) => e.from.endsWith('x@' + rig) && e.to.endsWith(seat.id))!;
    expect(edge.open).toBe(1);
    expect(edge.stale).toBe(1);
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

  it('an item left open past STALE_MS is "left open", never the bottleneck', () => {
    const fm = withAccount(m2(), undefined);
    fm.snapshot.queue = [
      q({
        id: 'old',
        source: 'boss@x',
        destination: 'orch-lead@x',
        state: 'pending',
        createdAt: '2026-10-09T10:00:00.000Z',
        updatedAt: '2026-10-09T10:00:00.000Z',
      }),
      q({ id: 'qa', source: 'dev-build@x', destination: 'dev-qa@x' }),
    ];
    const later = Date.parse('2026-10-09T10:00:00.000Z') + STALE_MS + 60_000;
    const flow = buildFlow(fm, 'x', later, later)!;
    const lead = flow.stages.find((s) => s.stage === 'lead')!;
    expect(lead.waiting).toBe(0);
    expect(lead.stale).toBe(1);
    expect(flow.bottleneck).toBeNull();
  });

  it('a team with no QA or review seat gets one box per seat, in first-handoff order', () => {
    expect(flowModeOf(['orch-lead', 'dev-build', 'dev-qa'])).toBe('roles');
    expect(flowModeOf(['research-scout', 'research-checker'])).toBe('seats');
    const fm = withAccount(m2(), undefined);
    fm.snapshot.queue = [
      q({
        id: 'a',
        source: 'research-scout@sr',
        destination: 'research-checker@sr',
        createdAt: '2026-10-09T10:00:00.000Z',
      }),
      q({
        id: 'b',
        source: 'research-checker@sr',
        destination: 'research-scout@sr',
        createdAt: '2026-10-09T10:10:00.000Z',
      }),
    ];
    const flow = buildFlow(fm, 'sr', NOW, NOW)!;
    expect(flow.mode).toBe('seats');
    expect(flow.stages.map((s) => s.stage)).toEqual(['research-scout', 'research-checker']);
    expect(flow.rework).toBe(0);
    expect(flow.edges.every((e) => !e.rework)).toBe(true);
  });

  it('no queue rows → no flow', () => {
    const fm = m2();
    fm.snapshot.queue = [];
    expect(buildFlow(fm, 'fliedit-team', NOW, NOW)).toBeNull();
  });
});

describe('Replay chapters', () => {
  it('finds start, first rework and end in a real run, in time order', () => {
    const ch = flowChapters(m2(), 'fliedit-team', NOW);
    const kinds = ch.map((c) => c.kind);
    expect(kinds[0]).toBe('start');
    expect(kinds.at(-1)).toBe('end');
    expect(kinds).toContain('first-rework');
    expect(ch.map((c) => c.at)).toEqual([...ch.map((c) => c.at)].sort((a, b) => a - b));
    expect(ch.find((c) => c.kind === 'end')!.text).toMatch(/handoffs/);
  });

  it('a rig with no queue has no chapters', () => {
    const fm = m2();
    fm.snapshot.queue = [];
    expect(flowChapters(fm, 'fliedit-team', NOW)).toEqual([]);
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

describe('Replay consoles', () => {
  const items = [
    q({
      id: '1',
      source: 'orch-lead@x',
      destination: 'dev-hub@x',
      summary: 'build the hub',
      createdAt: '2026-10-09T10:00:00.000Z',
    }),
    q({
      id: '2',
      source: 'dev-hub@x',
      destination: 'dev-qa@x',
      summary: 'ready for QA',
      createdAt: '2026-10-09T10:30:00.000Z',
    }),
    q({
      id: '3',
      source: 'dev-qa@x',
      destination: 'review-r1@x',
      summary: 'pass',
      createdAt: '2026-10-09T10:40:00.000Z',
    }),
  ];

  it('a seat sees what it received and sent up to the replay time, merged with its transcript', () => {
    const history = [
      { at: '2026-10-09T10:05:00.000Z', kind: 'reply' as const, text: 'Starting on the hub.' },
      { at: '2026-10-09T10:45:00.000Z', kind: 'tool' as const, text: 'Bash: npm test' },
    ];
    const at = Date.parse('2026-10-09T10:35:00.000Z');
    const lines = consoleLines('dev-hub', 'x', items, history, at);
    expect(lines.map((l) => l.kind)).toEqual(['received', 'reply', 'sent']);
    expect(lines[0]!.text).toBe('← orch-lead: build the hub');
    expect(lines[2]!.text).toBe('→ dev-qa: ready for QA');
  });

  it('without history a console still shows the handoff messages', () => {
    const lines = consoleLines('dev-qa', 'x', items, null, Date.parse('2026-10-09T11:00:00.000Z'));
    expect(lines.map((l) => l.text)).toEqual(['← dev-hub: ready for QA', '→ review-r1: pass']);
  });

  it('replay steps are the handoffs in time order', () => {
    const fm = withAccount(m2(), undefined);
    fm.snapshot.queue = [items[2]!, items[0]!, items[1]!];
    expect(replaySteps(fm, 'x').map((i) => i.id)).toEqual(['1', '2', '3']);
  });
});

describe('B2 rigState (fb-0001): follows rig ps', () => {
  it('asleep machine > stopped > attention (blocked or ATTN) > working > idle', () => {
    expect(rigState('asleep', 'running', 0, ['working'])).toBe('asleep');
    expect(rigState('live', 'stopped', 2, ['blocked'])).toBe('stopped');
    expect(rigState('live', 'running', 1, ['idle'])).toBe('attention');
    expect(rigState('live', 'running', 0, ['working', 'blocked'])).toBe('attention');
    expect(rigState('live', 'running', 0, ['idle', 'working'])).toBe('working');
    expect(rigState('live', 'running', 0, ['idle', 'stopped'])).toBe('idle');
    expect(rigState('live', 'running', 0, [])).toBe('idle');
  });

  it('every listed rig carries a state', () => {
    for (const r of listRigs([fleetMachine(snapshot('m2'))])) expect(r.state).toMatch(/\w/);
  });
});

describe('B3 (fb-0006): the median stat as one plain sentence', () => {
  it('names the count and says it is a median, not a grade', async () => {
    const { medianSentence } = await import('../components/HandoffFlow.js');
    expect(medianSentence(3.1, 12)).toBe(
      'Of the 12 handoffs closed so far, half were closed within 3.1 minutes of being handed over and half took longer (the median, the middle value). It is not a grade: there are no thresholds. Handoffs still open are not counted; they show as waiting or left open.'
    );
    expect(medianSentence(0.4, 3)).toContain('within 24 seconds');
    expect(medianSentence(5, 1)).toBe(
      'The one handoff closed so far took 5.0 minutes from being handed over to being closed.'
    );
    expect(medianSentence(null, 0)).toMatch(/No handoff in this rig has been closed yet/);
  });

  it('buildFlow reports how many closed handoffs the median covers', () => {
    const fm = fleetMachine(snapshot('m2'));
    const rig = listRigs([fm]).find((r) => r.handoffs > 0)!;
    const flow = buildFlow(fm, rig.name, Date.now(), Date.now());
    expect(flow?.closedCount).toBeGreaterThanOrEqual(0);
    if (flow && flow.closedCount > 0) expect(flow.medianTurnaroundMin).not.toBeNull();
  });
});

describe('r1 HIGH-1: a Map line lists its handoffs oldest first, so "latest" is the newest', () => {
  it('sorts each line by time, whatever order the collector delivered', () => {
    const fm = fleetMachine(snapshot('m2'));
    const map = buildRigMap([fm], `m2:${fm.snapshot.rigs[0]!.name}`, Date.now())!;
    for (const e of map.edges) {
      const at = e.items.map((q) => q.createdAt);
      expect(at, `${e.from}→${e.to}`).toEqual([...at].sort());
    }
    // the probe's case: three items delivered newest first
    const line = map.edges.find((e) => e.items.length >= 2);
    if (line) {
      const newest = [...line.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!;
      expect(line.items[line.items.length - 1]!.id).toBe(newest.id);
    }
  });
});

describe('F1 · handoffs attach to the rig doing the work (truth E1)', () => {
  // A hand-built M2/M4: the stopped kernel rig (its real seats), the v15 team, and two rigs on one
  // machine handing work across (planner@ylo-desk → ylo-lead@ylo-thumbs). human@kernel is David's
  // mailbox, not a kernel seat.
  const base = m2();
  const tmpl = base.snapshot.seats[0]!;
  const seat = (id: string, rig: string, pod: string | null = null) => ({
    ...tmpl,
    id,
    rig,
    pod,
    logicalId: id.split('@')[0]!,
  });
  const rigSum = (name: string, status = 'running') => ({
    ...base.snapshot.rigs[0]!,
    id: `id-${name}`,
    name,
    status,
  });
  const fm: FleetMachine = {
    ...base,
    snapshot: {
      ...base.snapshot,
      rigs: [
        rigSum('kernel', 'stopped'),
        rigSum('appyrig-v15-loadout'),
        rigSum('ylo-desk'),
        rigSum('ylo-thumbs'),
      ],
      seats: [
        seat('advisor-lead@kernel', 'kernel'),
        seat('queue-worker@kernel', 'kernel'),
        seat('dev-build@appyrig-v15-loadout', 'appyrig-v15-loadout', 'dev'),
        seat('dev-qa@appyrig-v15-loadout', 'appyrig-v15-loadout', 'dev'),
        seat('planner@ylo-desk', 'ylo-desk'),
        seat('ylo-lead@ylo-thumbs', 'ylo-thumbs', 'lead'),
        seat('ylo-art@ylo-thumbs', 'ylo-thumbs', 'dev'),
      ],
      queue: [
        q({ id: 'h1', source: 'human@kernel', destination: 'dev-build@appyrig-v15-loadout' }),
        q({
          id: 'h2',
          source: 'dev-build@appyrig-v15-loadout',
          destination: 'dev-qa@appyrig-v15-loadout',
        }),
        q({ id: 'h3', source: 'dev-qa@appyrig-v15-loadout', destination: 'human@kernel' }),
        q({
          id: 'x1',
          source: 'planner@ylo-desk',
          destination: 'ylo-lead@ylo-thumbs',
          state: 'pending',
          createdAt: new Date(NOW - 60_000).toISOString(),
        }),
        q({ id: 'x2', source: 'ylo-lead@ylo-thumbs', destination: 'ylo-art@ylo-thumbs' }),
        q({ id: 'k1', source: 'queue-worker@kernel', destination: 'advisor-lead@kernel' }),
      ],
    },
  };
  const ids = (items: QueueItem[]) => items.map((i) => i.id).sort();
  const rig = (name: string) => listRigs([fm]).find((r) => r.name === name)!;

  it('human@kernel is a mailbox: the kernel rig keeps only its own seats’ items', () => {
    expect(ids(rigQueue(fm, 'kernel'))).toEqual(['k1']);
    expect(rig('kernel').handoffs).toBe(1);
    expect(ids(rigQueue(fm, 'appyrig-v15-loadout'))).toEqual(['h1', 'h2', 'h3']);
    expect(rig('appyrig-v15-loadout').handoffs).toBe(3);
  });

  it('rig totals add up to the distinct item count (no double count across rigs)', () => {
    const total = listRigs([fm]).reduce((n, r) => n + r.handoffs, 0);
    expect(total).toBe(fm.snapshot.queue.length);
    // The cross-rig item counts on the rig doing the work, and shows on the sender's as outgoing.
    expect(rig('ylo-thumbs').handoffs).toBe(2);
    expect(rig('ylo-desk').handoffs).toBe(0);
    expect(ids(rigQueue(fm, 'ylo-desk'))).toEqual(['x1']);
  });

  it('a cross-rig item lands on the destination rig, the source drawn as an outside box with a line in', () => {
    const map = buildRigMap([fm], rig('ylo-thumbs').key, NOW)!;
    expect(map.handoffs).toBe(2);
    const outside = map.lanes.slice(1).flatMap((l) => l.pods.flatMap((p) => p.seats));
    const planner = outside.find((s) => s.name === 'planner')!;
    expect(planner).toBeDefined();
    expect(map.lanes[0]!.pods.flatMap((p) => p.seats).map((s) => s.name)).not.toContain('planner');
    const lead = map.lanes[0]!.pods.flatMap((p) => p.seats).find((s) => s.name === 'ylo-lead')!;
    const line = map.edges.find((e) => e.from === planner.key && e.to === lead.key)!;
    expect(line.items.map((i) => i.id)).toEqual(['x1']);
    expect(lead.open).toBe(1);
    // The Handoff Flow shows it too: planner as a node outside this rig.
    const flow = buildFlow(fm, 'ylo-thumbs', NOW, NOW)!;
    expect(flow.total).toBe(2);
    // On the sender's map it is an outgoing line, not part of its total.
    const desk = buildRigMap([fm], rig('ylo-desk').key, NOW)!;
    expect(desk.handoffs).toBe(0);
    expect(desk.outgoing).toBe(1);
  });

  it('the stopped kernel rig no longer takes the v15 team’s handoff times as its own', () => {
    const map = buildRigMap([fm], rig('kernel').key, NOW)!;
    expect(map.edges.flatMap((e) => e.items.map((i) => i.id))).toEqual(['k1']);
  });
});

describe('D0 · most headroom weighs the weekly window (usability T4-3)', () => {
  const win = (
    usedPct: number,
    elapsedPct: number,
    windowMs: number,
    resetsAt: string
  ): AccountWindow => ({
    status: 'reading',
    usedPct,
    resetsAt,
    windowMs,
    startsAt: new Date(Date.parse(resetsAt) - windowMs).toISOString(),
    elapsedPct,
    elapsedNowPct: elapsedPct,
    paceDeltaPct: usedPct - elapsedPct,
    projectedPct: Math.round((usedPct / elapsedPct) * 100),
  });
  const H5 = 5 * 3600_000;
  const D7 = 7 * 86400_000;
  const derived = (five: AccountWindow, seven: AccountWindow): AccountDerived => ({
    tier: { label: 'Max $200', source: 'config' },
    asOf: new Date(NOW).toISOString(),
    readingFrom: 'm2',
    sampleAgeMs: 60_000,
    fiveHour: five,
    sevenDay: seven,
    monthly: { status: 'not-reported' },
  });
  const R5 = new Date(NOW + 0.68 * H5).toISOString();
  const R7 = new Date(NOW + 0.19 * D7).toISOString();

  it('T4-3: appydave (5-hour 5%, weekly "be careful") loses to ideasmen (weekly 40% left)', () => {
    const appydave = withAccount(
      roamy(),
      account({
        email: 'david@appydave.com',
        fiveHourPct: 5,
        sevenDayPct: 78,
        derived: derived(win(5, 32, H5, R5), win(78, 81, D7, R7)),
      })
    );
    const ideasmen = withAccount(
      m2(),
      account({
        email: 'david@ideasmen.com.au',
        fiveHourPct: 11,
        sevenDayPct: 60,
        derived: derived(win(11, 32, H5, R5), win(60, 81, D7, R7)),
      })
    );
    const { accounts } = buildAccounts([appydave, ideasmen]);
    const weekly = accounts.find((a) => a.email === 'david@appydave.com')!.derived!.sevenDay;
    expect(windowStory(weekly, NOW).kind).toBe('careful');
    expect(mostHeadroom(accounts, NOW)?.email).toBe('david@ideasmen.com.au');
  });

  it('with no warning on either side, the less-used tighter window wins', () => {
    const x = withAccount(m2(), account({ email: 'x@e.com', fiveHourPct: 10, sevenDayPct: 70 }));
    const y = withAccount(roamy(), account({ email: 'y@e.com', fiveHourPct: 30, sevenDayPct: 35 }));
    expect(mostHeadroom(buildAccounts([x, y]).accounts, NOW)?.email).toBe('y@e.com');
  });
});
