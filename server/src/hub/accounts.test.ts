import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AccountUsageSchema,
  FIVE_HOUR_MS,
  SEVEN_DAY_MS,
  type AccountUsage,
  type FleetMachine,
} from '@appydave/shared';
import {
  accountViews,
  applyAccountDerived,
  deriveAccount,
  reportedTier,
  tierOf,
  windowOf,
} from './accounts.js';
import { loadSnapshot, push, startHub, TOKEN } from '../test/hubHarness.js';

const NOW = new Date('2026-10-11T12:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const usage = (over: Partial<AccountUsage> = {}): AccountUsage => ({
  email: 'david@example.com',
  plan: 'claude_max',
  fiveHourPct: 40,
  fiveHourResetsAt: at(FIVE_HOUR_MS / 2), // half the window gone
  sevenDayPct: 10,
  sevenDayResetsAt: at(SEVEN_DAY_MS * 0.9), // 10% of the week gone
  sampledAt: at(-60_000),
  ...over,
});

describe('tier: reported wins, config fills the gap, else unknown', () => {
  it('names the Max tier from the login record', () => {
    expect(reportedTier('default_claude_max_20x')).toBe('Max $200');
    expect(reportedTier('default_claude_max_5x')).toBe('Max $100');
    expect(reportedTier('default_claude_pro')).toBeNull();
    expect(reportedTier(undefined)).toBeNull();
  });

  it('a reported tier is not overridden by config', () => {
    const t = tierOf(usage({ rateLimitTier: 'default_claude_max_20x' }), {
      accounts: { 'david@example.com': { tier: 'Max $100' } },
    });
    expect(t).toEqual({ label: 'Max $200', source: 'reported' });
  });

  it('config supplies it when the login record does not (email matched case-insensitively)', () => {
    const t = tierOf(usage({ email: 'David@AppyDave.com' }), {
      accounts: { 'david@appydave.com': { tier: 'Max $100' } },
    });
    expect(t).toEqual({ label: 'Max $100', source: 'config' });
  });

  it('unknown when neither says, never a guess from the plan name', () => {
    expect(tierOf(usage({ rateLimitTier: null }), {})).toEqual({ label: null, source: 'unknown' });
    expect(tierOf(usage({ email: null }), { accounts: { x: { tier: 'y' } } }).source).toBe(
      'unknown'
    );
  });
});

describe('a window against its reset', () => {
  it('reports used, elapsed, pace and a projection (a sample taken just now)', () => {
    const w = windowOf(40, at(FIVE_HOUR_MS / 2), FIVE_HOUR_MS, NOW, NOW.toISOString());
    expect(w).toMatchObject({
      status: 'reading',
      usedPct: 40,
      elapsedPct: 50,
      elapsedNowPct: 50,
      paceDeltaPct: -10,
      projectedPct: 80,
      windowMs: FIVE_HOUR_MS,
      startsAt: at(-FIVE_HOUR_MS / 2),
    });
  });

  it('burning faster than time passes is a positive pace and a projection over 100', () => {
    const w = windowOf(90, at(FIVE_HOUR_MS / 2), FIVE_HOUR_MS, NOW);
    expect(w.paceDeltaPct).toBe(40);
    expect(w.projectedPct).toBe(180);
  });

  it('too early in the window to project (under 5% elapsed)', () => {
    const w = windowOf(3, at(FIVE_HOUR_MS * 0.98), FIVE_HOUR_MS, NOW);
    expect(w.status).toBe('reading');
    expect(w.projectedPct).toBeNull();
  });

  it('a reset time in the past is a window that ended, not a live one', () => {
    const w = windowOf(95, at(-1000), FIVE_HOUR_MS, NOW);
    expect(w).toMatchObject({
      status: 'window-ended',
      usedPct: 95,
      elapsedPct: null,
      paceDeltaPct: null,
    });
  });

  it('no reading stays null, never 0', () => {
    expect(windowOf(null, null, SEVEN_DAY_MS, NOW)).toMatchObject({
      status: 'no-reading',
      usedPct: null,
      elapsedPct: null,
      startsAt: null,
    });
    // a percentage with no reset time cannot be placed in a window either
    expect(windowOf(30, null, SEVEN_DAY_MS, NOW).status).toBe('no-reading');
  });

  it('keeps a spent window above 100%', () => {
    expect(windowOf(102, at(FIVE_HOUR_MS / 2), FIVE_HOUR_MS, NOW).usedPct).toBe(102);
  });
});

