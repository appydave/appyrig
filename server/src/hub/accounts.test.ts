import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AccountUsageSchema,
  FIVE_HOUR_MS,
  SEVEN_DAY_MS,
  type AccountUsage,
} from '@appydave/shared';
import { deriveAccount, reportedTier, tierOf, windowOf } from './accounts.js';
import { loadSnapshot, push, startHub, TOKEN } from '../test/hubHarness.js';

const NOW = new Date('2026-10-11T12:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const usage = (over: Partial<AccountUsage> = {}): AccountUsage => ({
  email: 'david@ideasmen.com.au',
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
      accounts: { 'david@ideasmen.com.au': { tier: 'Max $100' } },
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
  it('reports used, elapsed, pace and a projection', () => {
    const w = windowOf(40, at(FIVE_HOUR_MS / 2), FIVE_HOUR_MS, NOW);
    expect(w).toMatchObject({
      status: 'reading',
      usedPct: 40,
      elapsedPct: 50,
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
  it('monthly is always not-reported, and sample age is measured, not assumed', () => {
    const d = deriveAccount(usage(), {}, NOW);
    expect(d.monthly).toEqual({ status: 'not-reported' });
    expect(d.sampleAgeMs).toBe(60_000);
    expect(d.asOf).toBe(NOW.toISOString());
    expect(deriveAccount(usage({ sampledAt: null }), {}, NOW).sampleAgeMs).toBeNull();
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
          'david@ideasmen.com.au': { tier: 'Max $200' },
          'david@appydave.com': { tier: 'Max $100' },
        },
      })
    );
    const h = await startHub({ configPath });
    try {
      const c = h.collector({ token: TOKEN, machineId: 'roamy' });
      const m4 = h.collector({ token: TOKEN, machineId: 'm2' });
      await push(m4, withAccount('m2', usage({ email: 'david@ideasmen.com.au' })));
      await push(c, withAccount('roamy', usage({ email: 'david@ideasmen.com.au' })));

      const before = h.hub.core.call('cli', 'account.list', {});
      expect(before).toMatchObject({ ok: true, value: { configured: true, unreported: [] } });
      const accts = (before as { value: { accounts: { email: string; machines: string[] }[] } })
        .value.accounts;
      expect(accts).toHaveLength(1);
      expect(accts[0]).toMatchObject({
        email: 'david@ideasmen.com.au',
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
        ['david@ideasmen.com.au', ['m2'], 'Max $200', 'config'],
      ]);
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
