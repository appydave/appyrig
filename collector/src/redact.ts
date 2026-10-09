/**
 * Redaction filter (AC 19). Everything that reaches a snapshot (terminal tails, cwd, summaries,
 * guidance) passes through here first. Pattern-based, so an unrecognised secret format passes:
 * the patterns are the ones found by the fixtures sweep (test/fixtures/README.md "Redaction sweep")
 * plus the common neighbours of the same families.
 */
export const REDACTED = '<REDACTED>';

const PATTERNS: RegExp[] = [
  // "resume <uuid>" / "--resume '<uuid>'" session resume tokens (keyword kept, id removed)
  /(?<=resume[\s='"]{1,3})[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
  // GitHub tokens: gho_ ghp_ ghs_ ghu_ ghr_ and fine-grained github_pat_
  /\bgh[opsur]_[A-Za-z0-9]{8,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  // sk-… API keys (16+ chars after the prefix)
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  // Slack and AWS key ids
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Bearer tokens
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // auth_token / hook_token style assignments
  /\b(?:auth|hook|access|api)[_-]?token["']?\s*[:=]\s*["']?[A-Za-z0-9._~+/=-]{8,}/gi,
  // env-style secret assignments: ANTHROPIC_API_KEY=..., DB_PASSWORD: ..., client_secret = ...
  /\b[A-Za-z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD)[A-Za-z0-9_]*["']?\s*[:=]\s*["']?[^\s"'<>,;]{6,}/gi,
  // password: value
  /\bpass(?:word|wd)\s*[:=]\s*["']?[^\s"']{4,}/gi,
  // JWTs
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  // any hex run of 40+ characters (hashes, long keys)
  /\b[0-9a-fA-F]{40,}\b/g,
];

export function redactString(input: string): string {
  let out = input;
  for (const re of PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

/** Redacts every string leaf of a JSON-like value. Keys are left alone. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactString(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out as T;
  }
  return value;
}
