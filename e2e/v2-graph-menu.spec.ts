import { test, expect } from '@playwright/test';
import { signIn, watchErrors } from './support/fleet';

// v2 Graph: the "⋯" rig menu must draw OVER the next rig frame in its column. Each frame is its own
// stacking context, so the open menu's frame has to be raised (a jsdom test cannot see this: only a
// browser knows what is at a point). The mock Restore is then clicked through the real pointer path
// (a click handler that unmounted its own button used to swallow it in a real browser only).

test.describe('v2 Graph rig menu', () => {
  test('the open menu is on top of the next frame, and Restore goes confirm → toast', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/?v=2');
    await page.getByTestId('v2-page-map').click();
    await expect(page.getByTestId('v2-graph')).toBeVisible();
    // dismiss the first-visit hint if it is up (it can sit over the canvas)
    const gotIt = page.getByRole('button', { name: /got it/i });
    if (await gotIt.count()) await gotIt.first().click();

    // stopped rigs are hidden by default; the fixture machines mostly have stopped ones
    const showStopped = page.getByTestId('g2-show-stopped');
    if ((await showStopped.getAttribute('aria-pressed')) !== 'true') await showStopped.click();
    // a column with at least two frames: the menu of the first falls on the second
    const column = page
      .getByTestId('g2-machine')
      .filter({ has: page.getByTestId('g2-rig').nth(1) })
      .first();
    const frame = column
      .getByTestId('g2-rig')
      .filter({ has: page.getByTestId('g2-rig-menu') })
      .first();
    await frame.scrollIntoViewIfNeeded();
    await frame.getByTestId('g2-rig-menu').click();
    const items = frame.getByTestId('g2-rig-menu-items');
    await expect(items).toBeVisible();
    await items.scrollIntoViewIfNeeded(); // elementFromPoint only sees the viewport

    // at every item's centre, the item itself is what the browser finds
    for (const id of ['g2-fake-start', 'g2-fake-restore', 'g2-fake-launch']) {
      const item = items.getByTestId(id);
      const box = (await item.boundingBox())!;
      const hit = await item.evaluate(
        (el, [x, y]) => {
          const at = document.elementFromPoint(x!, y!);
          return at === el || el.contains(at)
            ? 'ok'
            : `${at?.tagName}.${at?.className} ${at?.getAttribute('data-testid')}`;
        },
        [box.x + box.width / 2, box.y + box.height / 2]
      );
      expect(hit, `${id} is on top`).toBe('ok');
    }
    // and the open frame is raised above its neighbours
    const z = await frame.evaluate((el) => Number(getComputedStyle(el).zIndex));
    const next = await column
      .getByTestId('g2-rig')
      .nth(1)
      .evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(z).toBeGreaterThan(next);

    await items.getByTestId('g2-fake-restore').click();
    await expect(page.getByTestId('g2-fake-dialog')).toContainText('Restore');
    await page.getByTestId('g2-fake-yes').click();
    await expect(page.getByTestId('g2-toast').first()).toContainText('restored (pretend)', {
      timeout: 5_000,
    });
    await expect(items).toHaveCount(0); // the menu closed itself
    expect(errors, 'no console errors').toEqual([]);
  });
});
