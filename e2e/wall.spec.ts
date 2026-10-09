import { test, expect } from '@playwright/test';
import { openWall, tileFor, watchErrors } from './support/fleet';

// AC 10 — Playwright smoke: Wall. Fixture-fed hub (fake collector replaying roamy--blocked + m2):
// ≥ 1 tile per seat, state pip + freshness label visible, no console errors.

test.describe('Wall', () => {
  test('shows one tile per fixture seat, with a pip and a freshness label each', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const seats = await openWall(page);

    for (const seat of seats) {
      const tile = tileFor(page, seat);
      const label = `${seat.machineId}/${seat.seatId}`;
      await expect(tile, `${label}: exactly one tile`).toHaveCount(1);
      await expect(tile, `${label}: status`).toHaveAttribute('data-status', seat.status);
      await expect(tile, `${label}: liveness`).toHaveAttribute('data-liveness', 'live');

      const pip = tile.getByTestId('seat-pip');
      await expect(pip, `${label}: pip visible`).toBeVisible();
      await expect(pip, `${label}: pip status`).toHaveAttribute('data-status', seat.status);

      const freshness = tile.getByTestId('seat-freshness');
      await expect(freshness, `${label}: freshness visible`).toBeVisible();
      await expect(freshness, `${label}: freshness has text`).not.toHaveText(/^\s*$/);
    }

    expect(errors, 'no console errors on the Wall').toEqual([]);
  });

  test('a live machine never shows a seat as asleep, and every fixture state reaches a pip', async ({
    page,
  }) => {
    const seats = await openWall(page);
    // The fixtures cover working, idle, blocked, unknown (roamy--blocked) and stopped (m2).
    const shown = await page
      .getByTestId('seat-pip')
      .evaluateAll((pips) => [...new Set(pips.map((p) => p.getAttribute('data-status')))].sort());
    expect(shown).toEqual([...new Set(seats.map((s) => s.status))].sort());
    await expect(page.locator('[data-testid="seat-tile"][data-liveness="asleep"]')).toHaveCount(0);
  });
});
