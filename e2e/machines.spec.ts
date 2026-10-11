import { test, expect } from '@playwright/test';
import { openWall, watchErrors, E2E_MACHINES } from './support/fleet';

// v1.4 S6-ui on the fixture hub: the fake collector sends no health object (as an older collector),
// so every machine must read "no health data yet", never 0 or "normal".

test.describe('v1.4 S6 machine health', () => {
  test('the strip marks each machine; no data is said in words; the mark opens Machines', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openWall(page);
    const marks = page.getByTestId('health-mark');
    await expect(marks).toHaveCount(E2E_MACHINES);
    for (const m of await marks.all()) {
      await expect(m).toHaveAttribute('data-kind', 'no-data');
      await expect(m).toHaveText('– no data');
    }
    await marks.first().click();
    await expect(page.getByTestId('view-body-machines')).toBeVisible();
    const cards = page.getByTestId('machine-card');
    await expect(cards).toHaveCount(E2E_MACHINES);
    for (const c of await cards.all()) {
      await expect(c).toHaveAttribute('data-health', 'no-data');
      await expect(c.getByTestId('machine-no-data')).toContainText('predates v1.4');
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);
    expect(errors, 'no console errors').toEqual([]);
  });
});