describe('deriveAccount', () => {
  const tier = { label: 'Max $200', source: 'reported' } as const;
  it('monthly is always not-reported, and sample age is measured, not assumed', () => {
    const d = deriveAccount(usage(), tier, 'm4', NOW);
    expect(d.monthly).toEqual({ status: 'not-reported' });
    expect(d.sampleAgeMs).toBe(60_000);
    expect(d.readingFrom).toBe('m4');
    expect(d.asOf).toBe(NOW.toISOString());
    expect(deriveAccount(usage({ sampledAt: null }), tier, null, NOW).sampleAgeMs).toBeNull();
  });
});

describe('QA D1: a stale sample is projected from its own moment, not from the clock now', () => {
  it("Roamy's case: 27% used when 14.3% of the window had gone is a 189% projection, not 150%", () => {
    // window 11:00-16:00. Sampled 11:42:56 (14.3% elapsed, 27% used). Now is 11:54:50 (~19% elapsed).
    const start = Date.parse('2026-10-11T11:00:00.000Z');
    const sampledAt = new Date(start + 0.143 * FIVE_HOUR_MS).toISOString();
    const now = new Date(start + 0.191 * FIVE_HOUR_MS);
    const w = windowOf(27, '2026-10-11T16:00:00.000Z', FIVE_HOUR_MS, now, sampledAt);
    expect(w.status).toBe('reading');
    expect(w.elapsedPct).toBe(14.3);
    expect(w.projectedPct).toBe(188.8);
    expect(w.paceDeltaPct).toBe(12.7);
    // the clock-now tick is still available, and is later
    expect(w.elapsedNowPct).toBe(19.1);
    // the old maths (sample vs the clock now) would have said 27 / 19.1 = 141%
    expect(w.projectedPct).toBeGreaterThan((27 / 19.1) * 100);
  });

  it('the older the sample, the more it matters: hot stays hot as time passes', () => {
    const resets = '2026-10-11T16:00:00.000Z';
    const sampled = '2026-10-11T12:00:00.000Z'; // 20% elapsed, 40% used => projects 200%
    const soon = windowOf(40, resets, FIVE_HOUR_MS, new Date('2026-10-11T12:01:00.000Z'), sampled);
    const late = windowOf(40, resets, FIVE_HOUR_MS, new Date('2026-10-11T13:30:00.000Z'), sampled);
    expect(soon.projectedPct).toBe(200);
    expect(late.projectedPct).toBe(200); // not diluted by 90 more minutes of clock
    expect(late.elapsedNowPct).toBeGreaterThan(late.elapsedPct!);
  });

  it('window-ended is still judged at now, not at the sample', () => {
    const w = windowOf(
      40,
      '2026-10-11T12:30:00.000Z',
      FIVE_HOUR_MS,
      new Date('2026-10-11T12:31:00.000Z'),
      '2026-10-11T12:00:00.000Z'
    );
    expect(w.status).toBe('window-ended');
    expect(w.projectedPct).toBeNull();
  });
});

/** A fleet machine carrying just an account, for the pure account-level maths. */
const machineWith = (id: string, account: AccountUsage): FleetMachine => {
  const snapshot = { ...loadSnapshot('roamy'), account };
  return {
    machine: { ...snapshot.machine, id },
    liveness: 'live',
    lastSeen: NOW.toISOString(),
    snapshot: { ...snapshot, machine: { ...snapshot.machine, id } },
  };
};

