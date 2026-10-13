import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AccountUsage, FleetMachine, MachineHealth } from '@appydave/shared';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import Accounts from './Accounts.js';
import Machines from './Machines.js';

/**
 * Fix-first F3 (resilience case 5): ages on screen survive a skewed collector clock. The hub got
 * the push 2 s ago; the machine's clock is `skew` off the hub's; the reading was taken 5 s before
 * the push on the machine's clock. Its true age is 7 s, whatever the skew.
 */
const NOW = Date.parse('2026-10-13T04:00:00.000Z');
const MIN = 60_000;
const ok = <T,>(value: T) => ({ status: 'ok' as const, value });
const GB = 1024 ** 3;

function skewed(skew: number, before = 5_000): FleetMachine {
  const fm = fleetMachine(snapshot('m2'));
  const receivedAt = NOW - 2_000;
  const collectedAt = receivedAt + skew;
  const sampledAt = new Date(collectedAt - before).toISOString();
  const health = {
    sampledAt,
    memory: {
      totalBytes: ok(24 * GB),
      usedBytes: ok(10 * GB),
      pressureLevel: ok('normal'),
      freePct: ok(59),
      swapUsedBytes: ok(1 * GB),
      swapTotalBytes: ok(14 * GB),
    },
    processes: {
      claude: ok(3),
      tmuxSessions: ok(4),
      terminalShells: ok(2),
      terminalApps: ok([]),
    },
  } as unknown as MachineHealth;
  const account: AccountUsage = {
    email: 'a@x.com',
    plan: 'claude_max',
    fiveHourPct: 20,
    fiveHourResetsAt: new Date(NOW + 2 * 3600_000).toISOString(),
    sevenDayPct: 30,
    sevenDayResetsAt: new Date(NOW + 3 * 86400_000).toISOString(),
    sampledAt,
  };
  return {
    ...fm,
    lastSeen: new Date(receivedAt).toISOString(),
    snapshot: { ...fm.snapshot, collectedAt: new Date(collectedAt).toISOString(), health, account },
  };
}

describe('F3: Machines and Accounts ages under clock skew', () => {
  it('clock 10 min behind: "sampled 7s ago", no old-reading mark, no clock note', () => {
    render(<Machines machines={[skewed(-10 * MIN)]} hidden={0} now={NOW} />);
    const age = screen.getByTestId('machine-age');
    expect(age.textContent).toMatch(/sampled 7s ago/);
    expect(age.textContent).not.toMatch(/old reading/);
    expect(within(age).queryByTestId('clock-ahead')).toBeNull();
  });

  it('clock 15 min ahead: "sampled 7s ago · clock ahead 15 min", never "0s ago"', () => {
    render(<Machines machines={[skewed(15 * MIN)]} hidden={0} now={NOW} />);
    const age = screen.getByTestId('machine-age');
    expect(age.textContent).toMatch(/sampled 7s ago/);
    expect(within(age).getByTestId('clock-ahead').textContent).toBe('clock ahead 15 min');
  });

  it('clock 15 min ahead, reading 2 min old: still an old reading', () => {
    render(<Machines machines={[skewed(15 * MIN, 2 * MIN)]} hidden={0} now={NOW} />);
    expect(screen.getByTestId('machine-age').textContent).toMatch(/2m ago.*old reading/);
  });

  it('Accounts: the same reading reads 7s old at either skew; ahead says so', () => {
    const { unmount } = render(<Accounts machines={[skewed(-10 * MIN)]} now={NOW} />);
    const behind = screen.getByTestId('account-source');
    expect(behind.textContent).toMatch(/read on M2 · 7s ago/);
    expect(within(behind).queryByTestId('old-reading')).toBeNull();
    unmount();
    render(<Accounts machines={[skewed(15 * MIN)]} now={NOW} />);
    const ahead = screen.getByTestId('account-source');
    expect(ahead.textContent).toMatch(/read on M2 · 7s ago/);
    expect(within(ahead).getByTestId('clock-ahead').textContent).toBe('clock ahead 15 min');
  });
});

describe('F4 (resilience 1, 3b): a stale account card is dimmed and says why', () => {
  it('live and fresh: not stale', () => {
    render(<Accounts machines={[skewed(0)]} now={NOW} />);
    expect(screen.getByTestId('account-card')).not.toHaveAttribute('data-stale');
  });

  it('its machine asleep: card stale, "M2 asleep: not reporting", even inside 15 min', () => {
    render(<Accounts machines={[{ ...skewed(0), liveness: 'asleep' }]} now={NOW} />);
    const card = screen.getByTestId('account-card');
    expect(card).toHaveAttribute('data-stale', 'true');
    expect(within(card).getByTestId('machine-asleep').textContent).toBe('M2 asleep: not reporting');
  });

  it('a reading 20 min old: card stale with the old-reading mark', () => {
    render(<Accounts machines={[skewed(0, 20 * MIN)]} now={NOW} />);
    const card = screen.getByTestId('account-card');
    expect(card).toHaveAttribute('data-stale', 'true');
    expect(within(card).getByTestId('old-reading')).toBeInTheDocument();
  });
});
