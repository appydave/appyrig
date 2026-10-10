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

  test('Explain mode: hovering a seat shows what it is; Escape hides it; the toggle turns it off', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await page.getByTestId('view-map').click();
    await page.locator('[data-testid="rig-chip"][data-rig-key="m2:fliedit-team"]').click();
    await expect(page.getByTestId('explain-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('rig-map').getByTestId('rig-map-node').first().hover();
    const card = page.getByTestId('explain-card');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Seat');
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await page.getByTestId('explain-toggle').click();
    await page.getByTestId('rig-map').getByTestId('rig-map-node').nth(1).hover();
    await page.waitForTimeout(300);
    await expect(card).toHaveCount(0);
    expect(errors, 'no console errors in Explain mode').toEqual([]);
  });

  test('Handoff Flow chapters jump the replay and narrate the moment', async ({ page }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await page.getByTestId('view-flow').click();
    await page.locator('[data-testid="rig-chip"][data-rig-key="m2:fliedit-team"]').click();
    const flow = page.getByTestId('handoff-flow');
    const chapters = page.getByTestId('flow-chapter');
    await expect(chapters.first()).toContainText('The run starts');
    await chapters.first().click();
    await expect(flow.getByTestId('flow-narration')).toContainText('first item');
    await expect(flow.getByTestId('flow-time')).not.toHaveText(/^now/);
    expect(errors, 'no console errors on chapters').toEqual([]);
  });

  test('Learn: lessons show on the fleet, and "See it" goes to the screen', async ({ page }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await page.getByTestId('view-learn').click();
    await expect(page.getByTestId('lesson-link')).toHaveCount(9);
    await expect(page.getByTestId('lesson')).toContainText('Seats');
    await expect(page.getByTestId('lesson').locator('table')).toBeVisible();
    await page.getByTestId('lesson-link').filter({ hasText: 'Refocus' }).click();
    await expect(page.getByTestId('lesson')).toContainText('--plugin-dir');
    await page.getByTestId('lesson-link').filter({ hasText: 'Every term' }).click();
    await expect(page.getByTestId('lesson')).toContainText('Rework');
    await page.getByTestId('lesson-link').first().click();
    await page.getByTestId('lesson-try').click();
    await expect(page.getByTestId('rig-map')).toBeVisible();
    expect(errors, 'no console errors on Learn').toEqual([]);
  });

  test('Step buttons move one handoff at a time; consoles show each seat up to that moment', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openWall(page);
    await page.getByTestId('view-flow').click();
    await page.locator('[data-testid="rig-chip"][data-rig-key="m2:fliedit-team"]').click();
    const flow = page.getByTestId('handoff-flow');
    await flow.getByTestId('flow-next').click();
    await expect(flow.getByTestId('flow-narration')).toContainText('Handoff 1 of');
    await flow.getByTestId('flow-next').click();
    await expect(flow.getByTestId('flow-narration')).toContainText('Handoff 2 of');
    await flow.getByTestId('flow-prev').click();
    await expect(flow.getByTestId('flow-narration')).toContainText('Handoff 1 of');

    await flow.getByTestId('consoles-toggle').click();
    const consoles = flow.getByTestId('replay-console');
    await expect(consoles).toHaveCount(2);
    // The fixture hub has no transcript history, so consoles say so and show handoffs only.
    await expect(consoles.first()).toContainText('handoffs only');
    await flow.getByTestId('console-chip').nth(2).click();
    await expect(consoles).toHaveCount(3);
    expect(errors, 'no console errors on steps and consoles').toEqual([]);
  });
});
