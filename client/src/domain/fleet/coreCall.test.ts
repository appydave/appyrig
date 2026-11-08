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

  it.each([
    ['not an object', 'hello', '"hello"'],
    ['ok missing', { value: 1 }, '{"value":1}'],
    ['ok true without value', { ok: true }, '{"ok":true}'],
    ['ok false without error', { ok: false }, '{"ok":false}'],
    [
      'error without a failureMode',
      { ok: false, error: { message: 'x' } },
      '{"ok":false,"error":{"message":"x"}}',
    ],
    ['error that is not an object', { ok: false, error: 5 }, '{"ok":false,"error":5}'],
  ])('refuses a malformed answer (%s), saying what the hub sent', async (_name, sent, text) => {
    const s = socketAnswering((ack) => ack(null, sent));
    const answer = await callVerb(s, 'system.status', {});

    expect(answer).toEqual({
      ok: false,
      error: {
        failureMode: 'bad_answer',
        message: `system.status: the hub's answer was not a call answer (ok with a value, or not ok with an error). It sent: ${text}`,
      },
    });
  });

  it('passes a refusal from the hub through as is', async () => {
    const refusal = { ok: false, error: { failureMode: 'denied', message: 'no', details: [1] } };
    const s = socketAnswering((ack) => ack(null, refusal));

    await expect(callVerb(s, 'seat.tail', {})).resolves.toEqual(refusal);
  });

  it('cuts what the hub sent to its first 120 characters', async () => {
    const sent = { ok: false, padding: 'a'.repeat(300) };
    const s = socketAnswering((ack) => ack(null, sent));
    const answer = await callVerb(s, 'system.status', {});
    const message = answer.ok ? '' : answer.error.message;

    expect(message.endsWith(`It sent: ${JSON.stringify(sent).slice(0, 120)}`)).toBe(true);
  });

  it('passes a null value through unchanged', async () => {
    const s = socketAnswering((ack) => ack(null, { ok: true, value: null }));

    await expect(callVerb(s, 'system.status', {})).resolves.toEqual({ ok: true, value: null });
  });
});
