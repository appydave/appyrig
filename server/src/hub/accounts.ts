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
 * v1.4 · S5: tier and windows-against-resets, worked out on the hub, ONCE per account. The push
 * (`snapshot.account.derived`) and `account.list` both come from `accountViews`, so they cannot
 * disagree. Pure: machines + config + a clock in, answer out. Nothing here reaches a collector
 * or OpenRig.
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

const clampPct = (n: number): number => Math.min(100, Math.max(0, n));

/**
 * One window against its reset. `usedPct` belongs to `sampledAt`, so elapsed, pace and projection
 * are measured at `sampledAt` too; only "has the window ended?" and `elapsedNowPct` use `now`.
 * (A sample 20 minutes old, compared with the clock now, understates how hot the account is.)
 */
export function windowOf(
  usedPct: number | null,
  resetsAt: string | null,
  windowMs: number,
  now: Date,
  sampledAt: string | null = null
): AccountWindow {
  const blank = {
    elapsedPct: null,
    elapsedNowPct: null,
    paceDeltaPct: null,
    projectedPct: null,
  };
  if (usedPct === null || resetsAt === null) {
    return {
      status: 'no-reading',
      usedPct,
      resetsAt,
      windowMs,
      startsAt: resetsAt ? new Date(Date.parse(resetsAt) - windowMs).toISOString() : null,
      ...blank,
    };
  }
  const resets = Date.parse(resetsAt);
  const start = resets - windowMs;
  const startsAt = new Date(start).toISOString();
  if (resets <= now.getTime()) {
    return { status: 'window-ended', usedPct, resetsAt, windowMs, startsAt, ...blank };
  }
  const sampleMs = sampledAt ? Math.min(Date.parse(sampledAt), now.getTime()) : now.getTime();
  const elapsedAtSample = clampPct(((sampleMs - start) / windowMs) * 100);
  const elapsedNow = clampPct(((now.getTime() - start) / windowMs) * 100);
  return {
    status: 'reading',
    usedPct,
    resetsAt,
    windowMs,
    startsAt,
    elapsedPct: round(elapsedAtSample),
    elapsedNowPct: round(elapsedNow),
    paceDeltaPct: round(usedPct - elapsedAtSample),
    projectedPct:
      elapsedAtSample >= PROJECTION_MIN_ELAPSED_PCT
        ? round((usedPct / elapsedAtSample) * 100)
        : null,
  };
}

const NO_READING: Pick<
  AccountUsage,
  'fiveHourPct' | 'fiveHourResetsAt' | 'sevenDayPct' | 'sevenDayResetsAt' | 'sampledAt'
> = {
  fiveHourPct: null,
  fiveHourResetsAt: null,
  sevenDayPct: null,
  sevenDayResetsAt: null,
  sampledAt: null,
};

export function deriveAccount(
  reading: Pick<
    AccountUsage,
    'fiveHourPct' | 'fiveHourResetsAt' | 'sevenDayPct' | 'sevenDayResetsAt' | 'sampledAt'
  >,
  tier: AccountTier,
  readingFrom: string | null,
  now: Date
): AccountDerived {
  return {
    tier,
    asOf: now.toISOString(),
    readingFrom,
    sampleAgeMs: reading.sampledAt
      ? Math.max(0, now.getTime() - Date.parse(reading.sampledAt))
      : null,
    fiveHour: windowOf(
      reading.fiveHourPct,
      reading.fiveHourResetsAt,
      FIVE_HOUR_MS,
      now,
      reading.sampledAt
    ),
    sevenDay: windowOf(
      reading.sevenDayPct,
      reading.sevenDayResetsAt,
      SEVEN_DAY_MS,
      now,
      reading.sampledAt
    ),
    monthly: { status: 'not-reported' },
  };
}

export interface AccountView {
  email: string;
  derived: AccountDerived;
}

const hasReading = (a: AccountUsage): boolean =>
  (a.fiveHourPct !== null || a.sevenDayPct !== null) && a.sampledAt !== null;

/**
 * The one answer per account, keyed by lower-cased email. Windows come from the freshest usable
 * reading among the machines signed into it; the tier from any machine that reports one, else config.
 * `changedAt` is when the hub saw a machine's login change: readings sampled before that belong to the
 * account it just left, so they are not used for the account it joined.
 */
export function accountViews(
  machines: FleetMachine[],
  config: AppConfig,
  now: Date,
  changedAt: (machine: string) => number | undefined = () => undefined
): Map<string, AccountView> {
  const groups = new Map<string, FleetMachine[]>();
  for (const m of [...machines].sort((a, b) => a.machine.id.localeCompare(b.machine.id))) {
    const email = m.snapshot.account?.email;
    if (email) groups.set(email.toLowerCase(), [...(groups.get(email.toLowerCase()) ?? []), m]);
  }
  const out = new Map<string, AccountView>();
  for (const [key, ms] of groups) {
    const usable = ms.filter((m) => {
      const a = m.snapshot.account!;
      return hasReading(a) && Date.parse(a.sampledAt!) >= (changedAt(m.machine.id) ?? 0);
    });
    const best = usable.reduce<FleetMachine | null>(
      (a, b) =>
        !a ||
        Date.parse(b.snapshot.account!.sampledAt!) > Date.parse(a.snapshot.account!.sampledAt!)
          ? b
          : a,
      null
    );
    const reporter = ms.find((m) => reportedTier(m.snapshot.account?.rateLimitTier));
    const first = ms[0]!.snapshot.account!;
    const tier = tierOf(
      { email: first.email, rateLimitTier: reporter?.snapshot.account?.rateLimitTier ?? null },
      config
    );
    out.set(key, {
      email: first.email!,
      derived: deriveAccount(
        best?.snapshot.account ?? NO_READING,
        tier,
        best?.machine.id ?? null,
        now
      ),
    });
  }
  return out;
}

/** Lays the account-level derived part on this machine's reported account. Same object back when it has none. */
export function applyAccountDerived(
  machine: FleetMachine,
  views: Map<string, AccountView>
): FleetMachine {
  const account = machine.snapshot.account;
  const view = account?.email ? views.get(account.email.toLowerCase()) : undefined;
  if (!account || !view) return machine;
  return {
    ...machine,
    snapshot: { ...machine.snapshot, account: { ...account, derived: view.derived } },
  };
}
