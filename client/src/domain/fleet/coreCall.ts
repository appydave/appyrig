import {
  FLEET_EVENTS,
  callAnswerSchema,
  type CallAnswer,
  type CoreCallRequest,
} from '@appydave/shared';
import type { FleetSocket } from './useFleet.js';

/** How long the UI waits for a verb's answer before saying so. */
export const CALL_TIMEOUT_MS = 5_000;

const SENT_PREVIEW_CHARS = 120;

/** A hub answer that is not `{ ok, value }` or `{ ok: false, error }`, refused as data with what it sent. */
function badAnswer(verb: string, text: string): CallAnswer<never> {
  return {
    ok: false,
    error: {
      failureMode: 'bad_answer',
      message: `${verb}: the hub's answer was not a call answer (ok with a value, or not ok with an error). It sent: ${text.slice(0, SENT_PREVIEW_CHARS)}`,
    },
  };
}

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

        const parsed = callAnswerSchema<T>().safeParse(answer);

        resolve(parsed.success ? parsed.data : badAnswer(verb, JSON.stringify(answer)));
      });
  });
}
