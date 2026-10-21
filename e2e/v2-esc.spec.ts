import { test, expect, type Page } from '@playwright/test';

// Esc closes the top-most layer (panel, overlay, popover) and does nothing else: it never changes
// the page and never adds a history entry.

const FROZEN = '/?frozen=busy-2026-10-18&v=2';
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page: Page) {
  // A fake clock, so "nothing happened after Esc" is checked by running the page's timers forward
  // rather than by sleeping.
  await page.clock.install();
  await page.goto(FROZEN);
  await expect(page.getByTestId('v2-strip')).toBeVisible({ timeout: 20_000 });
  for (const id of ['v2-welcome-dismiss']) {
    const b = page.getByTestId(id);
    if (await b.count()) await b.click();
  }
}
const pageParam = (page: Page) => new URL(page.url()).searchParams.get('page');
const historyLength = (page: Page) => page.evaluate(() => window.history.length);

test.describe('Esc never navigates', () => {
  test('repro A: Wall, Work, Flow, Fleet, Graph, Wall, open a card, Esc: still on the Wall, no new entry', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await open(page);
    await page.getByTestId('v2-group-work').click();
    await page.getByTestId('v2-page-flow').click();
    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-graph').click();
    await page.getByTestId('v2-page-wall').click();
    await expect(page.getByTestId('v2-wall')).toBeVisible();
    await page.getByTestId('terminal-card-open').first().click();
    await expect(page.getByTestId('agent-panel')).toBeVisible();
    expect(pageParam(page)).toBe('wall');
    const n = await historyLength(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('agent-panel')).toHaveCount(0);
    await page.clock.runFor(500);
    expect(pageParam(page), 'Esc left the Wall').toBe('wall');
    await expect(page.getByTestId('v2-wall')).toBeVisible();
    expect(await historyLength(page), 'Esc must not push').toBeLessThanOrEqual(n);
    // and with nothing open at all, Esc does nothing
    await page.keyboard.press('Escape');
    await page.clock.runFor(500);
    expect(pageParam(page)).toBe('wall');
  });

  test('repro B: Run board, a station Docs (agent panel), Esc: closes the panel and stays on the Run board', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await open(page);
    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-run').click();
    await expect(page.getByTestId('v2-run')).toBeVisible();
    // a station's Docs now opens the agent panel (the full-screen docs drawer is gone from there)
    await page.getByTestId('run-station-docs').first().click();
    await expect(page.getByTestId('agent-panel')).toBeVisible();
    const n = await historyLength(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('agent-panel')).toHaveCount(0);
    await page.clock.runFor(500);
    expect(pageParam(page), 'Esc left the Run board').toBe('run');
    await expect(page.getByTestId('v2-run')).toBeVisible();
    expect(await historyLength(page)).toBeLessThanOrEqual(n);
  });

  test('Graph with the panel open: Esc closes the panel and stays on the Graph', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await open(page);
    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-graph').click();
    await expect(page.getByTestId('v2-graph')).toBeVisible();
    await page.getByTestId('rig-drawer-tab').click();
    await page.getByTestId('drawer-agent').first().click();
    await expect(page.getByTestId('agent-panel')).toBeVisible();
    const n = await historyLength(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('agent-panel')).toHaveCount(0);
    await page.clock.runFor(500);
    expect(pageParam(page), 'Esc left the Graph').toBe('graph');
    expect(await historyLength(page)).toBeLessThanOrEqual(n);
  });
});
