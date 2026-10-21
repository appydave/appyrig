import { test, expect } from '@playwright/test';
import { signIn, watchErrors } from './support/fleet';

// v2 shell: the top-right ⋯ menu must sit above every page's content. The header is a sticky stacking
// context, so page layers with a higher z-index (the Graph canvas) used to clip all but the first item.
// Only a browser knows what is at a point, so each item's centre is hit-tested on every nav page.

test.describe('v2 ⋯ menu stacking', () => {
  test('every menu item is on top and clickable on every v2 page', async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page);
    await page.goto('/?v=2');
    const nav = page.locator('button[data-testid^="v2-page-"]');
    await expect(nav.first()).toBeVisible({ timeout: 20_000 });
    const ids = await nav.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-testid') ?? '')
    );
    expect(ids).toEqual(
      expect.arrayContaining(['v2-page-graph', 'v2-page-wall', 'v2-page-machines'])
    );

    for (const id of ids) {
      await page.getByTestId(id).click();
      const gotIt = page.getByRole('button', { name: /got it/i });
      if (await gotIt.count()) await gotIt.first().click();
      await page.getByTestId('more-open').click();
      const items = page.locator('.v2-more-pop > *');
      const n = await items.count();
      expect(n, `${id}: menu has items`).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) {
        const item = items.nth(i);
        await expect(item, `${id} item ${i} visible`).toBeVisible();
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
        expect(hit, `${id} item ${i} is on top`).toBe('ok');
      }
      await page.keyboard.press('Escape');
      await expect(page.locator('.v2-more-pop')).toBeHidden();
    }
    expect(errors, 'no console errors').toEqual([]);
  });
});
