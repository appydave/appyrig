import { test, expect, type Page } from '@playwright/test';
import { watchErrors } from './support/fleet';

// A tour of the app on the frozen busy snapshot (no rig has to be running): the plain address and an
// old `?v=1` link both open V2, every page in the nav renders, an agent click on the Wall lands on the
// Agent page, and a mock control sends nothing to the hub. The nav is iterated, never listed, so a
// page a later wave registers is toured automatically.

const FROZEN = '/?frozen=busy-2026-10-18';

/** Frames the page has sent on any WebSocket since this was installed. */
async function hookWebSocketSends(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __wsSent: string[] };
    w.__wsSent = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data: Parameters<typeof send>[0]) {
      w.__wsSent.push(typeof data === 'string' ? data.slice(0, 120) : '(binary)');
      return send.call(this, data);
    };
  });
}
const sent = (page: Page) =>
  page.evaluate(() => (window as unknown as { __wsSent: string[] }).__wsSent.slice());

/** The one page root on screen. */
const root = (page: Page) => page.locator('main[data-testid^="ar-"]');

async function quietIntro(page: Page) {
  // the first-visit hint can sit over the page
  const gotIt = page.getByRole('button', { name: /got it/i });
  if (await gotIt.count()) await gotIt.first().click();
}

test.describe('v2 tour (frozen busy snapshot)', () => {
  test('one version, every page, an agent click, and a mock control', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = watchErrors(page);
    await hookWebSocketSends(page);

    // 1. an old `?v=1` link (it used to open the first client) opens V2, and the switch is dropped
    await page.goto(`${FROZEN}&v=1`);
    // positive control: the hook really sees a send (so "none sent" below means something)
    expect(
      await page.evaluate(() => {
        try {
          WebSocket.prototype.send.call(Object.create(WebSocket.prototype), 'control');
        } catch {
          /* the browser refuses a send on a fake socket; the hook saw it first */
        }
        return (window as unknown as { __wsSent: string[] }).__wsSent;
      })
    ).toContain('control');
    await expect(page.getByTestId('ar-nav')).toBeVisible();
    await expect(page.getByTestId('ar-wall')).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('v')).toBeNull();
    await quietIntro(page);
    // nothing of the old client is left: no tab strip, no version switch, no flip
    await expect(page.locator('nav.view-tabs')).toHaveCount(0);
    await expect(page.getByTestId('version-current')).toHaveCount(0);
    await expect(page.getByTestId('flip')).toHaveCount(0);

    // 2. every page in the nav, whatever it holds today
    const groups = await page
      .locator('[data-testid^="ar-group-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!));
    expect(groups.length).toBeGreaterThanOrEqual(4);
    const visited: string[] = [];
    for (const g of groups) {
      await page.getByTestId(g).click();
      // the nav's page links only (a page's own header is `ar-page-head`)
      const pages = await page
        .getByTestId('ar-nav')
        .locator('[data-testid^="ar-page-"]')
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute('data-testid')!.slice('ar-page-'.length))
        );
      for (const key of pages) {
        await page.getByTestId(`ar-page-${key}`).click();
        await expect(root(page), `${key} renders one page root`).toHaveCount(1);
        await expect(root(page)).toBeVisible();
        if (key === 'graph') await expect(page.getByTestId('ar-graph')).toBeVisible();
        if (key === 'map') await expect(page.getByTestId('ar-rigmap')).toBeVisible();
        visited.push(`${g.replace('ar-group-', '')}/${key}`);
      }
    }
    test.info().annotations.push({ type: 'pages visited', description: visited.join(', ') });
    console.log(`tour visited ${visited.length} pages: ${visited.join(', ')}`);
    expect(visited.length).toBeGreaterThanOrEqual(10);
    expect(visited).toContain('work/map');
    expect(visited).toContain('fleet/graph');

    // 4. an agent on the Wall opens the Agent page
    await page.getByTestId('ar-group-fleet').click();
    await page.getByTestId('ar-page-wall').click();
    await expect(page.getByTestId('ar-wall')).toBeVisible();
    // a card body opens the agent panel over the Wall (the page does not change); the Agent page
    // is reached from the nav, or from the panel's own "Open full agent page" link
    await page.getByTestId('terminal-card-open').first().click();
    await expect(page.getByTestId('ar-wall')).toBeVisible();
    await expect(page.getByTestId('ar-agent')).toHaveCount(0);
    await page.getByTestId('ar-group-agents').click();
    await page.getByTestId('ar-page-agent').click();
    await expect(page.getByTestId('ar-agent')).toBeVisible();

    // 5. a mock control on the Graph: dialog, progress, toast, and nothing sent to the hub
    await page.getByTestId('ar-group-fleet').click();
    await page.getByTestId('ar-page-graph').click();
    await expect(page.getByTestId('ar-graph')).toBeVisible();
    const before = await sent(page);
    // a rig frame (not a machine's no-rig group); stopped rigs are hidden by default
    const frame = page
      .getByTestId('g2-rig')
      .filter({ has: page.getByTestId('g2-rig-menu') })
      .first();
    await frame.scrollIntoViewIfNeeded();
    await frame.getByTestId('g2-rig-menu').click();
    const restore = frame.getByTestId('g2-fake-restore');
    await restore.scrollIntoViewIfNeeded();
    await restore.click();
    await expect(page.getByTestId('g2-fake-dialog')).toContainText('Restore');
    await page.getByTestId('g2-fake-yes').click();
    await expect(page.getByTestId('g2-toast').first()).toContainText('(pretend)', {
      timeout: 5_000,
    });
    const after = await sent(page);
    expect(after.slice(before.length), 'no socket frame was sent by the mock control').toEqual([]);

    expect(errors, 'no console errors or uncaught exceptions').toEqual([]);
  });
});
