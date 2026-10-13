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
  // Fix-first F2 (security #5): Google API keys, Stripe secret and restricted keys, npm tokens
  /\bAIza[0-9A-Za-z_-]{20,}/g,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /\bnpm_[A-Za-z0-9]{20,}/g,
  // Slack webhook URLs: the path after /services/ (or /workflows/, /triggers/) is the secret
  /(?<=hooks\.slack\.com\/(?:services|workflows|triggers)\/)[A-Za-z0-9/_-]{8,}/g,
  // mysql -pPASSWORD (the password glued to -p; a bare -p prompts and holds nothing)
  /(?<=\bmysql(?:dump|admin|sh)?\b[^\n]*?\s-p)[^\s'"]+/g,
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
// F2: the user may be empty (https://:pass@host).
const URL_CREDENTIALS = /(?<=:\/\/[^\s/:@]{0,64}:)[^\s/@]+(?=@)/g;

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

/** CSI and OSC escape sequences (colours, cursor moves, hyperlinks), as tmux `capture-pane -e` emits. */
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

/**
 * Fix-first F2 (security #5): a colour code inside a secret splits it, so matching runs on the text
 * with escapes stripped. A line that held a secret goes out plain (it loses its colours); every other
 * line keeps them.
 */
export function redactString(input: string): string {
  if (!input.includes('\x1b')) return redactPlain(input);
  const plain = input.replace(ANSI, '');
  const out = redactPlain(plain);
  return out === plain ? input : out;
}

function redactPlain(input: string): string {
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

// A row ending in an unfinished token-shaped run, and a row starting (after its indent) with one.
const RUN_CHAR = '[A-Za-z0-9_\\-+/=.~]';
const ENDS_IN_RUN = new RegExp(`${RUN_CHAR}{6,}$`);
const STARTS_WITH_RUN = new RegExp(`^${RUN_CHAR}{4,}`);
/**
 * Most rows one wrapped run is followed across. Only a backstop: a run continues only while each row
 * is full width and carries on into the next, so prose stops it at once. QA F2 MEDIUM-1: 4 rows let
 * a 600-char JWT leak its later rows; 40 rows covers ~3,000 chars at 80 columns.
 */
export const WRAP_MAX_ROWS = 40;
/** Columns short of the widest row that still count as a full (wrapped) row. */
export const WRAP_SLACK = 6;

/**
 * Fix-first F2 (QA HIGH-1, ruling 2026-10-13): Claude Code draws its own UI and breaks a long line
 * into separate rows with hard newlines, so `capture-pane -J` has nothing to join and a token's
 * second row (no prefix) slipped past the per-row patterns. Where a row ends in an unfinished
 * token-shaped run and the next row, indent stripped, carries it on, the run is redacted joined;
 * each row then gets back its own part with the secret cut out. Rows touched lose their colours.
 * Runs that join into nothing secret are left exactly as they were.
 */
export function redactWrapped(lines: string[]): string[] {
  const out = [...lines];
  const plain = lines.map((l) => (l.includes('\x1b') ? l.replace(ANSI, '') : l));
  // Only a full row can have been wrapped: the widest row stands in for the pane's width (a
  // Claude pane draws full-width rules), with a few columns of slack for its right margin.
  const full = Math.max(0, ...plain.map((l) => l.trimEnd().length)) - WRAP_SLACK;
  let i = 0;
  while (i < lines.length) {
    // Rows i..end form one chain while each row ends in a run the next row continues.
    let end = i;
    while (
      end + 1 < lines.length &&
      end - i + 1 < WRAP_MAX_ROWS &&
      plain[end]!.trimEnd().length >= full &&
      ENDS_IN_RUN.test(plain[end]!.trimEnd()) &&
      STARTS_WITH_RUN.test(plain[end + 1]!.trimStart())
    )
      end++;
    if (end === i) {
      i++;
      continue;
    }
    // Join: the first row trimmed at its end, continuation rows at their start (their indent kept aside).
    const parts: { indent: string; text: string; start: number }[] = [];
    let joined = '';
    for (let j = i; j <= end; j++) {
      let row = plain[j]!.trimEnd();
      let indent = '';
      if (j > i) {
        indent = row.slice(0, row.length - row.trimStart().length);
        row = row.trimStart();
      }
      parts.push({ indent, text: row, start: joined.length });
      joined += row;
    }
    const red = redactPlain(joined);
    if (red !== joined) {
      // The changed span: common prefix and suffix of before and after.
      let a = 0;
      while (a < joined.length && a < red.length && joined[a] === red[a]) a++;
      let b = 0;
      while (
        b < joined.length - a &&
        b < red.length - a &&
        joined[joined.length - 1 - b] === red[red.length - 1 - b]
      )
        b++;
      const spanEnd = joined.length - b;
      const crosses = parts.some((p, k) => k > 0 && p.start > a && p.start < spanEnd);
      if (crosses) {
        parts.forEach((p, k) => {
          const s = Math.max(a, p.start);
          const e = Math.min(spanEnd, p.start + p.text.length);
          if (s >= e) return; // this row is outside the secret: untouched
          const local = p.text.slice(0, s - p.start) + REDACTED + p.text.slice(e - p.start);
          out[i + k] = redactPlain(p.indent + local);
        });
      }
    }
    i = end + 1;
  }
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
