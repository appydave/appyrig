import {
  FIVE_HOUR_MS,
  PROJECTION_MIN_ELAPSED_PCT,
  SEVEN_DAY_MS,
  type AccountConfig,
  type AccountDerived,
  type AccountTier,
  type AccountUsage,
  type AccountWindow,
  type AppConfig,
  type FleetMachine,
} from '@appydave/shared';

/**
 * v1.4 · S5: tier and windows-against-resets, worked out on the hub. Pure: reported account + config
 * + a clock in, answer out. Nothing here reaches a collector or OpenRig.
 */

/** The tiers a login record's rate-limit string can name. Anything else is not "reported". */
export function reportedTier(rateLimitTier: string | null | undefined): string | null {
  if (!rateLimitTier) return null;
  if (/max_20x/.test(rateLimitTier)) return 'Max $200';
  if (/max_5x/.test(rateLimitTier)) return 'Max $100';
  return null;
}

const configFor = (config: AppConfig, email: string | null): AccountConfig | undefined => {
  if (!email || !config.accounts) return undefined;
  const want = email.toLowerCase();
  const key = Object.keys(config.accounts).find((k) => k.toLowerCase() === want);
  return key === undefined ? undefined : config.accounts[key];
};

/** Reported wins; config fills the gap; otherwise unknown. */
export function tierOf(
  usage: Pick<AccountUsage, 'email' | 'rateLimitTier'>,
  config: AppConfig
): AccountTier {
  const reported = reportedTier(usage.rateLimitTier);
  if (reported) return { label: reported, source: 'reported' };
  const fromConfig = configFor(config, usage.email)?.tier;
  if (fromConfig) return { label: fromConfig, source: 'config' };
  return { label: null, source: 'unknown' };
}

const round = (n: number, places = 1): number => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

export function windowOf(
  usedPct: number | null,
  resetsAt: string | null,
  windowMs: number,
  now: Date
): AccountWindow {
  if (usedPct === null || resetsAt === null) {
    return {
      status: 'no-reading',
      usedPct,
      resetsAt,
      windowMs,
      startsAt: resetsAt ? new Date(Date.parse(resetsAt) - windowMs).toISOString() : null,
      elapsedPct: null,
      paceDeltaPct: null,
      projectedPct: null,
    };
  }
  const resets = Date.parse(resetsAt);
  const startsAt = new Date(resets - windowMs).toISOString();
  if (resets <= now.getTime()) {
    return {
      status: 'window-ended',
      usedPct,
      resetsAt,
      windowMs,
      startsAt,
      elapsedPct: null,
      paceDeltaPct: null,
      projectedPct: null,
    };
  }
  const elapsedPct = Math.min(
    100,
    Math.max(0, ((now.getTime() - (resets - windowMs)) / windowMs) * 100)
  );
  return {
    status: 'reading',
    usedPct,
    resetsAt,
    windowMs,
    startsAt,
    elapsedPct: round(elapsedPct),
    paceDeltaPct: round(usedPct - elapsedPct),
    projectedPct:
      elapsedPct >= PROJECTION_MIN_ELAPSED_PCT ? round((usedPct / elapsedPct) * 100) : null,
  };
}

export function deriveAccount(usage: AccountUsage, config: AppConfig, now: Date): AccountDerived {
  return {
    tier: tierOf(usage, config),
    asOf: now.toISOString(),
    sampleAgeMs: usage.sampledAt ? Math.max(0, now.getTime() - Date.parse(usage.sampledAt)) : null,
    fiveHour: windowOf(usage.fiveHourPct, usage.fiveHourResetsAt, FIVE_HOUR_MS, now),
    sevenDay: windowOf(usage.sevenDayPct, usage.sevenDayResetsAt, SEVEN_DAY_MS, now),
    monthly: { status: 'not-reported' },
  };
}

/** Lays the derived part on the machine's reported account. Same object back when it has none. */
export function applyAccountDerived(
  machine: FleetMachine,
  config: AppConfig,
  now: Date
): FleetMachine {
  const account = machine.snapshot.account;
  if (!account?.email) return machine;
  return {
    ...machine,
    snapshot: {
      ...machine.snapshot,
      account: { ...account, derived: deriveAccount(account, config, now) },
    },
  };
}
