/**
 * A read made of several independent GETs behind one push (workflows, most of health). Each part that
 * cannot be read is null (kept apart from "read, empty") and logged once under `<label>:<part>`. The
 * whole read is `unsupported` when every part is a 404, and throws (nothing is pushed, logged once by
 * the reader) when every part failed and at least one was not a 404.
 */
import {
  allFailed,
  settle,
  valueOf,
  type DaemonGet,
} from '@collector/adapters/daemondata/reads/get.js';
import {
  okOutcome,
  readPart,
  unsupportedOutcome,
  type FailureLog,
  type Outcome,
} from '@collector/adapters/daemondata/reads/outcome.js';

type PartReads<T> = { [K in keyof T]: { path: string; parse: (raw: unknown) => T[K] } };

export async function readParts<T extends Record<string, unknown>>(
  ctx: { get: DaemonGet; failures: FailureLog },
  label: string,
  reads: PartReads<T>
): Promise<Outcome[]> {
  const names = Object.keys(reads) as (keyof T & string)[];
  const settled = await Promise.all(names.map((n) => settle(ctx.get, reads[n].path)));

  if (allFailed(settled) === 'unsupported') {
    return [unsupportedOutcome(`this OpenRig has no ${label} routes`)];
  }

  const data = {} as T;

  names.forEach((n, i) => {
    data[n] = readPart(ctx.failures, {
      key: `${label}:${n}`,
      label: `${label} ${n}`,
      read: () => reads[n].parse(valueOf(settled[i]!)),
    }) as T[typeof n];
  });

  return [okOutcome(data)];
}
