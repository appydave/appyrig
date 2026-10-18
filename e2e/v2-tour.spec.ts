import { test, expect, type Page } from '@playwright/test';
import { watchErrors } from './support/fleet';

// A tour of v2 on the frozen busy snapshot (no rig has to be running): Current is untouched, every
// page in the v2 nav renders, B flips old ↔ new where an old page exists and says so where it does
// not, an agent click on the Wall lands on the Agent page, and a mock control sends nothing to the
// hub. The nav is iterated, never listed, so a page a later wave registers is toured automatically.

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

/** The one page root on screen: a v2 page, or Current's body for a page with no v2. */
const root = (page: Page) =>
  page.locator('main[data-testid^="v2-"], main[data-testid^="view-body-"]');

async function quietIntro(page: Page) {
  // the first-visit hint and the explain overlay can sit over the page
  const gotIt = page.getByRole('button', { name: /got it/i });
  if (await gotIt.count()) await gotIt.first().click();
  const explain = page.getByRole('button', { name: /explain/i }).first();
  if (/on/i.test((await explain.textContent()) ?? '')) await explain.click();
}

test.describe('v2 tour (frozen busy snapshot)', () => {
  test('Current, every v2 page, the flip, an agent click, and a mock control', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = watchErrors(page);
    await hookWebSocketSends(page);

    // 1. Current mode: the old tab strip, and no v2 nav
    await page.goto(FROZEN);
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
    await expect(page.getByTestId('view-wall')).toBeVisible();
    await quietIntro(page);
    await expect(page.getByTestId('v2-nav')).toHaveCount(0);
    const currentKeys = (
      await page
        .locator('[data-testid^="view-"]:not([data-testid^="view-body-"])')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice('view-'.length)))
    ).filter((k) => k.length > 0);
    expect(currentKeys.length, 'Current has its tab strip').toBeGreaterThanOrEqual(8);
    for (const k of ['wall', 'map', 'flow', 'timeline', 'accounts', 'machines', 'schema', 'learn'])
      expect(currentKeys).toContain(k);

    // 2. V: every page in the v2 nav, whatever it holds today
    await page.keyboard.press('v');
    await expect(page.getByTestId('v2-nav')).toBeVisible();
    const groups = await page
      .locator('[data-testid^="v2-group-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!));
    expect(groups.length).toBeGreaterThanOrEqual(4);
    const visited: string[] = [];
    for (const g of groups) {
      await page.getByTestId(g).click();
      const pages = await page
        .locator('[data-testid^="v2-page-"]')
        .evaluateAll((els) =>
          els.map((e) => e.getAttribute('data-testid')!.slice('v2-page-'.length))
        );
      for (const key of pages) {
        await page.getByTestId(`v2-page-${key}`).click();
        await expect(root(page), `${key} renders one page root`).toHaveCount(1);
        await expect(root(page)).toBeVisible();
        const hasCurrent = currentKeys.includes(key);
        // the Rig Map has its own v2 page, and the Graph is a separate v2-only page
        if (key === 'map') {
          await expect(page.getByTestId('v2-rig-map')).toBeVisible();
          // a real v2: no "No v2 yet" note, and B flips to the old Rig Map below
          await expect(page.getByTestId('v2-no-v2')).toHaveCount(0);
        }
        if (key === 'graph') await expect(page.getByTestId('v2-graph')).toBeVisible();

        // A Current page with no v2 yet shows Current's page and says so: nothing to flip between.
        if (hasCurrent && (await page.getByTestId('v2-no-v2').count()) > 0) {
          await expect(page.getByTestId('v2-no-v2')).toContainText('No v2 yet');
          visited.push(`${g.replace('v2-group-', '')}/${key} (no v2 yet)`);
          continue;
        }
        // 3. B: the old page where there is one, a plain note where there is not
        await page.keyboard.press('b');
        if (hasCurrent) {
          await expect(page.getByTestId('flip')).toHaveAttribute('data-showing', 'old');
          // Current's page has no common root id; what marks it is that no v2 page root is up
          await expect(
            page.locator('main[data-testid^="v2-"]'),
            `${key}: Current's page`
          ).toHaveCount(0);
          await expect(page.locator('main').first()).toBeVisible();
          await page.keyboard.press('b');
          await expect(page.getByTestId('flip')).toHaveAttribute('data-showing', 'new');
          // back to the new page (or, for a Current page with no v2 yet, its one page root)
          await expect(root(page)).toHaveCount(1);
        } else {
          await expect(page.getByTestId('v2-flip-note')).toContainText('no old version');
        }
        await expect(root(page)).toHaveCount(1);
        visited.push(`${g.replace('v2-group-', '')}/${key}${hasCurrent ? '' : ' (v2 only)'}`);
      }
    }
    test.info().annotations.push({ type: 'pages visited', description: visited.join(', ') });
    console.log(`v2 tour visited ${visited.length} pages: ${visited.join(', ')}`);
    expect(visited.length).toBeGreaterThanOrEqual(10);
    expect(visited).toContain('fleet/map');
    expect(visited).toContain('fleet/graph (v2 only)');

    // 4. an agent on the Wall opens the Agent page
    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-wall').click();
    await expect(page.getByTestId('v2-wall')).toBeVisible();
    await page.getByTestId('v2-card-open').first().click();
    await expect(page.getByTestId('v2-agent')).toBeVisible();

    // 5. a mock control on the Graph: dialog, progress, toast, and nothing sent to the hub
    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-graph').click();
    await expect(page.getByTestId('v2-graph')).toBeVisible();
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
