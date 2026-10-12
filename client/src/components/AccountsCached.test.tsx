import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AccountUsage, FleetMachine } from '@appydave/shared';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import Accounts, { CACHED_LABEL, profileAge } from './Accounts.js';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');

function on(
  name: 'roamy--blocked' | 'm2',
  email: string,
  profileFetchedAt?: string | null
): FleetMachine {
  const fm = fleetMachine(snapshot(name));
  const account: AccountUsage = {
    email,
    plan: 'claude_max',
    fiveHourPct: null,
    fiveHourResetsAt: null,
    sevenDayPct: null,
    sevenDayResetsAt: null,
    sampledAt: null,
    ...(profileFetchedAt === undefined ? {} : { profileFetchedAt }),
  };
  return { ...fm, snapshot: { ...fm.snapshot, account } };
}

describe('v1.5 C: the account email is a cached profile, not proof of login', () => {
  it('every card carries the label, with the long explanation on hover', () => {
    render(
      <Accounts
        machines={[
          on('m2', 'b@x.com', '2026-10-12T11:00:00.000Z'),
          on('roamy--blocked', 'a@x.com'),
        ]}
        now={NOW}
      />
    );
    const cards = screen.getAllByTestId('account-card');
    expect(cards).toHaveLength(2);
    for (const c of cards) {
      const label = within(c).getByTestId('account-cached');
      expect(label.textContent).toContain(CACHED_LABEL);
      expect(label.getAttribute('title')).toMatch(/credentials\.json/);
    }
  });

  it("each machine on a card shows its cache's age, or why it cannot", () => {
    render(
      <Accounts
        machines={[
          on('m2', 'a@x.com', '2026-10-12T11:00:00.000Z'),
          on('roamy--blocked', 'a@x.com'),
        ]}
        now={NOW}
      />
    );
    const line = screen.getByTestId('account-machines').textContent ?? '';
    expect(line).not.toMatch(/signed in/i);
    expect(line).toMatch(/M2 \(cached 1h ago\)/);
    expect(line).toContain('collector older than v1.5');
  });

  it('QA C1–C3: nothing on the card or in its help claims a login', async () => {
    const { container } = render(
      <Accounts machines={[on('m2', 'b@x.com', '2026-10-12T11:00:00.000Z')]} now={NOW} />
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/reported by the login|draws? on it|signed in/i);
    expect(text).toMatch(/Machines whose cached profile names this account/);
    expect(text).toMatch(
      /running there \(which login they use is not read\)|No Claude seats running/
    );
    const { GLOSSARY } = await import('../learn/glossary.js');
    const { legendFor } = await import('../learn/legend.js');
    const help = JSON.stringify([GLOSSARY, legendFor('accounts')]);
    expect(help).not.toMatch(/reported by the login|signed into|draws? on it/i);
  });

  it('profileAge says unknown rather than guessing', () => {
    expect(profileAge(null, NOW)).toBe('(cache age unknown)');
    expect(profileAge(undefined, NOW)).toMatch(/older than v1.5/);
  });
});
