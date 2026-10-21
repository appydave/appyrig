import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseAccountIdentity, parseUsageLog, readAccount } from './account.js';

const HEADER =
  'epoch,iso,five_pct,five_resets_at,seven_pct,seven_resets_at,session_cost_usd,session';

describe('account adapter', () => {
  it('reads only the email, plan type and rate-limit tier from the login record', () => {
    const text = JSON.stringify({
      oauthAccount: {
        emailAddress: 'david@example.com',
        organizationType: 'claude_max',
        organizationRateLimitTier: 'default_claude_max_20x',
        profileFetchedAt: 1791805455044,
        accountUuid: 'should-not-travel',
      },
      someSecret: 'nope',
    });

    expect(parseAccountIdentity(text)).toEqual({
      email: 'david@example.com',
      plan: 'claude_max',
      rateLimitTier: 'default_claude_max_20x',
      profileFetchedAt: new Date(1791805455044).toISOString(),
    });
    expect(parseAccountIdentity('not json')).toEqual({
      email: null,
      plan: null,
      rateLimitTier: null,
      profileFetchedAt: null,
    });
  });

  it('v1.5 C: a missing or odd profileFetchedAt is "not reported", never a guess', () => {
    const at = (v: unknown) =>
      parseAccountIdentity(
        JSON.stringify({ oauthAccount: { emailAddress: 'a@b', profileFetchedAt: v } })
      ).profileFetchedAt;

    expect(at(undefined)).toBeNull();
    expect(at('yesterday')).toBeNull();
    expect(at(-1)).toBeNull();
  });

  it('v1.5 C hard rule: no collector code names a login store (credentials file or Keychain)', () => {
    const dir = new URL('..', import.meta.url).pathname;
    const files = readdirSync(dir, { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));

    for (const f of files) {
      // comments may explain the rule; code may not name the store
      const code = readFileSync(join(dir, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      expect(code, f).not.toMatch(/\.credentials\.json|find-generic-password|Keychain|'security'/i);
    }
  });

  it('takes each window from the latest row that has it, and keeps >100%', () => {
    const log = [
      HEADER,
      '1791618411,2026-10-10T14:46:51,10,1791622800,36,1791835200,8.1,04b6c64a',
      '1791619220,2026-10-10T15:00:20,102,1791622800,,0,2.0,38535fc7',
    ].join('\n');
    const r = parseUsageLog(log);

    expect(r.fiveHourPct).toBe(102);
    expect(r.sevenDayPct).toBe(36);
    expect(r.sevenDayResetsAt).toBe(new Date(1791835200 * 1000).toISOString());
    expect(r.sampledAt).toBe(new Date(1791619220 * 1000).toISOString());
  });

  it('a machine with a login but no sampler reports null, never 0', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appyrig-acct-'));
    const claudeJson = join(dir, 'claude.json');

    writeFileSync(claudeJson, JSON.stringify({ oauthAccount: { emailAddress: 'a@b.c' } }));

    const r = await readAccount({ claudeJson, usageLog: join(dir, 'missing.csv') });

    expect(r).toMatchObject({
      email: 'a@b.c',
      fiveHourPct: null,
      sevenDayPct: null,
      sampledAt: null,
    });
  });

  it('no login record at all → null account', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'appyrig-acct-'));

    expect(await readAccount({ claudeJson: join(dir, 'x'), usageLog: join(dir, 'y') })).toBeNull();
  });
});
