import { test, expect, type Page } from '@playwright/test';
import { chooseRigInDrawer, watchErrors } from './support/fleet';

// Integration walk, 2026-10-19: on Flow, choosing a rig in the Rigs drawer left the page scrolled
// (window.scrollY 44). The open drawer ran past the bottom of the window, so bringing its tab into
// view to close it scrolled the page. Choosing a rig must never scroll it.

const FROZEN = '/?frozen=busy-2026-10-18&v=2';

async function quietIntro(page: Page) {
  const gotIt = page.getByRole('button', { name: /got it/i });
  if (await gotIt.count()) await gotIt.first().click();
}

test.describe('v2 Rigs drawer never scrolls the page', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('Flow: choosing rigs through the drawer leaves scrollY where it was', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(FROZEN);
    await quietIntro(page);
    await page.getByTestId('ar-group-work').click();
    await page.getByTestId('ar-page-flow').click();
    await expect(page.locator('main[data-testid="ar-flow"]')).toBeVisible();
    await page.clock.install();
    for (const key of ['m2:appyrig-v15-loadout', 'm2:openrig-watch', 'm2:d09-crew']) {
      const before = await page.evaluate(() => window.scrollY);
      await chooseRigInDrawer(page, key);
      await page.clock.runFor(500); // lets the page's timers (the drawer has a 250 ms close timer) run
      expect(await page.evaluate(() => window.scrollY), `scrollY after choosing ${key}`).toBe(
        before
      );
    }
    // and the open drawer fits in the window, so nothing has to scroll to reach it
    await page.getByTestId('rig-drawer-tab').click();
    const panel = await page.getByTestId('rig-drawer-panel').boundingBox();
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(900);
    expect(errors).toEqual([]);
  });
});
