/*
 * Vendored from @flivideo/core v0.23.0 (commit fc55518, src/failure-codes.ts), MIT License,
 * Copyright (c) 2026 David Cruwys. Copied unchanged below this header (plan §0.2, review M10):
 * AppyRig does not depend on fli-core. To update, re-copy from a newer tag and re-run the tests.
 */
import { z } from 'zod';

/**
 * Refusals are data (agent-drivable step 2, David 2026-09-23). A refusal is NAMED — the name is canonical on every
 * door, every CLI and every skill — and it carries a STABLE INTEGER for JSON-RPC 2.0 (and so MCP), which requires one.
 *
 * WHERE THE NUMBERS COME FROM. FliCast published the first table (flicast `src/core/failure-codes.ts`, ADR-0006) in
 * its `api/openrpc.json`. The names the whole suite shares — the open contract's refusals plus `forbidden` — keep
 * FliCast's numbers here, so FliCast adopts this table without renumbering anything it has published.
 *
 * Every other name is an app's own: each app freezes its own table with `defineFailureCodes`, which refuses a
 * suite name at a different number, two names at one number, and a number outside the implementation range. Two apps
 * may use the same number for different names — a JSON-RPC code is scoped to the server that returns it, and every
 * error also carries `data.failureMode`, so no client needs any table to read the answer.
 *
 * ⚠ ASSIGNED ONCE, NEVER RENUMBERED. Append a new name with `nextFailureCode(table)`; pin the table in a test with
 * `assertAppendOnly(published, current)`.
 */

/** The codes JSON-RPC 2.0 §5.1 defines. `methodNotFound`, `invalidParams` and `internalError` stand for the app's own
 * "unknown capability", "invalid input" and "internal" names, whatever it calls them. */
export const JSONRPC_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

/** The implementation-defined server-error range JSON-RPC reserves (-32099 … -32000). Named refusals live here. */
export const FAILURE_CODE_RANGE = { highest: -32001, lowest: -32099 } as const;

/** The refusals every Fli app shares, at the numbers FliCast published. Never renumber. */
export const SUITE_FAILURE_CODES = Object.freeze({
  forbidden: -32001,
  missing: -32013,
  'no-brand-root': -32014,
  'not-a-project': -32029,
  'project-ambiguous': -32037,
  'project-not-found': -32038,
  'registry-unreadable': -32040,
  unauthorized: -32042,
  'unknown-brand': -32043,
  'video-invalid': -32045,
  'video-not-found': -32046,
  /** New here (FliCast's next free number): quitting would lose work in progress (see `lifecycle.ts`). */
  'app-busy': -32049,
} as const);
export type SuiteFailureMode = keyof typeof SUITE_FAILURE_CODES;

/** An app's frozen name → code table. */
export const FailureCodeTable = z.record(z.string().min(1), z.number().int());
export type FailureCodeTable = z.infer<typeof FailureCodeTable>;

const STANDARD = new Set<number>(Object.values(JSONRPC_CODES));
const inRange = (code: number) =>
  code <= FAILURE_CODE_RANGE.highest && code >= FAILURE_CODE_RANGE.lowest;

/**
 * Freeze an app's table: the suite codes plus the app's own. Its own entries may map a name onto a JSON-RPC standard
 * code (`'unknown-capability': JSONRPC_CODES.methodNotFound`) or take a free number in the implementation range.
 * Throws on a suite name at another number, a suite number under another name, a duplicate number, or a number
 * outside both — the table is code, so a bad one should fail at import time, not on the first refusal.
 */
