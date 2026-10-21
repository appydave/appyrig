import { describe, expect, it } from 'vitest';
import { callVerb } from './coreCall.js';
import type { FleetSocket } from './useFleet.js';

function socketAnswering(fn: (ack: (err: Error | null, answer?: unknown) => void) => void) {
  return {
    timeout: () => ({
      emit: (_e: string, _r: unknown, ack: (err: Error | null, a?: unknown) => void) => fn(ack),
    }),
  } as unknown as FleetSocket;
}

describe('callVerb', () => {
  it('passes an answer through as is', async () => {
    const s = socketAnswering((ack) => ack(null, { ok: true, value: 42 }));
    await expect(callVerb(s, 'system.status', {})).resolves.toEqual({ ok: true, value: 42 });
  });

  it('turns a timeout into a refusal, as data, never a throw', async () => {
    const s = socketAnswering((ack) => ack(new Error('operation has timed out')));
    const answer = await callVerb(s, 'seat.tail', {}, 2_000);
    expect(answer).toEqual({
      ok: false,
      error: { failureMode: 'timeout', message: 'seat.tail: no answer from the hub within 2s' },
    });
  });
});
