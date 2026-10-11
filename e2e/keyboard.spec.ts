import { test, expect, type Page } from '@playwright/test';
import { openWall, watchErrors } from './support/fleet';

// v1.4 S2: drive AppyRig by keyboard alone. Fixture-fed hub (fake collector replaying
// roamy--blocked + m2); the m2 fixture carries fliedit-team's real queue. No mouse clicks: controls
// are reached by focus() + Enter, as Tab would, so the walk proves the keys, not the pointer.

/** Activate a control the way a keyboard user does: focus it, press Enter. */
async function press(page: Page, testId: string, extra = '') {
  await page.locator(`[data-testid="${testId}"]${extra}`).focus();
  await page.keyboard.press('Enter');
}

const FLIEDIT = '[data-rig-key="m2:fliedit-team"]';

test.describe('v1.4 S2 keyboard', () => {
  test('Wall: arrows reach a tile, Enter opens it, Esc returns to that same tile', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openWall(page);
    const tiles = page.getByTestId('seat-tile');
    await page.keyboard.press('ArrowRight');
    await expect(tiles.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tiles.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const opened = await page.evaluate(() => document.activeElement?.getAttribute('data-seat-key'));
    expect(opened).toBeTruthy();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('focus-view')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('focus-view')).toHaveCount(0);
    await expect(page.locator(`[data-seat-key="${opened}"]`)).toBeFocused();
    expect(errors, 'no console errors').toEqual([]);
  });

  test('Handoff Flow: → ×3 steps three handoffs, ← ×3 steps back', async ({ page }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await press(page, 'view-flow');
    await press(page, 'rig-chip', FLIEDIT);
    const narration = page.getByTestId('flow-narration');
    for (let i = 1; i <= 3; i++) {
      await page.keyboard.press('ArrowRight');
      await expect(narration).toContainText(new RegExp(`^Handoff ${i} of \\d+`));
    }
    await page.keyboard.press('ArrowLeft');
    await expect(narration).toContainText(/^Handoff 2 of \d+/);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(narration).toContainText(/^Handoff 1 of \d+/);
    expect(errors, 'no console errors').toEqual([]);
  });

  test('Rig Map: Enter opens a seat, Esc returns to the map on that seat', async ({ page }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await press(page, 'view-map');
    await press(page, 'rig-chip', FLIEDIT);
    const node = page.getByTestId('rig-map-node').first();
    await node.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('focus-view')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('focus-view')).toHaveCount(0);
    await expect(page.getByTestId('rig-map')).toBeVisible();
    await expect(node).toBeFocused();
    expect(errors, 'no console errors').toEqual([]);
  });

  test('? lists the keys; Esc closes it, then Esc goes back a screen', async ({ page }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await press(page, 'view-map');
    await page.keyboard.press('?');
    await expect(page.getByTestId('keys-help')).toHaveAttribute('data-view', 'map');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('keys-help')).toHaveCount(0);
    await expect(page.getByTestId('view-body-map')).toBeVisible();
    // Move focus off the tab so no Explain card is up, then Esc = back to the Wall.
    await page.locator('body').focus();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('wall')).toBeVisible();
    expect(errors, 'no console errors').toEqual([]);
  });
});
