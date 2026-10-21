import { test, expect } from '@playwright/test';

// V55: changing page starts at the top; Back puts the page back where it was left.
test.use({ viewport: { width: 1280, height: 420 } });

test('a new page opens at the top and Back restores the old scroll', async ({ page }) => {
  await page.goto('/?frozen=busy-2026-10-18&v=2');
  await expect(page.getByTestId('ar-strip')).toBeVisible({ timeout: 20_000 });
  const dismiss = page.getByTestId('ar-welcome-dismiss');
  if (await dismiss.count()) {
    await dismiss.click();
  }

  const scrolled = await page.evaluate(() => {
    document.documentElement.style.minHeight = '3000px';
    window.scrollTo(0, 300);

    return window.scrollY;
  });
  expect(scrolled).toBeGreaterThan(100);

  await page.getByTestId('ar-group-work').click();
  await expect(page.getByTestId('ar-nav')).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await page.goBack();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
});
