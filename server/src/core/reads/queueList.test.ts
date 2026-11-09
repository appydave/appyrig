import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { QueueItem, QueueListInputSchema, QueueRow } from '@appydave/shared';
import { createCore } from '@server/core/core.js';
import { FleetStore } from '@server/hub/stores/fleetStore.js';
import { loadSnapshot, manualClock } from '@server/test/hubHarness.js';

/** queue.list: the rows an agent or a page reads, in the order and amount it asked for. */

const roamy = loadSnapshot('roamy');
const base = roamy.queue[0]!;
const item = (id: string, updatedAt: string, over: Partial<QueueItem> = {}): QueueItem => ({
  ...base,
  id,
  updatedAt,
  ...over,
});
const ITEMS = [
  item('middle', '2026-11-09T02:00:00.000Z', { state: 'pending', destination: 'a@r' }),
  item('newest', '2026-11-09T03:00:00.000Z', { state: 'done', destination: 'b@r' }),
  item('oldest', '2026-11-09T01:00:00.000Z', { state: 'pending', destination: 'b@r' }),
];

function list(input: z.input<typeof QueueListInputSchema>): string[] {
  const clock = manualClock();
  const store = new FleetStore({ now: clock.now });

  store.put({ ...roamy, queue: ITEMS });

  const core = createCore({
    store,
    identity: { name: 'a', title: 'A', version: '1' },
    now: clock.now,
  });
  const answer = core.call('agent:test', 'queue.list', input);

  if (!answer.ok) {
    throw new Error(`queue.list refused: ${answer.error.message}`);
  }

  return (answer.value as QueueRow[]).map((r) => r.item.id);
}

describe('Feature: queue reads', () => {
  it('Scenario: given no filter, then every row comes back newest first', () => {
    expect(list({})).toEqual(['newest', 'middle', 'oldest']);
  });

  it('Scenario: given a state, then only rows in that state come back', () => {
    expect(list({ state: 'pending' })).toEqual(['middle', 'oldest']);
  });

  it('Scenario: given a destination, then only rows for that seat come back', () => {
    expect(list({ destination: 'b@r' })).toEqual(['newest', 'oldest']);
  });

  it('Scenario: given a limit, then the newest that many come back', () => {
    expect(list({ limit: 2 })).toEqual(['newest', 'middle']);
  });
});
