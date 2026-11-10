/**
 * What one read hands back to the reader, and how its failures are logged. An Outcome is one push to
 * be (status `ok` with data, `unsupported` when the route is not on this OpenRig, `not-found` when the
 * daemon does not know the thing). A failure that pushes nothing is logged ONCE under its key until
 * that key recovers (FailureLog).
 */
import { errorMessage } from '@collector/adapters/narrow/errors.js';

export interface Outcome {
  key: string;
  status: 'ok' | 'unsupported' | 'not-found';
  reason: string | null;
  data: unknown;
}

/** A read that worked; `key` is the seat for seat detail, '' for every whole-machine read. */
export const okOutcome = (data: unknown, key = ''): Outcome => ({
  key,
  status: 'ok',
  reason: null,
  data,
});

/** A read whose route this OpenRig does not have: "not on this version", never "none". */
export const unsupportedOutcome = (reason: string, key = ''): Outcome => ({
  key,
  status: 'unsupported',
  reason,
  data: null,
});

/** Logs each failing key once, until `recovered` clears it. */
export class FailureLog {
  private readonly failing = new Set<string>();

  constructor(private readonly log: (line: string) => void) {}

  fail(key: string, line: string): void {
    if (!this.failing.has(key)) {
      this.failing.add(key);
      this.log(line);
    }
  }

  recovered(key: string): void {
    this.failing.delete(key);
  }
}

/** Runs `parse` on one settled part, logging under `key` when it cannot be read; null when it cannot. */
export function readPart<T>(
  failures: FailureLog,
  part: { key: string; label: string; read: () => T }
): T | null {
  try {
    const value = part.read();

    failures.recovered(part.key);

    return value;
  } catch (e) {
    failures.fail(part.key, `${part.label} unreadable: ${errorMessage(e)}`);

    return null;
  }
}
