import { describe, expect, it } from 'vitest';
import { QUEUE_MAX_ITEMS, type QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { replaySteps } from '@client/domain/fleet/views/flow/console.js';
import { queueCapNote } from '@client/domain/fleet/views/core/queueCap.js';
import { buildRun } from './model.js';

/**
 * AFTER walk W1-W3. The collector keeps a machine's most recently updated rows, so on a long run
 * the list holds the newest stretch plus a few old rows that were touched late.
 */
const BASE = Date.parse('2026-11-08T10:00:00.000Z');
const MINUTE = 60_000;
const NOW = BASE + 700 * MINUTE;
const iso = (t: number) => new Date(t).toISOString();

const row = (id: string, created: number, over: Partial<QueueItem> = {}): QueueItem => ({
  id,
  source: 'a@big',
  destination: 'b@big',
  state: 'done',
  priority: null,
  tags: [],
  summary: id,
  createdAt: iso(created),
  updatedAt: iso(created),
  ...over,
});

/** `count` handoffs a minute apart, then one row from 15 hours earlier that was updated late. */
function machine(count: number, straggler: Partial<QueueItem> = {}) {
  const recent = Array.from({ length: count }, (_, i) => row(`q${i}`, BASE + i * MINUTE));
  const old = row('old', BASE - 15 * 60 * MINUTE, {
    updatedAt: iso(BASE + 600 * MINUTE),
    ...straggler,
  });

  return fleetMachine({ ...snapshot('m2'), queue: [old, ...recent] });
}

const capped = (straggler?: Partial<QueueItem>) => machine(QUEUE_MAX_ITEMS - 1, straggler);

describe('a capped queue says what it does not know', () => {
  it('invents no pause from an old row kept beside the newest ones', () => {
    const run = buildRun(capped(), 'big', NOW)!;

    expect(run.phases).toHaveLength(1);
    expect(run.timeline.total).toBe(QUEUE_MAX_ITEMS - 1);
    expect(run.spanMs).toBeLessThan(10 * 60 * MINUTE);
  });

  it('never says finished: nothing open among these is all it knows', () => {
    expect(buildRun(capped(), 'big', NOW)!.outcome).toBe('unseen');
  });

  it('still counts an old row that really is open', () => {
    const run = buildRun(capped({ state: 'in-progress' }), 'big', NOW)!;

    expect(run.open).toBe(1);
    expect(run.outcome).not.toBe('finished');
  });

  it('replays only the part it has whole', () => {
    expect(replaySteps(capped(), 'big')[0]!.id).toBe('q0');
  });

  it('names the cut, and where the list starts', () => {
    expect(queueCapNote(capped())).toContain(`newest ${QUEUE_MAX_ITEMS} handoffs`);
  });

  it('changes nothing for a machine under the cap', () => {
    const under = machine(10);
    const run = buildRun(under, 'big', NOW)!;

    expect(queueCapNote(under)).toBeNull();
    expect(run.outcome).toBe('finished');
    expect(run.phases).toHaveLength(2);
    expect(replaySteps(under, 'big')[0]!.id).toBe('old');
  });
});