describe('QA D2: one answer per account', () => {
  it('windows come from the freshest usable reading and the tier from any machine that reports it', () => {
    const views = accountViews(
      [
        machineWith(
          'm2',
          usage({
            rateLimitTier: 'default_claude_max_20x',
            fiveHourPct: null,
            fiveHourResetsAt: null,
            sevenDayPct: null,
            sevenDayResetsAt: null,
            sampledAt: null,
          })
        ),
        machineWith('m4', usage({ sampledAt: at(-60_000) })),
        machineWith('roamy', usage({ sampledAt: at(-600_000), fiveHourPct: 99 })),
      ],
      {},
      NOW
    );
    expect(views.size).toBe(1);
    const d = views.get('david@example.com')!.derived;
    expect(d.readingFrom).toBe('m4');
    expect(d.tier).toEqual({ label: 'Max $200', source: 'reported' });
    expect(d.fiveHour.usedPct).toBe(40);
  });

  it('no machine has a reading: the account is still listed, with no-reading and readingFrom null', () => {
    const none = usage({
      fiveHourPct: null,
      fiveHourResetsAt: null,
      sevenDayPct: null,
      sevenDayResetsAt: null,
      sampledAt: null,
    });
    const d = accountViews([machineWith('m2', none)], {}, NOW).get('david@example.com')!.derived;
    expect(d).toMatchObject({
      readingFrom: null,
      sampleAgeMs: null,
      fiveHour: { status: 'no-reading' },
    });
  });

  it('a sample stamped just before the hub noticed the switch still counts (clock tolerance)', () => {
    const roamy = machineWith(
      'roamy',
      usage({ email: 'david@example.com', fiveHourPct: 77, sampledAt: at(-310_000) })
    );
    const changedAt = (id: string) => (id === 'roamy' ? NOW.getTime() - 300_000 : undefined); // 10 s earlier than the sample
    expect(
      accountViews([roamy], {}, NOW, changedAt).get('david@example.com')!.derived.readingFrom
    ).toBe('roamy');
    // …but one well before it does not
    const old = machineWith(
      'roamy',
      usage({ email: 'david@example.com', sampledAt: at(-600_000) })
    );
    expect(
      accountViews([old], {}, NOW, changedAt).get('david@example.com')!.derived.readingFrom
    ).toBeNull();
  });

  it('a derived part a collector sent is dropped when there is no account to attach it to, and replaced when there is', () => {
    const forged = { fiveHour: { status: 'reading' } } as never;
    const noEmail = machineWith('m2', { ...usage({ email: null }), derived: forged });
    const stripped = applyAccountDerived(noEmail, accountViews([noEmail], {}, NOW));
    expect(stripped.snapshot.account).not.toHaveProperty('derived');
    const real = machineWith('m4', { ...usage(), derived: forged });
    const out = applyAccountDerived(real, accountViews([real], {}, NOW));
    expect(out.snapshot.account?.derived?.fiveHour.status).toBe('reading');
  });

  it("right after a login switch, the old account's reading is not used for the new account", () => {
    // roamy just moved to example at -5 min; its last sample (-10 min) was taken for appydave.
    const roamy = machineWith(
      'roamy',
      usage({ email: 'david@example.com', fiveHourPct: 77, sampledAt: at(-600_000) })
    );
    const m4 = machineWith('m4', usage({ sampledAt: at(-1_200_000) }));
    const changedAt = (id: string) => (id === 'roamy' ? NOW.getTime() - 300_000 : undefined);
    const d = accountViews([roamy, m4], {}, NOW, changedAt).get('david@example.com')!.derived;
    expect(d.readingFrom).toBe('m4'); // older, but taken for this account
    expect(d.fiveHour.usedPct).toBe(40);
    // with no change recorded (e.g. after a hub restart) nothing is discarded
    expect(accountViews([roamy, m4], {}, NOW).get('david@example.com')!.derived.readingFrom).toBe(
      'roamy'
    );
  });
});

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('accounts over the hub', () => {
  const withAccount = (machine: string, account: AccountUsage | null) => ({
    ...loadSnapshot(machine as 'm2' | 'roamy'),
    account,
  });

  it('switching a machine login moves it to the other account on the next push, with tier from config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appyrig-acct-'));
    dirs.push(dir);
    const configPath = join(dir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        accounts: {
          'david@example.com': { tier: 'Max $200' },
          'david@appydave.com': { tier: 'Max $100' },
        },
      })
    );
    const h = await startHub({ configPath });
    try {
      const c = h.collector({ token: TOKEN, machineId: 'roamy' });
      const m4 = h.collector({ token: TOKEN, machineId: 'm2' });
      await push(m4, withAccount('m2', usage({ email: 'david@example.com' })));
      await push(c, withAccount('roamy', usage({ email: 'david@example.com' })));

      const before = h.hub.core.call('cli', 'account.list', {});
      expect(before).toMatchObject({ ok: true, value: { configured: true, unreported: [] } });
      const accts = (before as { value: { accounts: { email: string; machines: string[] }[] } })
        .value.accounts;
      expect(accts).toHaveLength(1);
      expect(accts[0]).toMatchObject({
        email: 'david@example.com',
        machines: ['m2', 'roamy'],
        tier: { label: 'Max $200', source: 'config' },
        monthly: { status: 'not-reported' },
      });

      // Roamy logs into the other account; its very next push moves it.
      await push(c, withAccount('roamy', usage({ email: 'david@appydave.com' })));
      const after = (
        h.hub.core.call('cli', 'account.list', {}) as {
          value: {
            accounts: {
              email: string;
              machines: string[];
              tier: { label: string; source: string };
            }[];
          };
        }
      ).value.accounts;
      expect(after.map((a) => [a.email, a.machines, a.tier.label, a.tier.source])).toEqual([
        ['david@appydave.com', ['roamy'], 'Max $100', 'config'],
        ['david@example.com', ['m2'], 'Max $200', 'config'],
      ]);
    } finally {
      await h.stop();
    }
  });

  it('the push and account.list tell the same story: every machine of an account carries the same derived', async () => {
    const h = await startHub();
    try {
      const t = Date.now();
      const fresh = (over: Partial<AccountUsage>) =>
        usage({
          fiveHourResetsAt: new Date(t + FIVE_HOUR_MS / 2).toISOString(),
          sevenDayResetsAt: new Date(t + SEVEN_DAY_MS / 2).toISOString(),
          sampledAt: new Date(t - 30_000).toISOString(),
          ...over,
        });
      await push(
        h.collector({ token: TOKEN, machineId: 'm2' }),
        withAccount(
          'm2',
          fresh({
            rateLimitTier: 'default_claude_max_20x',
            fiveHourPct: null,
            fiveHourResetsAt: null,
            sevenDayPct: null,
            sevenDayResetsAt: null,
            sampledAt: null,
          })
        )
      );
      await push(
        h.collector({ token: TOKEN, machineId: 'roamy' }),
        withAccount('roamy', fresh({}))
      );
      const onPush = h.hub.store.list().map((m) => m.snapshot.account!.derived!);
      expect(onPush).toHaveLength(2);
      expect(onPush[0]!.tier).toEqual({ label: 'Max $200', source: 'reported' });
      expect(onPush[0]).toEqual(onPush[1]);
      expect(onPush[0]!.readingFrom).toBe('roamy');
      const listed = (
        h.hub.core.call('cli', 'account.list', {}) as {
          value: { accounts: Record<string, unknown>[] };
        }
      ).value.accounts[0]!;
      expect(listed).toMatchObject({
        tier: onPush[0]!.tier,
        readingFrom: 'roamy',
        machines: ['m2', 'roamy'],
      });
    } finally {
      await h.stop();
    }
  });

  it('a tier any machine reports beats a machine that cannot (older collector)', async () => {
    const h = await startHub();
    try {
      // m2 is newer and reports the tier; roamy is older, has the fresher sample, and does not.
      await push(
        h.collector({ token: TOKEN, machineId: 'm2' }),
        withAccount(
          'm2',
          usage({ rateLimitTier: 'default_claude_max_20x', sampledAt: at(-600_000) })
        )
      );
      await push(h.collector({ token: TOKEN, machineId: 'roamy' }), withAccount('roamy', usage()));
      const r = h.hub.core.call('cli', 'account.list', {}) as {
        value: { accounts: { tier: unknown; readingFrom: string }[] };
      };
      expect(r.value.accounts[0]).toMatchObject({
        readingFrom: 'roamy',
        tier: { label: 'Max $200', source: 'reported' },
      });
    } finally {
      await h.stop();
    }
  });

  it('machines without an account are listed as unreported, and an empty fleet is configured: false', async () => {
    const h = await startHub();
    try {
      expect(h.hub.core.call('cli', 'account.list', {})).toMatchObject({
        ok: true,
        value: { configured: false, accounts: [], unreported: [] },
      });
      await push(h.collector({ token: TOKEN, machineId: 'roamy' }), withAccount('roamy', null));
      expect(h.hub.core.call('cli', 'account.list', {})).toMatchObject({
        ok: true,
        value: { configured: false, unreported: ['roamy'] },
      });
    } finally {
      await h.stop();
    }
  });

  it('the account on the fleet push carries the derived tier and windows (one push, no extra call)', async () => {
    const h = await startHub();
    try {
      await push(
        h.collector({ token: TOKEN, machineId: 'roamy' }),
        withAccount('roamy', usage({ rateLimitTier: 'default_claude_max_20x' }))
      );
      const m = h.hub.store.get('roamy')!;
      expect(m.snapshot.account?.derived).toMatchObject({
        tier: { label: 'Max $200', source: 'reported' },
        monthly: { status: 'not-reported' },
      });
      expect(h.hub.store.list()[0]!.snapshot.account?.derived?.fiveHour.status).toBeDefined();
    } finally {
      await h.stop();
    }
  });

  it('old collector → new hub: an account without rateLimitTier is accepted; the derived part is hub-only', async () => {
    const h = await startHub();
    try {
      const ack = await push(
        h.collector({ token: TOKEN, machineId: 'roamy' }),
        withAccount('roamy', usage())
      );
      expect(ack.ok).toBe(true);
    } finally {
      await h.stop();
    }
  });
});

