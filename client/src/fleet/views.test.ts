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
  endpointRig,
  consoleLines,
  flowChapters,
  flowModeOf,
  flowRange,
  isOpen,
  listRigs,
  median,
  mostHeadroom,
  plannedWord,
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

describe('D09 W2: planned lines from the rig spec', () => {
  const withEdges = (
    edges: { from: string; to: string; kind: string }[] | undefined,
    queue?: QueueItem[]
  ): FleetMachine => {
    const fm = m2();
    return {
      ...fm,
      snapshot: {
        ...fm.snapshot,
        rigs: fm.snapshot.rigs.map((r) => (r.name === 'fliedit-team' ? { ...r, edges } : r)),
        ...(queue ? { queue } : {}),
      },
    };
  };
  const SPEC = [
    { from: 'orch-lead@fliedit-team', to: 'dev-overlay@fliedit-team', kind: 'delegates_to' },
    { from: 'dev-overlay@fliedit-team', to: 'dev-qa@fliedit-team', kind: 'delegates_to' },
    { from: 'review-r1@fliedit-team', to: 'orch-lead@fliedit-team', kind: 'can_observe' },
    { from: 'dev-viewer@fliedit-team', to: 'nobody@elsewhere', kind: 'delegates_to' },
  ];

  it('with no handoffs yet, every seat-to-seat spec edge is a planned line with its kind', () => {
    const map = buildRigMap([withEdges(SPEC, [])], 'm2:fliedit-team')!;
    expect(map.edges).toEqual([]);
    expect(map.planned!.map((e) => [e.from, e.to, e.planned, e.count])).toEqual([
      ['m2/orch-lead@fliedit-team', 'm2/dev-overlay@fliedit-team', 'delegates_to', 0],
      ['m2/dev-overlay@fliedit-team', 'm2/dev-qa@fliedit-team', 'delegates_to', 0],
      ['m2/review-r1@fliedit-team', 'm2/orch-lead@fliedit-team', 'can_observe', 0],
    ]);
  });

  it('a real handoff on the same pair, same way, replaces the planned line', () => {
    const map = buildRigMap([withEdges(SPEC)], 'm2:fliedit-team')!;
    const real = new Set(map.edges.map((e) => `${e.from}→${e.to}`));
    expect(real.has('m2/review-r1@fliedit-team→m2/orch-lead@fliedit-team')).toBe(true);
    for (const p of map.planned!) expect(real.has(`${p.from}→${p.to}`)).toBe(false);
    expect(map.planned!.length).toBe(
      SPEC.slice(0, 3).filter((e) => !real.has(`m2/${e.from}→m2/${e.to}`)).length
    );
    // The handoff count is unchanged by planned lines.
    expect(map.edges.reduce((n, e) => n + e.count, 0)).toBe(map.handoffs);
  });

  it('a collector that does not send edges gives null (said on screen), [] gives none', () => {
    expect(buildRigMap([withEdges(undefined)], 'm2:fliedit-team')!.planned).toBeNull();
    expect(buildRigMap([withEdges([])], 'm2:fliedit-team')!.planned).toEqual([]);
  });

  it('two kinds on one pair make one line carrying both (QA W2 LOW-1)', () => {
    const both = [
      { from: 'orch-lead@fliedit-team', to: 'dev-qa@fliedit-team', kind: 'collaborates_with' },
      { from: 'orch-lead@fliedit-team', to: 'dev-qa@fliedit-team', kind: 'escalates_to' },
      { from: 'orch-lead@fliedit-team', to: 'dev-qa@fliedit-team', kind: 'escalates_to' },
    ];
    const map = buildRigMap([withEdges(both, [])], 'm2:fliedit-team')!;
    expect(map.planned!.map((e) => e.planned)).toEqual(['collaborates_with,escalates_to']);
    expect(plannedWord(map.planned![0]!.planned!)).toBe('collaborates with · escalates');
  });

  it('kinds read as words on the line', () => {
    expect(plannedWord('delegates_to')).toBe('delegates');
    expect(plannedWord('can_observe')).toBe('observes');
    expect(plannedWord('reports_to')).toBe('reports');
    expect(plannedWord('spawned_by')).toBe('spawned by');
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

  it('D15 UI-B: a rig with no lead seat marks its Lead stage "no lead", it is not just empty', () => {
    const fm = withAccount(m2(), undefined);
    fm.snapshot.queue = [
      q({ id: 'a', source: 'dev-build@x', destination: 'dev-qa@x' }),
      q({
        id: 'b',
        source: 'dev-qa@x',
        destination: 'dev-build@x',
        createdAt: '2026-10-09T10:10:00.000Z',
      }),
    ];
    const flow = buildFlow(fm, 'x', NOW, NOW)!;
    expect(flow.mode).toBe('roles');
    const lead = flow.stages.find((s) => s.stage === 'lead')!;
    expect(lead.noLead).toBe(true);
    expect(lead.label).toBe('Lead');
    expect(flow.stages.filter((s) => s.noLead)).toHaveLength(1);
    // no outside sender, so no outside box
    expect(flow.stages.map((s) => s.stage)).toEqual(['lead', 'build', 'qa', 'review']);
  });

  it('D15 UI-B: a rig WITH a lead does not mark it', () => {
    const fm = withAccount(m2(), undefined);
    fm.snapshot.queue = [
      q({ id: 'a', source: 'orch-lead@x', destination: 'dev-build@x' }),
      q({
        id: 'b',
        source: 'dev-build@x',
        destination: 'dev-qa@x',
        createdAt: '2026-10-09T10:10:00.000Z',
      }),
    ];
    const flow = buildFlow(fm, 'x', NOW, NOW)!;
    expect(flow.stages.find((s) => s.stage === 'lead')!.noLead).toBe(false);
  });

  it('D15 UI-B: senders from outside the rig get their own box at the left edge, not the Lead', () => {
    const fm = withAccount(m2(), undefined);
    fm.snapshot.queue = [
      q({ id: 'a', source: 'openrig-orch@kernel', destination: 'dev-build@x' }),
      q({
        id: 'b',
        source: 'human@host',
        destination: 'dev-build@x',
        createdAt: '2026-10-09T10:05:00.000Z',
      }),
      q({
        id: 'c',
        source: 'dev-build@x',
        destination: 'dev-qa@x',
        createdAt: '2026-10-09T10:10:00.000Z',
      }),
      q({
        id: 'd',
        source: 'dev-qa@x',
        destination: 'openrig-orch@kernel',
        createdAt: '2026-10-09T10:20:00.000Z',
      }),
    ];
    const flow = buildFlow(fm, 'x', NOW, NOW)!;
    expect(flow.stages.map((s) => s.stage)).toEqual(['outside', 'lead', 'build', 'qa', 'review']);
    const out = flow.stages[0]!;
    expect(out.label).toBe('From outside the rig');
    expect(out.outside).toBe(true);
    expect(out.noLead).toBe(false);
    // the lead stage received and sent nothing: both outside senders landed in the outside box
    expect(flow.edges.some((e) => e.from === 'lead' || e.to === 'lead')).toBe(false);
    const fromOutside = flow.edges.find((e) => e.from === 'outside' && e.to === 'build')!;
    expect(fromOutside.count).toBe(2);
    // a reply to the outside is not "sent back for rework"
    const reply = flow.edges.find((e) => e.from === 'qa' && e.to === 'outside')!;
    expect(reply.rework).toBe(false);
    expect(flow.rework).toBe(0);
    // the lead is still "by design": nothing in this rig acts as one
    expect(flow.stages.find((s) => s.stage === 'lead')!.noLead).toBe(true);
  });

  it("MEDIUM-4: in-rig addresses given as logical ids land in their seat's stage (no build→build self-edge)", () => {
    const fm = withAccount(m2(), undefined);
    const r = 'fliedit-team';
    fm.snapshot.queue = [
      q({ id: 'a', source: `orch.lead@${r}`, destination: `dev.overlay@${r}` }),
      q({
        id: 'b',
        source: `dev.overlay@${r}`,
        destination: `dev.qa@${r}`,
        createdAt: '2026-10-09T10:10:00.000Z',
      }),
      q({
        id: 'c',
        source: `dev.qa@${r}`,
        destination: `review.r1@${r}`,
        createdAt: '2026-10-09T10:20:00.000Z',
      }),
    ];
    const flow = buildFlow(fm, r, NOW, NOW)!;
    expect(flow.mode).toBe('roles');
    expect(flow.edges.map((e) => `${e.from}→${e.to}`).sort()).toEqual([
      'build→qa',
      'lead→build',
      'qa→review',
    ]);
    expect(flow.stages.find((s) => s.stage === 'qa')!.waiting + 0).toBeGreaterThanOrEqual(0);
    expect(flow.stages.find((s) => s.stage === 'lead')!.noLead).toBe(false);
    expect(flow.stages.some((s) => s.stage === 'outside')).toBe(false);
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

describe('F3 (truth #6): a rig reads as recent from its agents, not its terminals', () => {
  const TEN_MIN_AGO = new Date(NOW - 10 * 60_000).toISOString();
  const DAY_AGO = new Date(NOW - 24 * 3600_000).toISOString();
  const withSeats = (agentActivityAt: string | null | undefined): FleetMachine => {
    const fm = m2();
    const rig = { ...fm.snapshot.rigs[0]!, name: 'boss', recentAt: undefined };
    const s = {
      ...fm.snapshot.seats[0]!,
      id: 'orch-boss@boss',
      rig: 'boss',
      lastActivityAt: TEN_MIN_AGO,
      ...(agentActivityAt === undefined ? {} : { agentActivityAt }),
    };
    return { ...fm, snapshot: { ...fm.snapshot, rigs: [rig], seats: [s], queue: [] } };
  };
  const last = (fm: FleetMachine) => listRigs([fm]).find((r) => r.name === 'boss')!.lastActivity;

  it("orch-boss: a day-old transcript no longer reads as '10 min ago'", () => {
    expect(last(withSeats(DAY_AGO))).toBe(DAY_AGO);
  });
  it('no transcript (Codex, terminal): no agent activity, not the terminal stamp', () => {
    expect(last(withSeats(null))).toBeNull();
  });
  it('an older collector (field absent) keeps the terminal stamp', () => {
    expect(last(withSeats(undefined))).toBe(TEN_MIN_AGO);
  });
});

describe('F4 (r1 LOW-1): most headroom never picks a reading that is not current', () => {
  it('an asleep machine’s account, even with more room, loses to a current one', () => {
    const asleep = {
      ...withAccount(m2(), account({ email: 'x@e.com', fiveHourPct: 5, sevenDayPct: 5 })),
      liveness: 'asleep' as const,
    };
    const live = withAccount(
      roamy(),
      account({ email: 'y@e.com', fiveHourPct: 40, sevenDayPct: 40 })
    );
    expect(mostHeadroom(buildAccounts([asleep, live]).accounts, NOW)?.email).toBe('y@e.com');
  });
});

describe('ui-d-logical: the collector reports logicalId WITHOUT the @rig suffix', () => {
  // Real shape from the OpenRig daemon (/api/rigs/:id/nodes): logicalId `desk.planner`, rigName
  // `ylo-desk`. The queue address adds the rig: `desk.planner@ylo-desk`.
  const T = '2026-10-10T07:50:00.000Z';
  const setup = () => {
    const fm = m2();
    const home = fm.snapshot.seats.find((s) => s.rig === 'fliedit-team')!;
    const other = {
      ...home,
      id: 'd10-ai-powered-video-cuts',
      rig: 'ylo-desk',
      pod: 'desk',
      logicalId: 'desk.planner',
    };
    fm.snapshot.seats = [...fm.snapshot.seats, other];
    fm.snapshot.queue = [
      q({
        id: 'a',
        source: home.id,
        destination: 'desk.planner@ylo-desk',
        state: 'pending',
        createdAt: T,
      }),
      q({ id: 'b', source: home.id, destination: other.id, state: 'pending', createdAt: T }),
    ];
    return { fm, home, other };
  };

  it('resolves the full address and the session name to one endpoint key', () => {
    const { fm, other } = setup();
    const full = resolveEndpoint('desk.planner@ylo-desk', fm, [fm]);
    expect(full.key).toBe(resolveEndpoint(other.id, fm, [fm]).key);
    expect(full.seat?.id).toBe(other.id);
    expect(endpointRig(fm, 'desk.planner@ylo-desk')).toBe('ylo-desk');
  });

  it('draws one edge and has no Not placed lane', () => {
    const { fm, other } = setup();
    const map = buildRigMap([fm], 'm2:fliedit-team', NOW)!;
    expect(map.edges.filter((e) => e.to.endsWith(other.id))).toHaveLength(1);
    expect(map.lanes.some((l) => l.label === 'Not placed')).toBe(false);
  });
});

describe('ui-c-placed: one seat addressed by session name and by logical id', () => {
  const T = '2026-10-10T07:50:00.000Z';
  const setup = () => {
    const fm = m2();
    const home = fm.snapshot.seats.find((s) => s.rig === 'fliedit-team')!;
    const other = {
      ...home,
      id: 'd10-ai-powered-video-cuts',
      rig: 'ylo-desk',
      pod: 'desk',
      logicalId: 'desk.planner@ylo-desk',
    };
    fm.snapshot.seats = [...fm.snapshot.seats, other];
    const mk = (id: string, destination: string) =>
      q({ id, source: home.id, destination, state: 'pending', createdAt: T });
    fm.snapshot.queue = [
      mk('by-name', other.id),
      mk('by-logical', 'desk.planner@ylo-desk'),
      mk('by-logical-2', 'desk.planner@ylo-desk'),
    ];
    return { fm, home, other };
  };

  it('resolves both address forms to one endpoint key', () => {
    const { fm, other } = setup();
    const a = resolveEndpoint(other.id, fm, [fm]);
    const b = resolveEndpoint('desk.planner@ylo-desk', fm, [fm]);
    expect(b.key).toBe(a.key);
    expect(b.seat?.id).toBe(other.id);
    const rm = roamy();
    expect(resolveEndpoint('desk.planner@ylo-desk', rm, [rm, fm]).machineId).toBe('m2');
  });

  it('merges edges, draws one box under its real pod, and places it', () => {
    const { fm, other } = setup();
    const map = buildRigMap([fm], 'm2:fliedit-team', NOW)!;
    const edges = map.edges.filter((e) => e.to.endsWith(other.id));
    expect(edges).toHaveLength(1);
    expect(edges[0]!.count).toBe(3);
    expect(map.lanes.some((l) => l.label === 'Not placed')).toBe(false);
    const outside = map.lanes.slice(1).flatMap((l) => l.pods);
    expect(outside.map((p) => p.name)).toEqual(['desk']);
    expect(outside.flatMap((p) => p.seats)).toHaveLength(1);
  });

  it('takes the rig from the seat for a logical id, not from its @suffix', () => {
    const { fm, other } = setup();
    other.logicalId = 'desk.planner@x';
    expect(endpointRig(fm, 'desk.planner@x')).toBe('ylo-desk');
  });

  it('two other machines carrying the same logical id: the live one wins, else unplaced', () => {
    const { fm, other } = setup();
    const a = roamy();
    const b = m2();
    b.machine = { ...b.machine, id: 'm2b' };
    b.snapshot = { ...b.snapshot, seats: [{ ...other, id: 'twin' }] };
    a.snapshot = { ...a.snapshot, seats: [{ ...other, id: 'twin2' }] };
    const home = { ...fm, snapshot: { ...fm.snapshot, seats: [] } };
    const both = resolveEndpoint('desk.planner@ylo-desk', home, [home, a, b]);
    expect(both.key.startsWith('?/')).toBe(true);
    b.liveness = 'asleep';
    const one = resolveEndpoint('desk.planner@ylo-desk', home, [home, a, b]);
    expect(one.machineId).toBe(a.machine.id);
    a.liveness = 'asleep';
    expect(resolveEndpoint('desk.planner@ylo-desk', home, [home, a, b]).seat).toBeNull();
  });

  it('a full logical-id match beats reading the string as name@machineId', () => {
    const { fm, other } = setup();
    const home = roamy();
    home.snapshot = {
      ...home.snapshot,
      seats: [{ ...other, id: 'real-seat', logicalId: 'orch@m2' }],
    };
    const ep = resolveEndpoint('orch@m2', home, [home, fm]);
    expect(ep.seat?.id).toBe('real-seat');
    expect(ep.machineId).toBe(home.machine.id);
  });

  it('regression guard: a truly unknown name still falls back to POD seats', () => {
    const { fm, home } = setup();
    fm.snapshot.queue = [
      q({ id: 'g', source: home.id, destination: 'ghost', state: 'pending', createdAt: T }),
    ];
    const map = buildRigMap([fm], 'm2:fliedit-team', NOW)!;
    const np = map.lanes.find((l) => l.label === 'Not placed')!;
    expect(np.pods.map((p) => p.name)).toEqual(['seats']);
  });
});
