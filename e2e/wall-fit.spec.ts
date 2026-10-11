import { test, expect } from '@playwright/test';
import { signIn, watchErrors } from './support/fleet';

// v1.4 S3-fit done-when: with 4 working teams and 5 idle-only teams (the synthetic `fit` machine),
// the running content (working groups + the idle strip) ends above the fold at 1440×900.

test.use({ viewport: { width: 1440, height: 900 } });

test('4 working teams + 5 idle-only teams fit above the fold at 1440×900', async ({ page }) => {
  const errors = watchErrors(page);
  // Show only the fit machine: the other fixtures add teams this check is not about.
  await page.addInitScript(() => {
    localStorage.setItem('appyrig.hiddenMachines', JSON.stringify(['roamy', 'm2']));
    localStorage.setItem('appyrig.hint', 'seen');
  });
  await signIn(page);
  await page.goto('/');
  const working = page.locator('[data-testid="wall-group"][data-state="working"]');
  await expect(working).toHaveCount(4, { timeout: 15_000 });
  await expect(page.getByTestId('idle-team')).toHaveCount(5);
  const bottom = await page.evaluate(() => {
    const els = [
      ...document.querySelectorAll('[data-testid="wall-group"][data-state="working"]'),
      ...document.querySelectorAll('[data-testid="idle-strip"]'),
    ];
    return Math.max(...els.map((e) => e.getBoundingClientRect().bottom));
  });
  expect(bottom, `running content ends at ${Math.round(bottom)} px`).toBeLessThanOrEqual(900);
  // Every seat is still one click away: busy seats as tiles, the quiet ones as chips.
  // fit: 6 working seats (3 + 1 + 1 + 1) and 8 quiet seats in working teams (2 + 2 + 3 + 1).
  await expect(page.getByTestId('seat-tile')).toHaveCount(6);
  await expect(page.getByTestId('seat-chip')).toHaveCount(8);
  // QA S3-fit D1: the arrow keys walk chips too (S2: arrows everywhere on the Wall).
  let onChip = false;
  for (let i = 0; i < 20 && !onChip; i++) {
    await page.keyboard.press('ArrowRight');
    onChip = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.testid === 'seat-chip'
    );
  }
  expect(onChip, 'ArrowRight reaches a seat chip').toBe(true);
  expect(errors, 'no console errors').toEqual([]);
});
