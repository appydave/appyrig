import type { Socket } from 'socket.io-client';
import type { CollectorAck } from '@appydave/shared';

/** A missing ack is a timeout, not a refusal: kept apart from the hub's own failure modes. */
export type AckResult = CollectorAck | { ok: false; timeout: true };

/** Emits once and resolves to the hub's ack, or `{ ok: false, timeout: true }` when none comes in time. */
export function emitAcked<Payload>(
  timed: ReturnType<Socket['timeout']>,
  event: string,
  payload: Payload
): Promise<AckResult> {
  return new Promise((resolve) => {
    timed.emit(event, payload, (err: Error | null, ack?: CollectorAck) => {
      resolve(err || !ack ? { ok: false, timeout: true } : ack);
    });
  });
}
