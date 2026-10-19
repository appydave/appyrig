/**
 * The Run board's deep link: `&job=<n or slice>&doc=spec|rig|culture|mission`.
 *
 * - `job` is the job's number on the strip (1-based, what the page writes) or its slice
 *   (`d09/ct-0011-light-theme`, also accepted, so a sign-off page can link by either).
 * - `doc` is the document tab beside the job.
 *
 * A value that does not match falls back (no job: the current job, else job 1; no doc: Spec) and
 * never throws.
 */
export type DocKey = 'spec' | 'rig' | 'culture' | 'mission';
export const DOC_KEYS: readonly DocKey[] = ['spec', 'rig', 'culture', 'mission'];
export const DOC_DEFAULT_TAB: DocKey = 'spec';

/** `doc=` to a tab; null for a missing or unknown value. Case is ignored. */
export function parseDoc(v: string | null | undefined): DocKey | null {
  const k = (v ?? '').trim().toLowerCase();
  return (DOC_KEYS as readonly string[]).includes(k) ? (k as DocKey) : null;
}

/** `job=` to an index into `slices`; null for a missing or unknown value. */
export function parseJob(v: string | null | undefined, slices: readonly string[]): number | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n >= 1 && n <= slices.length ? n - 1 : null;
  }
  const i = slices.indexOf(s);
  return i >= 0 ? i : null;
}

/** The `job=` value the page writes for the job at `index`: its number on the strip. */
export const jobParam = (index: number): string => String(index + 1);
