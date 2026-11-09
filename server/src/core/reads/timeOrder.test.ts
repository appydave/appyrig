import { afterEach, describe, expect, it } from 'vitest';
import { FLEET_EVENTS, type QueueItem } from '@appydave/shared';
import {
  COOKIE,
  TOKEN,
  loadSnapshot,
  push,
  startHub,
  type RunningHub,
} from '@server/test/hubHarness.js';

/** AFTER audit X3: the contract allows any offset, so the text order is not the time order. */
const EARLIER = '2026-11-09T10:00:00+07:00'; // 03:00Z
const LATER = '2026-11-09T05:00:00.000Z';

const m2 = loadSnapshot('m2');
const stamped = (id: string, updatedAt: string): QueueItem => ({ ...m2.queue[0]!, id, updatedAt });

let hub: RunningHub | undefined;

afterEach(async () => {
  await hub?.stop();
  hub = undefined;
});

describe('queue.list sorts by the moment, not the text', () => {
  it('puts the row updated last first, whatever offset each was stamped in', async () => {
    hub = await startHub();

    await push(hub.collector({ token: TOKEN, machineId: m2.machine.id }), {
      ...m2,
      queue: [stamped('in-plus-seven', EARLIER), stamped('in-utc', LATER)],
    });

    const browser = hub.browser(COOKIE);
    const answer = await new Promise<{ ok: boolean; value?: { item: QueueItem }[] }>((r) =>
      browser.emit(FLEET_EVENTS.CALL, { verb: 'queue.list', input: {} }, r)
    );

    expect(answer.value?.map((x) => x.item.id)).toEqual(['in-utc', 'in-plus-seven']);
  });
});
