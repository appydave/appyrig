import { test, expect } from '@playwright/test';
import { expectedSeats, signIn, watchErrors, E2E_MACHINES } from './support/fleet';

// v1.4 S3-ui: the calmer Wall and the machine filter, on the fixture hub (roamy--blocked + m2).

test.describe('v1.4 S3 calmer Wall', () => {
  test('order stated, stopped groups collapsed, groups never go back up the order', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/');
    await expect(page.getByTestId('wall-group').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('wall-order')).toContainText('blocked → working → idle');
    const states = await page
      .getByTestId('wall-group')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-state') ?? ''));
    const rank = ['blocked', 'working', 'idle', 'unknown', 'stopped', 'asleep'];
    const ranks = states.map((s) => rank.indexOf(s));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    const stopped = page.locator('[data-testid="wall-group"][data-state="stopped"]');
    if ((await stopped.count()) > 0) {
      await expect(stopped.first()).toHaveAttribute('data-open', 'false');
      await expect(stopped.first().getByTestId('seat-tile')).toHaveCount(0);
      await stopped.first().getByTestId('wall-group-head').click();
      await expect(stopped.first().getByTestId('seat-tile')).not.toHaveCount(0);
    }
    expect(errors, 'no console errors').toEqual([]);
  });

  test('the machine filter hides a machine, says so, and survives a reload', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/');
    await expect(page.getByTestId('wall-group').first()).toBeVisible({ timeout: 15_000 });
    const m2 = expectedSeats().filter((s) => s.machineId === 'm2');
    expect(m2.length).toBeGreaterThan(0);
    await page.locator('[data-testid="machine-filter"][data-machine-id="m2"]').click();
    await expect(page.getByTestId('wall-hidden')).toContainText('M2');
    await expect(page.locator('[data-testid="seat-tile"][data-machine-id="m2"]')).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('wall-hidden')).toContainText('M2');
    // The strip still lists every machine.
    await expect(page.getByTestId('machine-chip')).toHaveCount(E2E_MACHINES);
    // Rig chips follow the filter too.
    await page.getByTestId('view-map').click();
    await expect(page.locator('[data-testid="rig-chip"][data-rig-key^="m2:"]')).toHaveCount(0);
    await page.getByTestId('view-wall').click();
    await page.getByTestId('wall-show-machine').click();
    await expect(page.getByTestId('wall-hidden')).toHaveCount(0);
    expect(errors, 'no console errors').toEqual([]);
  });
});
