import { test, expect, type Page } from '@playwright/test';
import { chooseRigInDrawer, watchErrors } from './support/fleet';

// The v2 frame at 1440 x 900 on the frozen busy snapshot: one thin bar, machine badges, the Rigs
// drawer at the left (the page shrinks beside it), and the page starting high on every page. Every
// helper is still reachable.

const FROZEN = '/?frozen=busy-2026-10-18&v=2';
// the Rig Map is no longer in the nav (graph2): it is an alias that opens the Graph
const FLEET_PAGES = ['wall', 'graph', 'run'] as const;
const FLOW = 'flow';
/** The brief's line: content starts at y <= 140 on Wall, Graph, Rig Map, Flow and Run board. */
const MAX_CONTENT_Y = 140;

test.use({ viewport: { width: 1440, height: 900 } });

async function open(page: Page) {
  await page.goto(FROZEN);
  await expect(page.getByTestId('v2-strip')).toBeVisible({ timeout: 20_000 });
  const gotIt = page.getByRole('button', { name: /got it/i });
  if (await gotIt.count()) await gotIt.first().click();
}

/** Where the page's own content starts: the first child of the main column after the badge row. */
const contentTop = (page: Page) =>
  page.evaluate(() => {
    const kids = [...document.querySelector('.app-main')!.children];
    const strip = document.querySelector('[data-testid="v2-strip"]')!;
    const first = kids[kids.indexOf(strip) + 1] as HTMLElement | undefined;
    // layout position, not where a scroll left it (the Graph scrolls a chosen rig into view)
    const main = document.querySelector('.app-main') as HTMLElement;
    return first
      ? Math.round(first.getBoundingClientRect().top + window.scrollY + main.scrollTop)
      : -1;
  });

test.describe('v2 shell (frozen busy snapshot, 1440 px)', () => {
  test('the content starts at y <= 140 on every page, and the frame is the same height on all', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = watchErrors(page);
    await open(page);
    const tops: Record<string, number> = {};
    await page.getByTestId('v2-group-fleet').click();
    for (const key of FLEET_PAGES) {
      await page.getByTestId(`v2-page-${key}`).click();
      await expect(page.getByTestId('v2-strip')).toBeVisible();
      tops[key] = await contentTop(page);
    }
    await page.getByTestId('v2-group-work').click();
    await page.getByTestId(`v2-page-${FLOW}`).click();
    tops[FLOW] = await contentTop(page);
    for (const [k, y] of Object.entries(tops)) {
      expect(y, `${k} content starts at y=${y}`).toBeGreaterThan(0);
      expect(y, `${k} content starts at y=${y}`).toBeLessThanOrEqual(MAX_CONTENT_Y);
    }
    // the bar and the badge row are one height on every page, so nothing moves between pages
    expect(new Set(Object.values(tops)).size, JSON.stringify(tops)).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  test('machine badges start collapsed and open to the full strip on a click', async ({ page }) => {
    await open(page);
    const strip = page.getByTestId('v2-strip');
    await expect(strip).toHaveAttribute('data-expanded', 'false');
    await expect(page.getByTestId('fleet-counts')).toBeHidden();
    await page.locator('[data-testid="machine-chip"]').first().click();
    await expect(strip).toHaveAttribute('data-expanded', 'true');
    await expect(page.getByTestId('fleet-counts')).toBeVisible();
    await page.getByTestId('strip-toggle').click();
    await expect(strip).toHaveAttribute('data-expanded', 'false');
  });

  test('the Rigs tab is always there; opening the drawer shrinks the page instead of covering it', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await open(page);
    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-run').click();
    const tab = page.getByTestId('rig-drawer-tab');
    await expect(tab).toBeVisible();
    const main = page.locator('.app-main');
    const before = await main.boundingBox();
    await tab.click();
    const panel = page.getByTestId('rig-drawer-panel');
    await expect(panel).toBeVisible();
    const after = await main.boundingBox();
    expect(after!.x, 'the page moved right').toBeGreaterThan(before!.x + 200);
    expect(after!.x + after!.width, 'and ends where it did: shrunk, not covered').toBeCloseTo(
      before!.x + before!.width,
      0
    );
    const drawer = await panel.boundingBox();
    expect(drawer!.x + drawer!.width, 'the drawer does not overlap the page').toBeLessThanOrEqual(
      after!.x + 1
    );
    // machine > rig > pod > agent, and a rig click is the shared rig choice
    await expect(panel.locator('.rd-machine-h').first()).toBeVisible();
    await chooseRigInDrawer(page, 'm2:d09-crew');
    await expect(page.locator('[data-testid="drawer-rig"][aria-pressed="true"]')).toHaveAttribute(
      'data-rig-key',
      'm2:d09-crew'
    );
    await expect(page.getByTestId('run-topline')).toContainText(/d09-crew|Waiting for GO/);
  });

  test('every helper is reachable, the rarely used ones behind the ⋯ menu', async ({ page }) => {
    await open(page);
    for (const id of ['explain-toggle', 'legend-toggle', 'keys-toggle', 'feedback-open', 'flip'])
      await expect(page.getByTestId(id), id).toBeVisible();
    for (const id of ['notes-open', 'compare-link', 'api-docs-link'])
      await expect(page.getByTestId(id), id).toBeHidden();
    await page.getByTestId('more-open').click();
    for (const id of ['notes-open', 'compare-link', 'api-docs-link'])
      await expect(page.getByTestId(id), id).toBeVisible();
    // the explainer and legend on the diagram pages sit behind Legend · L
    await page.keyboard.press('Escape');
    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-graph').click();
    const shown = page.locator('[data-testid="hl-legend"]:visible');
    await expect(shown).toHaveCount(0);
    await page.getByTestId('legend-toggle').click();
    await expect(shown).toHaveCount(1);
  });
});
