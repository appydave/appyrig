import { test, expect } from '@playwright/test';
import { watchErrors } from './support/fleet';

// The documents drawer and the Agent page's list + reader, at 1440x900 on the frozen busy snapshot.

const FROZEN = '/?frozen=busy-2026-10-18';
test.use({ viewport: { width: 1440, height: 900 } });

async function quietIntro(page: import('@playwright/test').Page) {
  const gotIt = page.getByRole('button', { name: /got it/i });
  if (await gotIt.count()) await gotIt.first().click();
}

test.describe('v2 documents (frozen busy snapshot)', () => {
  test('the Agent page shows a short list and a big reader in view, with no tiles', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await page.goto(FROZEN);
    await expect(page.getByTestId('view-wall')).toBeVisible();
    await quietIntro(page);
    await page.keyboard.press('v');
    await expect(page.getByTestId('v2-nav')).toBeVisible();
    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-wall').click();
    // a card body opens the agent panel now; the Agent page is reached from the nav
    await page.getByTestId('v2-group-agents').click();
    await page.getByTestId('v2-page-agent').click();
    await expect(page.getByTestId('v2-agent')).toBeVisible();
    const layout = page.getByTestId('v2a-docs');
    await layout.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('docs-list')).toBeVisible();
    const reader = await page.getByTestId('docs-reader').boundingBox();
    expect(reader!.height).toBeGreaterThan(450);
    expect(reader!.width).toBeGreaterThan(700);
    // the reader starts inside the first screen once the section is scrolled to
    expect(reader!.y).toBeLessThan(900);
    await expect(page.getByTestId('v2a-skills')).toBeVisible();
    await page.screenshot({
      path: process.env.DOCS_SHOT_DIR ? `${process.env.DOCS_SHOT_DIR}/e2e-agent.png` : undefined,
    });
    expect(errors).toEqual([]);
  });

  test('a Run board station opens the drawer; it is tall, closes on Escape', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(FROZEN);
    await expect(page.getByTestId('view-wall')).toBeVisible();
    await quietIntro(page);
    await page.keyboard.press('v');
    await expect(page.getByTestId('v2-nav')).toBeVisible();
    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-run').click();
    await expect(page.getByTestId('v2-run')).toBeVisible();
    const docs = page.getByTestId('run-station-docs').first();
    await expect(docs).toBeVisible();
    await docs.click();
    const drawer = page.getByTestId('docs-drawer');
    await expect(drawer).toBeVisible();
    const box = await drawer.boundingBox();
    // below the top bar, down to the bottom of the window
    const nav = await page.getByTestId('v2-nav').boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(nav!.y + nav!.height - 1);
    expect(box!.y + box!.height).toBeGreaterThanOrEqual(895);
    expect(box!.width).toBeGreaterThan(1000);
    await expect(page.getByTestId('docs-list')).toBeVisible();
    await expect(page.getByTestId('docs-reader')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('a Wall card ⋯ → Documents opens the agent panel on its Documents tab, over the Wall', async ({
    page,
  }) => {
    await page.goto(FROZEN);
    await expect(page.getByTestId('view-wall')).toBeVisible();
    await quietIntro(page);
    await page.keyboard.press('v');
    await expect(page.getByTestId('v2-nav')).toBeVisible();
    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-wall').click();
    const card = page.getByTestId('v2-seat-card').first();
    await card.getByTestId('v2-card-more').click();
    await card.getByTestId('v2-card-docs').click();
    await expect(page.getByTestId('v2-card-actions')).toHaveCount(0);
    // the panel opens on the Documents tab, the Wall stays under it, and the page did not change
    await expect(page.getByTestId('agent-panel')).toBeVisible();
    await expect(page.getByTestId('apanel-tab-documents')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('apanel-body-documents')).toBeVisible();
    await expect(page.getByTestId('v2-wall')).toBeVisible();
    await expect(page.getByTestId('v2-agent')).toHaveCount(0);
    // Escape closes it and Back is not needed: the Wall is still there
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('agent-panel')).toHaveCount(0);
    await expect(page.getByTestId('v2-wall')).toBeVisible();
  });

  test('Graph Details and Flow panel open the documents drawer', async ({ page }) => {
    await page.goto(FROZEN);
    await expect(page.getByTestId('view-wall')).toBeVisible();
    await quietIntro(page);
    await page.keyboard.press('v');
    await expect(page.getByTestId('v2-nav')).toBeVisible();
    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-graph').click();
    await expect(page.getByTestId('v2-graph')).toBeVisible();
    const details = page.getByTestId('g2-details').first();
    if (await details.count()) {
      await details.click();
      await expect(page.getByTestId('docs-drawer')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('docs-drawer')).toHaveCount(0);
    }
    await page.getByTestId('v2-group-work').click();
    await page.getByTestId('v2-page-flow').click();
    await expect(page.getByTestId('handoff-flow')).toBeVisible();
    await page.getByTestId('flow-next').click();
    await page.getByTestId('flow-docs').first().click();
    await expect(page.getByTestId('docs-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('docs-drawer')).toHaveCount(0);
  });
});