describe('account schema compatibility (both directions)', () => {
  it('new collector → old hub: the pre-1.4 strict account refuses rateLimitTier, so the hub deploys first', () => {
    const v13 = AccountUsageSchema.omit({ rateLimitTier: true, derived: true });
    const withTier = usage({ rateLimitTier: 'default_claude_max_20x' });
    expect(v13.safeParse(withTier).success).toBe(false);
    expect(AccountUsageSchema.safeParse(withTier).success).toBe(true);
  });
  it('old collector → new hub: an account without the new fields still parses', () => {
    expect(AccountUsageSchema.safeParse(usage()).success).toBe(true);
  });
});

describe('F3 (resilience case 5): a skewed machine clock cannot fake a reading’s age', () => {
  // The hub received the push now; the machine's clock is `skew` off; the reading was taken 60 s
  // before the push on the machine's clock.
  const skewed = (skew: number) => {
    const collectedAt = at(skew);
    const m = machineWith('m4', usage({ sampledAt: at(skew - 60_000) }));
    return { ...m, snapshot: { ...m.snapshot, collectedAt } };
  };
  const derived = (skew: number) =>
    accountViews([skewed(skew)], {}, NOW).get('david@example.com')!.derived;

  it('10 min behind: 60 s old, not 10 min', () => {
    expect(derived(-10 * 60_000).sampleAgeMs).toBe(60_000);
  });
  it('15 min ahead: 60 s old, not clamped to 0', () => {
    expect(derived(15 * 60_000).sampleAgeMs).toBe(60_000);
  });
  it('pace is measured at the true moment of the reading', () => {
    expect(derived(15 * 60_000).fiveHour.elapsedPct).toBe(derived(0).fiveHour.elapsedPct);
    expect(derived(-10 * 60_000).fiveHour.elapsedPct).toBe(derived(0).fiveHour.elapsedPct);
  });
});
