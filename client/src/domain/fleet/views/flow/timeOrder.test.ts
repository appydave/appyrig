import { describe, expect, it } from 'vitest';
import type { QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { replaySteps } from './console.js';

/** AFTER audit X3: the contract allows any offset, so the text order is not the time order. */
const EARLIER = '2026-11-09T10:00:00+07:00'; // 03:00Z
const LATER = '2026-11-09T05:00:00.000Z';

const stamped = (id: string, createdAt: string): QueueItem => ({
  ...snapshot('m2').queue[0]!,
  id,
  source: 'a@big',
  destination: 'b@big',
  createdAt,
});

describe('handoffs sort by the moment, not the text', () => {
  it('replays a row stamped in +07:00 before a later one stamped in UTC', () => {
    const fm = fleetMachine({
      ...snapshot('m2'),
      queue: [stamped('later', LATER), stamped('earlier', EARLIER)],
    });

    expect(replaySteps(fm, 'big').map((q) => q.id)).toEqual(['earlier', 'later']);
  });
});
