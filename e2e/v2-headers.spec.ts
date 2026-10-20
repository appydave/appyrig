import { test, expect, type Page } from '@playwright/test';
import { watchErrors } from './support/fleet';

// v2 clean batch, headers unit, at 1440×900 on the frozen busy snapshot: each WORK / UNDER THE HOOD
// page (and the Agent page) has one 36 px page header, and choosing a rig never scrolls the page.

const FROZEN = '/?frozen=busy-2026-10-18&v=2';

async function quietIntro(page: Page) {
  const gotIt = page.getByRole('button', { name: /got it/i });
  if (await gotIt.count()) await gotIt.first().click();
  const explain = page.getByRole('button', { name: /explain/i }).first();
  if (/on/i.test((await explain.textContent()) ?? '')) await explain.click();
}

async function go(page: Page, group: string, key: string) {
  await page.getByTestId(`v2-group-${group}`).click();
  await page.getByTestId(`v2-page-${key}`).click();
  await expect(page.locator('main[data-testid^="v2-"]')).toHaveCount(1);
}

async function chooseRig(page: Page, key: string) {
  if (await page.getByTestId('rig-drawer-panel').isHidden())
    await page.getByTestId('rig-drawer-tab').click();
  await page.locator(`[data-testid="drawer-rig"][data-rig-key="${key}"]`).first().click();
}

test.describe('v2 one-line page headers', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('each page has one 36 px header', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(FROZEN);
    await quietIntro(page);
    for (const [group, key] of [
      ['work', 'flow'],
      ['fleet', 'run'],
      ['work', 'missions'],
      ['work', 'needs-you'],
      ['work', 'timeline'],
      ['work', 'history'],
      ['agents', 'agent'],
    ] as const) {
      await go(page, group, key);
      const head = page.getByTestId('v2-page-head');
      await expect(head, key).toHaveCount(1);
      const b = await head.boundingBox();
      expect(Math.round(b!.height), `${key} header height`).toBe(36);
    }
    expect(errors).toEqual([]);
  });

  test('choosing a rig on Flow never scrolls the page', async ({ page }) => {
    await page.goto(FROZEN);
    await quietIntro(page);
    await go(page, 'work', 'flow');
    await chooseRig(page, 'm2:appyrig-v15-loadout');
    await expect(page.getByTestId('flow-rig')).toHaveText('appyrig-v15-loadout');
    await page.clock.install();
    for (const key of ['m2:openrig-watch', 'm4:workshop', 'm2:appyrig-v15-loadout']) {
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const before = await page.evaluate(() => window.scrollY);
      await chooseRig(page, key);
      await page.clock.runFor(500); // past the drawer's 250 ms close delay
      expect(await page.evaluate(() => window.scrollY), `scroll after choosing ${key}`).toBe(
        before
      );
    }
  });
});
