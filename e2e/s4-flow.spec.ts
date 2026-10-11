import { test, expect, type Page } from '@playwright/test';
import { openWall, watchErrors } from './support/fleet';

// v1.4 S4-ui on the fixture hub (fake collector: queue rows, no message bodies, no seat history).
// So here handoff.get answers "pending" and rig.entry "unknown"; the readable-defect proof needs a
// hub with real bodies (QA's :7320). The connector check is fixture-independent.

const FLIEDIT = '[data-rig-key="m2:fliedit-team"]';

/** How far each Rig Map line's arrow end sits from the nearest seat card, in px. */
function gaps(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const out: number[] = [];
    for (const g of document.querySelectorAll('[data-testid="rig-map-edge"]')) {
      const path = g.querySelector<SVGPathElement>('path.rigmap-edge')!;
      const svg = path.ownerSVGElement!.getBoundingClientRect();
      const end = path.getPointAtLength(path.getTotalLength());
      const ex = svg.left + end.x;
      const ey = svg.top + end.y;
      let best = Infinity;
      for (const n of document.querySelectorAll('[data-testid="rig-map-node"]')) {
        const r = n.getBoundingClientRect();
        const dx = Math.max(r.left - ex, 0, ex - r.right);
        const dy = Math.max(r.top - ey, 0, ey - r.bottom);
        best = Math.min(best, Math.hypot(dx, dy));
      }
      out.push(Math.round(best));
    }
    return out;
  });
}

test.describe('v1.4 S4 handoff details', () => {
  test('Rig Map lines stay on their cards while the page and the map scroll', async ({ page }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await page.getByTestId('view-map').click();
    await page.locator(`[data-testid="rig-chip"]${FLIEDIT}`).click();
    await expect(page.getByTestId('rig-map-edge')).not.toHaveCount(0);
    const attached = (g: number[]) => g.every((d) => d <= 2);
    expect(attached(await gaps(page)), 'at rest').toBe(true);
    await page.mouse.wheel(0, 600);
    await expect
      .poll(async () => attached(await gaps(page)), { message: 'page scrolled' })
      .toBe(true);
    // A narrow map overflows sideways; scrolling it must carry the lines with the cards.
    await page.locator('.rigmap-canvas').evaluate((c: HTMLElement) => {
      c.style.width = '600px';
    });
    await page.locator('.rigmap-canvas').evaluate((c: HTMLElement) => {
      c.scrollLeft = 250;
    });
    await expect
      .poll(async () => attached(await gaps(page)), { message: 'map scrolled sideways' })
      .toBe(true);
    expect(errors, 'no console errors').toEqual([]);
  });

  test('focusing a Flow line opens the details panel; Esc closes it and stays on the Flow', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await page.getByTestId('view-flow').click();
    await page.locator(`[data-testid="rig-chip"]${FLIEDIT}`).click();
    const panel = page.getByTestId('handoff-panel');
    await expect(panel).toHaveAttribute('data-empty', 'true');
    await page.getByTestId('flow-edge').first().focus();
    await expect(page.getByTestId('handoff-title')).toBeVisible();
    // No bodies in the fixtures: the panel says it is waiting for one, never shows blank.
    await expect(page.getByTestId('handoff-body')).toContainText('loading message…');
    await page.keyboard.press('Enter');
    await expect(panel).toHaveAttribute('data-pinned', 'true');
    await page.keyboard.press('Escape');
    await expect(panel).toHaveAttribute('data-empty', 'true');
    await expect(page.getByTestId('handoff-flow')).toBeVisible();
    // No seat history in the fixtures: where work came in is "not known", and nothing is marked.
    await expect(page.getByTestId('flow-entry')).toContainText('not known');
    await expect(page.getByTestId('flow-entry-mark')).toHaveCount(0);
    expect(errors, 'no console errors').toEqual([]);
  });
});
