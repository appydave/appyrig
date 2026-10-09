import { FLEET_EVENTS, type CallAnswer, type CoreCallRequest } from '@appydave/shared';
import type { FleetSocket } from './useFleet.js';

/** How long the UI waits for a verb's answer before saying so. */
export const CALL_TIMEOUT_MS = 5_000;

/**
 * Calls one read-only API core verb over the browser socket (`core:call`, principal `human:ui`).
 * The UI's one door into the API core (B1, B13): every action the UI takes on a seat is a verb an
 * agent can call the same way. Never throws; a timeout or transport failure comes back as a
 * refusal, as data, like any other (B7).
 */
export function callVerb<T>(
  socket: FleetSocket,
  verb: string,
  input: unknown,
  timeoutMs = CALL_TIMEOUT_MS
): Promise<CallAnswer<T>> {
  const request: CoreCallRequest = { verb, input };
  return new Promise((resolve) => {
    socket
      .timeout(timeoutMs)
      .emit(FLEET_EVENTS.CALL, request, (err: Error | null, answer?: CallAnswer) => {
        if (err || !answer) {
          resolve({
            ok: false,
            error: {
              failureMode: 'timeout',
              message: `${verb}: no answer from the hub within ${Math.round(timeoutMs / 1000)}s`,
            },
          });
          return;
        }
        resolve(answer as CallAnswer<T>);
      });
  });
}
