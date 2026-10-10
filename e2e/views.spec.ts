import { test, expect } from '@playwright/test';
import { openWall, watchErrors } from './support/fleet';

// v1.1 (P7) per-screen Playwright smoke: Rig Map, Handoff Flow, Accounts. Fixture-fed hub
// (fake collector replaying roamy--blocked + m2); the m2 fixture carries fliedit-team's real queue.

test.describe('v1.1 screens', () => {
  test('Rig Map: a rig with queue traffic draws seats in pods and the handoff lines between them', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await page.getByTestId('view-map').click();
    await page.locator('[data-testid="rig-chip"][data-rig-key="m2:fliedit-team"]').click();
    const map = page.getByTestId('rig-map');
    await expect(map).toBeVisible();
    await expect(map.getByTestId('rig-map-node')).not.toHaveCount(0);
    await expect(map.getByTestId('rig-map-edge')).not.toHaveCount(0);
    // A node opens the same Focus as a Wall tile.
    await map.getByTestId('rig-map-node').first().click();
    await expect(page.getByTestId('focus-view')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('focus-view')).toHaveCount(0);
    expect(errors, 'no console errors on the Rig Map').toEqual([]);
  });

  test('Handoff Flow: four stages, rework shown, and the scrubber replays the run', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await page.getByTestId('view-flow').click();
    await page.locator('[data-testid="rig-chip"][data-rig-key="m2:fliedit-team"]').click();
    const flow = page.getByTestId('handoff-flow');
    await expect(flow.getByTestId('flow-stage')).toHaveCount(4);
    await expect(flow.locator('[data-testid="flow-edge"][data-kind="rework"]')).not.toHaveCount(0);
    const total = async () =>
      Number((await flow.getByTestId('flow-total').innerText()).match(/\d+/)![0]);
    const atEnd = await total();
    const scrubber = flow.getByTestId('flow-scrubber');
    await scrubber.evaluate((el: HTMLInputElement) => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      set.call(el, el.min);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(total).toBeLessThan(atEnd);
    await expect(flow.getByTestId('flow-time')).not.toHaveText(/^now/);
    expect(errors, 'no console errors on the Handoff Flow').toEqual([]);
  });

  test('Accounts: a machine whose collector predates accounts is named, never shown as 0%', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await page.getByTestId('view-accounts').click();
    await expect(page.getByTestId('accounts')).toBeVisible();
    // The fixtures predate the account field, so no card and an honest note.
    await expect(page.getByTestId('account-card')).toHaveCount(0);
    await expect(page.getByTestId('accounts-unreported')).toContainText(
      'collector older than v1.1'
    );
    await expect(page.getByTestId('accounts')).not.toContainText('0% used');
    expect(errors, 'no console errors on Accounts').toEqual([]);
  });
});
