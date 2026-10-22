import type { Reading } from '@appydave/shared';

const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
const BYTES_PER_GB = BYTES_PER_MB * BYTES_PER_KB;
/** From this many GB up, a size drops its decimal: "128 GB", not "128.4 GB". */
const WHOLE_GB_FROM = 100;

/** Bytes in plain words: "812 MB", "7.4 GB", "128 GB". */
export function gb(bytes: number): string {
  const g = bytes / BYTES_PER_GB;

  return g >= WHOLE_GB_FROM
    ? `${g.toFixed(0)} GB`
    : g >= 1
      ? `${Number(g.toFixed(1))} GB`
      : `${Math.round(bytes / BYTES_PER_MB)} MB`;
}

/** The value, or null; with the reason kept for a hover. */
export function value<T>(r: Reading<T>): { v: T | null; why: string | null } {
  return r.status === 'ok' ? { v: r.value, why: null } : { v: null, why: r.reason };
}
