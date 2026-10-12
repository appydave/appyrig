import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AccountUsage, FleetMachine } from '@appydave/shared';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import { cardTop } from './ExplainLayer.js';
import FleetStrip from './FleetStrip.js';
import Accounts, { CACHED_LABEL } from './Accounts.js';

describe('C3 · F29: the Explain card is never clipped by the window', () => {
  const vh = 600;
  it('below the target when it fits, else above, else pinned inside', () => {
    expect(cardTop({ top: 100, bottom: 120 }, 200, vh)).toBe(130);
    expect(cardTop({ top: 500, bottom: 520 }, 200, vh)).toBe(290);
    // a tall card near the top (the walk's case): never above 8 px nor past the bottom
    const t = cardTop({ top: 40, bottom: 60 }, 560, vh);
    expect(t).toBeGreaterThanOrEqual(8);
    expect(t + 560).toBeLessThanOrEqual(vh - 8);
  });
});

describe('C3 · F30: the strip counts follow the machine filter', () => {
  it('counts only the shown machines and names the hidden ones', () => {
    const m2 = fleetMachine(snapshot('m2'));
    const roamy = fleetMachine(snapshot('roamy'));
    render(
      <FleetStrip
        machines={[m2, roamy]}
        shown={[m2]}
        now={Date.now()}
        link="connected"
        received
        error={null}
        onOpen={() => {}}
      />
    );
    const stopped = m2.snapshot.seats.filter((s) => s.status === 'stopped').length;
    expect(screen.getByTestId('fleet-counts')).toHaveTextContent(`${stopped} stopped`);
    expect(screen.getByTestId('fleet-counts-hidden')).toHaveTextContent(
      'not counting Roamy (hidden by the filter)'
    );
  });
});

describe('C3 · F24: the tier label follows its actual source; no stray "?"', () => {
  const card = (email: string, source: 'reported' | 'config'): FleetMachine => {
    const fm = fleetMachine(snapshot(email.startsWith('a') ? 'm2' : 'roamy--blocked'));
    const account = {
      email,
      plan: 'claude_max',
      fiveHourPct: null,
      fiveHourResetsAt: null,
      sevenDayPct: null,
      sevenDayResetsAt: null,
      sampledAt: null,
      derived: {
        tier: { label: source === 'reported' ? 'Max $200' : 'Max $100', source },
        fiveHour: {
          status: 'no-reading',
          usedPct: null,
          resetsAt: null,
          windowMs: 18e6,
          startsAt: null,
          elapsedPct: null,
          elapsedNowPct: null,
          paceDeltaPct: null,
          projectedPct: null,
        },
        sevenDay: {
          status: 'no-reading',
          usedPct: null,
          resetsAt: null,
          windowMs: 6048e5,
          startsAt: null,
          elapsedPct: null,
          elapsedNowPct: null,
          paceDeltaPct: null,
          projectedPct: null,
        },
        readingFrom: null,
      },
    } as unknown as AccountUsage;
    return { ...fm, snapshot: { ...fm.snapshot, account } };
  };

  it('one tier from the cached profile, one from config, each labelled by where it came from', () => {
    render(
      <Accounts
        machines={[card('a@x.com', 'reported'), card('b@x.com', 'config')]}
        now={Date.now()}
      />
    );
    const tiers = screen.getAllByTestId('account-tier').map((t) => t.textContent);
    expect(tiers).toContain('Max $200 · from the cached profile');
    expect(tiers).toContain('Max $100 · from config');
    for (const l of screen.getAllByTestId('account-cached'))
      expect(l.textContent).toBe(CACHED_LABEL);
  });
});
