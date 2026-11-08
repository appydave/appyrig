import { describe, expect, it } from 'vitest';
import type { FleetMachine, QueueItem, Seat } from '@appydave/shared';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { buildRun } from './model.js';
import { parseMissionJobs } from './jobs.js';

const NOW = Date.parse('2026-10-19T12:00:00.000Z');
const RIG = 'fliedit-team';
const T = (min: number) => new Date(NOW - min * 60_000).toISOString();
const JOBS = parseMissionJobs(
  [
    '## Jobs, in run order',
    '| Slice | Repo | Worktree | Branch | Spec source |',
    '|---|---|---|---|---|',
    '| 1 | R1 | `/w/1` | `b/1` | `/s/1.md` |',
    '| 2 | R2 | `/w/2` | `b/2` | `/s/2.md` |',
  ].join('\n')
);

/** `item('id src>dst minutesAgo state?', tags)`: one handoff, `done` unless the state says otherwise. */
const item = (spec: string, tags: string[]) => {
  const [id, route, min, state = 'done'] = spec.split(' ') as [string, string, string, string?];
  const [src, dst] = route.split('>') as [string, string];

  return {
    id,
    source: `${src}@${RIG}`,
    destination: `${dst}@${RIG}`,
    state,
    priority: null,
    tags,
    summary: id,
    createdAt: T(Number(min)),
    updatedAt: T(Number(min) - 1),
  } satisfies QueueItem;
};

const base = snapshot('m2').seats[0]!;
const seat = (name: string, status: Seat['status'], lines: string[] | null = null): Seat => ({
  ...base,
  id: `${name}@${RIG}`,
  rig: RIG,
  status,
  tail: lines ? { ansi: false, capturedAt: T(0), lines } : null,
});

function machine(queue: QueueItem[], seats: Seat[] = [], liveness: 'live' | 'asleep' = 'live') {
  const m: FleetMachine = fleetMachine(snapshot('m2'), { liveness });

  m.snapshot = { ...m.snapshot, queue, seats };

  return m;
}

const run = (queue: QueueItem[], seats: Seat[] = [], liveness: 'live' | 'asleep' = 'live') =>
  buildRun(machine(queue, seats, liveness), RIG, JOBS, NOW, 'm1');

describe('a job: who holds it and how long it took', () => {
  it('holder is the receiver of the newest OPEN item, not of the newest item', () => {
    const r = run([
      item('a lead>dev-build 30 pending', ['mission:m1', 'slice:1']),
      item('b dev-build>dev-qa 20 done', ['mission:m1', 'slice:1']),
    ]);

    expect(r.jobs[0]!.holder).toBe('dev-build');
  });

  it('with nothing open, holder is the receiver of the newest item; with no items, null', () => {
    const r = run([
      item('a lead>dev-build 30', ['mission:m1', 'slice:1']),
      item('b dev-build>dev-qa 20', ['mission:m1', 'slice:1']),
    ]);

    expect(r.jobs[0]!.holder).toBe('dev-qa');
    expect(r.jobs[1]!.holder).toBeNull();
    expect(r.jobs[1]!.durationMs).toBeNull();
  });

  it('a running job lasts until now; an accepted one until its accept item was updated', () => {
    const open = run([item('a lead>dev-build 30 pending', ['mission:m1', 'slice:1'])]);

    expect(open.jobs[0]!.durationMs).toBe(30 * 60_000);

    const accepted = run([
      item('a lead>dev-build 30', ['mission:m1', 'slice:1']),
      item('b review-r1>dev-build 10', ['mission:m1', 'slice:1', 'verdict:accept']),
    ]);

    expect(accepted.jobs[0]!.status).toBe('done');
    expect(accepted.jobs[0]!.durationMs).toBe(21 * 60_000);
  });

  it('done only by a later job starting (no verdict tags) runs to now, and never goes negative', () => {
    const r = run([
      item('a lead>dev-build 30', ['mission:m1', 'slice:1']),
      item('b lead>dev-build 20 pending', ['mission:m1', 'slice:2']),
    ]);

    expect(r.jobs[0]!.status).toBe('done');
    expect(r.jobs[0]!.durationMs).toBe(30 * 60_000);

    const future = run([item('a lead>dev-build -5 pending', ['mission:m1', 'slice:1'])]);

    expect(future.jobs[0]!.durationMs).toBe(0);
  });

  it('with no verdict tags, a job with no items is not done even when a later job started', () => {
    const r = run([item('b lead>dev-build 20 pending', ['mission:m1', 'slice:2'])]);

    expect(r.jobs.map((j) => j.status)).toEqual(['current', 'waiting']);
  });

  it('with verdict tags, a job is done only once one of its items is accepted', () => {
    const r = run([
      item('a lead>dev-build 30', ['mission:m1', 'slice:1', 'verdict:pass']),
      item('b lead>dev-build 20 pending', ['mission:m1', 'slice:2']),
    ]);

    expect(r.jobs.map((j) => j.status)).toEqual(['current', 'waiting']);
  });
});

describe('a station: working, blocked, waiting or idle', () => {
  const queue = [item('a lead>dev-qa 30 pending', ['mission:m1', 'slice:1'])];
  const lines = ['old', '\u001b[32mgreen line\u001b[0m', '   '];
  const seats = [
    seat('dev-build', 'working', lines),
    seat('dev-qa', 'idle', lines),
    seat('review-r1', 'blocked', lines),
    seat('orch-lead', 'stopped', lines),
  ];
  const by = (r: ReturnType<typeof run>) => Object.fromEntries(r.stations.map((s) => [s.seat, s]));

  it('working and blocked say what they are doing; a seat that holds an item is waiting; the rest idle', () => {
    const s = by(run(queue, seats));

    expect(s['dev-build']).toMatchObject({ state: 'working', holds: 0, doing: 'green line' });
    expect(s['review-r1']).toMatchObject({ state: 'blocked', doing: 'green line' });
    expect(s['dev-qa']).toMatchObject({ state: 'waiting', holds: 1, doing: null });
    expect(s['orch-lead']).toMatchObject({ state: 'idle', holds: 0, doing: null });
  });

  it('a working seat with no readable terminal line has nothing doing; a seat with no tail neither', () => {
    const s = by(run(queue, [seat('dev-build', 'working', ['  ']), seat('dev-qa', 'working')]));

    expect(s['dev-build']!.doing).toBeNull();
    expect(s['dev-qa']).toMatchObject({ state: 'working', doing: null });
  });

  it('on a sleeping machine every pip is asleep: holders wait, the rest idle', () => {
    const s = by(run(queue, seats, 'asleep'));

    expect(s['dev-qa']).toMatchObject({ state: 'waiting' });
    expect(s['dev-build']).toMatchObject({ state: 'idle', doing: null });
  });
});
