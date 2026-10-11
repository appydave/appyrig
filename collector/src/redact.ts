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

/**
 * Whole-message bodies are shown over the tailnet, so a secret that has no prefix and no `=` must
 * not slip by either. These rules deliberately err towards over-redacting.
 */

// -----BEGIN … PRIVATE KEY----- … -----END … PRIVATE KEY-----  (the whole block, even across lines)
const PRIVATE_KEY_BLOCK =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g;

// user:password@ inside a URL; the user stays, the password goes
const URL_CREDENTIALS = /(?<=:\/\/[^\s/:@]{1,64}:)[^\s/@]+(?=@)/g;

// HTTP Basic credentials
// Only with an Authorization header, or when the value is credential-shaped (has a digit): the
// word "Basic" next to a long ordinary word ("Basic authentication") is prose, not a secret.
const BASIC_AUTH =
  /\b(?:Authorization:\s*Basic\s+[A-Za-z0-9+/]{8,}={0,2}|Basic\s+(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]{16,}={0,2})/gi;
// Tailscale auth keys: tskey-auth-…, tskey-api-…, tskey-client-…
const TAILSCALE_KEY = /\btskey-[A-Za-z0-9-]{12,}/g;

// A label that names a secret, then (after "is", "=", ":", quotes or spaces) a value that looks like
// one: "secret key is wJal…", "aws secret access key: wJal…", "token \"abc123…\"".
const LABELLED_VALUE =
  /\b((?:secret|private|access|api|auth|signing|aws|session|client)[ _-]*(?:[a-z]+[ _-]+)?(?:key|token|secret|password|passwd)s?\b(?:\s+(?:is|was|are|=|:))?[\s:="'`(]{1,8})([A-Za-z0-9/+=_.~-]{12,})/gi;

const hasAll = (t: string, ...res: RegExp[]) => res.every((re) => re.test(t));
const entropy = (t: string): number => {
  const counts = new Map<string, number>();
  for (const c of t) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / t.length) * Math.log2(n / t.length);
  return h;
};

// A bare 32–88 character base64-looking run (AWS secret keys are 40) with upper, lower and digits
// and high entropy. Paths (they carry '-', '.', or a leading '/') and ordinary words do not qualify.
const BARE_SECRET = /(?<![A-Za-z0-9/+=_.~-])[A-Za-z0-9/+]{32,88}={0,2}(?![A-Za-z0-9/+=_.~-])/g;
const looksLikeBareSecret = (t: string): boolean =>
  !t.startsWith('/') &&
  hasAll(t, /[A-Z]/, /[a-z]/, /\d/) &&
  (t.match(/\//g)?.length ?? 0) <= 6 &&
  entropy(t) >= 4.3;

export function redactString(input: string): string {
  // The key block first: the line-level patterns below would otherwise chew its header and leave the body.
  let out = input.replace(PRIVATE_KEY_BLOCK, REDACTED);
  for (const re of PATTERNS) out = out.replace(re, REDACTED);
  out = out.replace(URL_CREDENTIALS, REDACTED);
  out = out.replace(BASIC_AUTH, (m) =>
    /^authorization/i.test(m) ? `Authorization: Basic ${REDACTED}` : `Basic ${REDACTED}`
  );
  out = out.replace(TAILSCALE_KEY, REDACTED);
  out = out.replace(LABELLED_VALUE, (_m, label: string, value: string) =>
    value === REDACTED || label.endsWith(REDACTED) ? _m : `${label}${REDACTED}`
  );
  out = out.replace(BARE_SECRET, (m) => (looksLikeBareSecret(m) ? REDACTED : m));
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
