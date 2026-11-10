/**
 * How the daemon-data reads talk to the daemon: the GET they are given (the sources adapter's, which
 * refuses any non-loopback daemon), a GET that never throws (`settle`), and how a 404 is told apart
 * from every other failure. A 404 means "this route is not on this OpenRig", never "none".
 * `valueOf` and `allFailed` turn settled GETs back into a value, an `unsupported`, or a thrown error.
 */
import { errorMessage } from '@collector/adapters/narrow/errors.js';

export type DaemonGet = (path: string) => Promise<unknown>;

/** True for the error `sources.ts` throws on a non-2xx reply of 404. */
export const isNotFound = (e: unknown): boolean => /HTTP 404\b/.test(errorMessage(e));

/** One GET that never throws: the value, or what went wrong (404 kept apart from the rest). */
export type Settled<T = unknown> =
  { ok: true; value: T } | { ok: false; notFound: boolean; error: string };

export async function settle(get: DaemonGet, path: string): Promise<Settled> {
  try {
    return { ok: true, value: await get(path) };
  } catch (e) {
    return { ok: false, notFound: isNotFound(e), error: errorMessage(e) };
  }
}

/** The value of a settled GET, or its error thrown again (for a parser's try). */
export function valueOf(r: Settled): unknown {
  if (!r.ok) {
    throw new Error(r.error);
  }

  return r.value;
}

/**
 * When every GET of a multi-part read failed: `unsupported` if each was a 404, else the first real
 * error is thrown (nothing is pushed, logged once by the reader). Undefined when any part worked.
 */
export function allFailed(settled: Settled[]): 'unsupported' | undefined {
  if (!settled.every((r) => !r.ok)) {
    return undefined;
  }

  if (settled.every((r) => !r.ok && r.notFound)) {
    return 'unsupported';
  }

  const bad = settled.find((r) => !r.ok && !r.notFound);

  throw new Error(bad && !bad.ok ? bad.error : 'unreadable');
}
