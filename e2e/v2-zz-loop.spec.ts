import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test('loop: open the agent panel, Escape closes it', async ({ page }) => {
  test.setTimeout(120_000);
  page.on('console', (m) => {
    if (m.text().startsWith('DIAG')) console.log(m.text());
  });
  await page.addInitScript(() => {
    const t0 = performance.now();
    const log = (...a: unknown[]) => console.log('DIAG', Math.round(performance.now() - t0), ...a);
    const back = history.back.bind(history);
    history.back = () => {
      log('back()', location.search, 'len', history.length, JSON.stringify(history.state));
      back();
    };
    window.addEventListener('popstate', () => log('popstate', location.search), true);
    window.addEventListener('keydown', (e) => log('keydown', e.key), true);
  });
  await page.goto('/?frozen=busy-2026-10-18&v=2');
  const gotIt = page.getByRole('button', { name: /got it/i });
  if (await gotIt.count()) await gotIt.first().click();
  await page.getByTestId('v2-group-fleet').click();
  await page.getByTestId('v2-page-wall').click();
  await expect(page.getByTestId('v2-wall')).toBeVisible();
  const fails: number[] = [];
  for (let i = 0; i < 25; i++) {
    await page.getByTestId('terminal-card-open').first().click();
    await expect(page.getByTestId('agent-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    try {
      await expect(page.getByTestId('agent-panel')).toHaveCount(0, { timeout: 2000 });
    } catch {
      fails.push(i);
      console.log('DIAG FAIL iteration', i, await page.evaluate(() => location.search));
      await page.getByTestId('apanel-close').click();
      await expect(page.getByTestId('agent-panel')).toHaveCount(0);
    }
  }
  console.log('DIAG failures', JSON.stringify(fails));
  expect(fails).toEqual([]);
});
