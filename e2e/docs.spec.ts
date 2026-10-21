import { test, expect } from '@playwright/test';
import { watchErrors } from './support/fleet';

// The documents drawer and the Agent page's list + reader, at 1440x900 on the frozen busy snapshot.

const FROZEN = '/?frozen=busy-2026-10-18';

test.use({ viewport: { width: 1440, height: 900 } });

async function quietIntro(page: import('@playwright/test').Page) {
  const gotIt = page.getByRole('button', { name: /got it/i });

  if (await gotIt.count()) {
    await gotIt.first().click();
  }
}

test.describe('v2 documents (frozen busy snapshot)', () => {
  test('the Agent page shows a short list and a big reader in view, with no tiles', async ({
    page,
  }) => {
    const errors = watchErrors(page);

    await page.goto(FROZEN);
    await expect(page.getByTestId('ar-nav')).toBeVisible();
    await quietIntro(page);
    await page.getByTestId('ar-group-fleet').click();
    await page.getByTestId('ar-page-wall').click();
    // a card body opens the agent panel now; the Agent page is reached from the nav
    await page.getByTestId('ar-group-agents').click();
    await page.getByTestId('ar-page-agent').click();
    await expect(page.getByTestId('ar-agent')).toBeVisible();

    const layout = page.getByTestId('ar-agent-docs');

    await layout.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('docs-list')).toBeVisible();

    const reader = await page.getByTestId('docs-reader').boundingBox();

    expect(reader!.height).toBeGreaterThan(450);
    expect(reader!.width).toBeGreaterThan(700);
    // the reader starts inside the first screen once the section is scrolled to
    expect(reader!.y).toBeLessThan(900);
    await expect(page.getByTestId('ar-agent-skills')).toBeVisible();
    await page.screenshot({
      path: process.env.DOCS_SHOT_DIR ? `${process.env.DOCS_SHOT_DIR}/e2e-agent.png` : undefined,
    });
    expect(errors).toEqual([]);
  });

  test('a Run board station opens the agent panel on its Documents tab, over the Run board', async ({
    page,
  }) => {
    const errors = watchErrors(page);

    await page.goto(FROZEN);
    await expect(page.getByTestId('ar-nav')).toBeVisible();
    await quietIntro(page);
    await page.getByTestId('ar-group-fleet').click();
    await page.getByTestId('ar-page-run').click();
    await expect(page.getByTestId('ar-run')).toBeVisible();

    const docs = page.getByTestId('run-station-docs').first();

    await expect(docs).toBeVisible();
    await docs.click();
    // no full-screen overlay: the agent panel, on Documents, with the nav and Run board still there
    await expect(page.getByTestId('docs-drawer')).toHaveCount(0);
    await expect(page.getByTestId('agent-panel')).toBeVisible();
    await expect(page.getByTestId('apanel-tab-documents')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('apanel-body-documents')).toBeVisible();
    await expect(page.getByTestId('ar-nav')).toBeVisible();
    await expect(page.getByTestId('ar-run')).toBeVisible();
    // Esc closes it and leaves the Run board where it was; the × button does the same
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('agent-panel')).toHaveCount(0);
    await expect(page.getByTestId('ar-run')).toBeVisible();
    await docs.click();
    await expect(page.getByTestId('agent-panel')).toBeVisible();
    await page.getByTestId('apanel-close').click();
    await expect(page.getByTestId('agent-panel')).toHaveCount(0);
    await expect(page.getByTestId('ar-run')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a Wall card ⋯ → Documents opens the agent panel on its Documents tab, over the Wall', async ({
    page,
  }) => {
    await page.goto(FROZEN);
    await expect(page.getByTestId('ar-nav')).toBeVisible();
    await quietIntro(page);
    await page.getByTestId('ar-group-fleet').click();
    await page.getByTestId('ar-page-wall').click();

    const card = page.getByTestId('ar-seat-card').first();

    await card.getByTestId('ar-card-more').click();
    await card.getByTestId('ar-card-docs').click();
    await expect(page.getByTestId('ar-card-actions')).toHaveCount(0);
    // the panel opens on the Documents tab, the Wall stays under it, and the page did not change
    await expect(page.getByTestId('agent-panel')).toBeVisible();
    await expect(page.getByTestId('apanel-tab-documents')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('apanel-body-documents')).toBeVisible();
    await expect(page.getByTestId('ar-wall')).toBeVisible();
    await expect(page.getByTestId('ar-agent')).toHaveCount(0);
    // Escape closes it and Back is not needed: the Wall is still there
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('agent-panel')).toHaveCount(0);
    await expect(page.getByTestId('ar-wall')).toBeVisible();
  });

  test('Graph Details and Flow panel open the documents drawer', async ({ page }) => {
    await page.goto(FROZEN);
    await expect(page.getByTestId('ar-nav')).toBeVisible();
    await quietIntro(page);
    await page.getByTestId('ar-group-fleet').click();
    await page.getByTestId('ar-page-graph').click();
    await expect(page.getByTestId('ar-graph')).toBeVisible();

    const details = page.getByTestId('g2-details').first();

    if (await details.count()) {
      await details.click();
      await expect(page.getByTestId('docs-drawer')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('docs-drawer')).toHaveCount(0);
    }

    await page.getByTestId('ar-group-work').click();
    await page.getByTestId('ar-page-flow').click();
    await expect(page.getByTestId('handoff-flow')).toBeVisible();
    await page.getByTestId('flow-next').click();
    await page.getByTestId('flow-docs').first().click();
    await expect(page.getByTestId('docs-drawer')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('docs-drawer')).toHaveCount(0);
  });
});
