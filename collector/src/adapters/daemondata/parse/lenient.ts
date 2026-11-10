/**
 * The lenient readers every daemon-reply parser is built from. Parsing is lenient: a value is read as
 * `unknown` and checked with typeof, so one odd field drops that field (or that row), never the whole
 * read. Nothing here fetches or logs.
 */
import { redactString } from '@collector/redact.js';

export const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A non-empty string cut to `max`, else null. `redact` for free text. */
export function txt(v: unknown, max: number, redact = false): string | null {
  if (typeof v !== 'string') {
    return null;
  }

  const t = (redact ? redactString(v) : v).trim();

  return t ? t.slice(0, max) : null;
}

export const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

export const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The record, or an empty one: a field that is not an object reads as "nothing there". */
export const recOf = (v: unknown) => (isRec(v) ? v : {});

/** The rows `one` accepts, in order; a row it returns null for is skipped, never guessed. */
export const kept = <T>(rows: unknown[], one: (row: unknown) => T | null): T[] =>
  rows.map(one).filter((r): r is T => r !== null);

/** An array of rows, or a `{<wrapper>: [...]}` envelope: lenient about which. */
export function rowsOf(raw: unknown, wrapper: string): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (isRec(raw) && Array.isArray(raw[wrapper])) {
    return raw[wrapper] as unknown[];
  }

  throw new Error(`expected a JSON array (or {${wrapper}: [...]})`);
}

/** A count: a non-negative finite number, rounded; null for anything else. */
export const countOrNull = (v: unknown): number | null => {
  const n = num(v);

  return n !== null && n >= 0 ? Math.round(n) : null;
};
