import { open, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AccountUsage } from '@appydave/shared';

/**
 * The machine's Claude account and its latest rate-limit reading, from files only:
 * - `~/.claude.json` → `oauthAccount.emailAddress`, `organizationType`, `organizationRateLimitTier`
 *   and `profileFetchedAt`. Nothing else is read out of it. This is Claude Code's CACHED profile
 *   (refreshed about daily), not the login: logins live in the Keychain and in
 *   ~/.claude/.credentials.json, which are never opened, read or stat-ed (v1.5 · C).
 *   The file's own modified time is not used: Claude Code rewrites it constantly.
 * - `~/.claude/usage-log.csv` → the last row the status-line sampler wrote
 *   (`epoch,iso,five_pct,five_resets_at,seven_pct,seven_resets_at,session_cost_usd,session`).
 * A machine without the sampler reports null percentages, never 0.
 */

export interface AccountPaths {
  claudeJson: string;
  usageLog: string;
}

export function defaultAccountPaths(home = homedir()): AccountPaths {
  return {
    claudeJson: join(home, '.claude.json'),
    usageLog: join(home, '.claude', 'usage-log.csv'),
  };
}

export function parseAccountIdentity(text: string): {
  email: string | null;
  plan: string | null;
  rateLimitTier: string | null;
  profileFetchedAt: string | null;
} {
  try {
    const acct = (JSON.parse(text) as { oauthAccount?: Record<string, unknown> }).oauthAccount;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    // organizationRateLimitTier names the Max tier (e.g. default_claude_max_20x); plan alone does not.
    // profileFetchedAt is epoch milliseconds; anything else is "not reported", never a guess.
    const f = acct?.profileFetchedAt;
    const fetched =
      typeof f === 'number' && Number.isFinite(f) && f > 0 ? new Date(f).toISOString() : null;

    return {
      email: str(acct?.emailAddress),
      plan: str(acct?.organizationType),
      rateLimitTier: str(acct?.organizationRateLimitTier),
      profileFetchedAt: fetched,
    };
  } catch {
    return { email: null, plan: null, rateLimitTier: null, profileFetchedAt: null };
  }
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === '') {
    return null;
  }
  const n = Number(v);

  return Number.isFinite(n) ? n : null;
};

const epochIso = (v: string | undefined): string | null => {
  const n = num(v);

  return n && n > 0 ? new Date(n * 1000).toISOString() : null;
};

export type UsageReading = Pick<
  AccountUsage,
  'fiveHourPct' | 'fiveHourResetsAt' | 'sevenDayPct' | 'sevenDayResetsAt' | 'sampledAt'
>;

const NO_READING: UsageReading = {
  fiveHourPct: null,
  fiveHourResetsAt: null,
  sevenDayPct: null,
  sevenDayResetsAt: null,
  sampledAt: null,
};

/**
 * The last usable row of the sampler log. A row may carry only one of the two windows (the other
 * blank); each window takes its value from the latest row that has one.
 */
export function parseUsageLog(text: string): UsageReading {
  const rows = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+,/.test(l))
    .map((l) => l.split(','));
  if (!rows.length) {
    return NO_READING;
  }
  const last = rows[rows.length - 1]!;
  const lastWith = (col: number) => [...rows].reverse().find((r) => num(r[col]) !== null);
  const five = lastWith(2);
  const seven = lastWith(4);

  return {
    fiveHourPct: five ? num(five[2]) : null,
    fiveHourResetsAt: five ? epochIso(five[3]) : null,
    sevenDayPct: seven ? num(seven[4]) : null,
    sevenDayResetsAt: seven ? epochIso(seven[5]) : null,
    sampledAt: epochIso(last[0]),
  };
}

/** Reads only the last few KB: the log grows for months and only its tail matters. */
async function readTail(path: string, bytes = 16_384): Promise<string> {
  const size = (await stat(path)).size;
  const fh = await open(path, 'r');
  try {
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    const text = buf.toString('utf8');

    // Drop a partial first line when the read started mid-file.
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    await fh.close();
  }
}

/** Null when the machine has no Claude login at all; otherwise whatever could be read. */
export async function readAccount(
  paths: AccountPaths = defaultAccountPaths()
): Promise<AccountUsage | null> {
  let identity: ReturnType<typeof parseAccountIdentity>;
  try {
    identity = parseAccountIdentity(await readFile(paths.claudeJson, 'utf8'));
  } catch {
    return null;
  }
  if (!identity.email) {
    return null;
  }
  let reading = NO_READING;
  try {
    reading = parseUsageLog(await readTail(paths.usageLog));
  } catch {
    // no sampler on this machine: an honest null reading
  }

  return { ...identity, ...reading };
}