export function defineFailureCodes<T extends Record<string, number>>(
  own: T,
): Readonly<typeof SUITE_FAILURE_CODES & T> {
  const table: Record<string, number> = { ...SUITE_FAILURE_CODES };
  const byCode = new Map<number, string>(
    Object.entries(SUITE_FAILURE_CODES).map(([name, code]) => [code, name]),
  );
  const problems: string[] = [];
  for (const [name, code] of Object.entries(own)) {
    const suite = (SUITE_FAILURE_CODES as Record<string, number>)[name];
    if (suite !== undefined) {
      if (suite !== code) problems.push(`${name} is a suite refusal at ${suite}, not ${code}`);
      continue;
    }
    if (!Number.isInteger(code) || (!inRange(code) && !STANDARD.has(code))) {
      problems.push(`${name}: ${code} is neither a JSON-RPC standard code nor in -32099…-32001`);
      continue;
    }
    const taken = byCode.get(code);
    if (taken !== undefined && !STANDARD.has(code)) {
      problems.push(`${name}: ${code} is already ${taken}`);
      continue;
    }
    byCode.set(code, name);
    table[name] = code;
  }
  if (problems.length > 0) throw new Error(`Invalid failure-code table: ${problems.join('; ')}`);
  return Object.freeze(table) as Readonly<typeof SUITE_FAILURE_CODES & T>;
}

/** The code for a name; an unknown name answers `internalError`, because a door must always be able to answer. */
export function failureCode(table: Readonly<Record<string, number>>, failureMode: string): number {
  return table[failureMode] ?? JSONRPC_CODES.internalError;
}

/** The next free number in the implementation range, for whoever appends a name. */
export function nextFailureCode(table: Readonly<Record<string, number>>): number {
  const used = new Set(Object.values(table));
  for (let code = FAILURE_CODE_RANGE.highest; code >= FAILURE_CODE_RANGE.lowest; code -= 1) {
    if (!used.has(code)) return code;
  }
  throw new Error('The failure-code range -32099…-32001 is full.');
}

/**
 * The published table is a promise: every name in it keeps its number. Returns the broken promises (empty when the
 * current table only appends). Use it in a test against the codes in the app's committed OpenRPC document.
 */
export function assertAppendOnly(
  published: Readonly<Record<string, number>>,
  current: Readonly<Record<string, number>>,
): string[] {
  return Object.entries(published)
    .filter(([name, code]) => current[name] !== code)
    .map(([name, code]) =>
      current[name] === undefined
        ? `${name} (${code}) was removed`
        : `${name} was ${code}, now ${current[name]}`,
    );
}

// ── Refusals ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A refusal as data: the name, a neutral sentence saying WHAT IS TRUE (never what to click), and details typed per
 * name carrying enough to succeed on the next call.
 */
export const Refusal = z.object({
  failureMode: z.string().min(1),
  message: z.string(),
  details: z.unknown().optional(),
});
export type Refusal = z.infer<typeof Refusal>;

/** `forbidden`: this principal may not call the capability. `humanOnly` says no agent ever may. */
export const ForbiddenDetails = z.object({
  capability: z.string(),
  principal: z.string(),
  allowed: z.array(z.enum(['human', 'agent', 'cli'])),
  humanOnly: z.boolean(),
});
export type ForbiddenDetails = z.infer<typeof ForbiddenDetails>;

/** `missing`: the required fields the call left out. */
export const MissingDetails = z.object({ missing: z.array(z.string()) });
export type MissingDetails = z.infer<typeof MissingDetails>;

/** What an app is doing that a quit would lose. */
export const BusyWork = z.object({
  what: z.string(),
  since: z.iso.datetime().optional(),
});
export type BusyWork = z.infer<typeof BusyWork>;

/** `app-busy`: what is in progress, so a caller can wait and retry rather than force it. */
export const AppBusyDetails = z.object({ busy: z.array(BusyWork) });
export type AppBusyDetails = z.infer<typeof AppBusyDetails>;

/** Typed details for the suite refusals that carry them; an app spreads this into its own map. */
export const SUITE_REFUSAL_DETAILS = Object.freeze({
  forbidden: ForbiddenDetails,
  missing: MissingDetails,
  'app-busy': AppBusyDetails,
} as const);

/** Thrown by a handler to refuse. A seam catches it and answers `{ ok: false, error }`. */
export class CapabilityRefusal extends Error {
  readonly failureMode: string;
  readonly details: unknown;

  constructor(failureMode: string, message: string, details?: unknown) {
    super(message);
    this.name = 'CapabilityRefusal';
    this.failureMode = failureMode;
    this.details = details;
  }

  toRefusal(): Refusal {
    return this.details === undefined
      ? { failureMode: this.failureMode, message: this.message }
      : { failureMode: this.failureMode, message: this.message, details: this.details };
  }
}
