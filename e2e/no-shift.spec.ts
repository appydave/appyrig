import { test, expect, type Page } from '@playwright/test';

/**
 * AFTER walk R2, R3: screens never shift on a state change. Real browser, real CSS, so a test can
 * see what jsdom can't: the actual positions before and after.
 */
const positions = (page: Page, selector: string) =>
  page.evaluate(
    (s) =>
      [...document.querySelectorAll(s)].map((e) => {
        const r = e.getBoundingClientRect();

        return [r.x, r.y, r.width, r.height];
      }),
    selector
  );

test('pressing Replay run and Pause moves nothing on the replay bar', async ({ page }) => {
  await page.goto('/?frozen=busy-2026-10-18&v=2&page=flow');
  await expect(page.getByTestId('flow-play')).toBeVisible({ timeout: 20_000 });

  const others = '[data-testid=flow-prev], [data-testid=flow-time], .flow-replay input';
  const before = await positions(page, others);

  await page.getByTestId('flow-play').click();
  await expect(page.getByTestId('flow-play')).toHaveText(/pause/i);
  expect(await positions(page, others)).toEqual(before);

  await page.getByTestId('flow-play').click();
  await expect(page.getByTestId('flow-play')).toHaveText(/replay run/i);
  expect(await positions(page, others)).toEqual(before);
});

test('a seat turning working or blocked moves nothing inside its card', async ({ page }) => {
  await page.goto('/?frozen=busy-2026-10-18&v=2&page=wall');
  await expect(page.locator('.wcard').first()).toBeVisible({ timeout: 20_000 });

  const parts = '.wcard-main, .wcard-head, .wcard-term, .wcard-foot';
  const setStates = (state: string) =>
    page.evaluate((s) => {
      document.querySelectorAll('.wcard').forEach((c) => c.setAttribute('data-pip', s));
    }, state);

  await setStates('idle');

  const before = await positions(page, parts);

  for (const state of ['working', 'blocked', 'idle']) {
    await setStates(state);
    expect(await positions(page, parts)).toEqual(before);
  }
});
