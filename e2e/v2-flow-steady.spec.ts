import { test, expect, type Page } from '@playwright/test';
import { watchErrors } from './support/fleet';

// v2 clean batch, flow lane (UX notes 2026-10-19, Screen 8: "the screen jumps up and down… the
// button I was about to click has moved out from under my cursor"). On the frozen busy snapshot,
// step through appyrig-v15-loadout's handoffs: the replay controls never move, whatever the length
// of each step's message, and replay shows Traffic with the dots moving even from Structure (B1).

const FROZEN = '/?frozen=busy-2026-10-18&v=2';

async function quietIntro(page: Page) {
  const gotIt = page.getByRole('button', { name: /got it/i });
  if (await gotIt.count()) await gotIt.first().click();
  const explain = page.getByRole('button', { name: /explain/i }).first();
  if (/on/i.test((await explain.textContent()) ?? '')) await explain.click();
}

async function openFlow(page: Page) {
  await page.goto(FROZEN);
  await quietIntro(page);
  await page.getByTestId('v2-group-work').click();
  await page.getByTestId('v2-page-flow').click();
  const chip = page.locator('[data-testid="rig-chip"][data-rig-key$=":appyrig-v15-loadout"]');
  if (await chip.count()) await chip.first().click();
  else {
    const select = page.locator('select').first();
    const option = (await select.locator('option').allTextContents()).find((o) =>
      o.includes('appyrig-v15-loadout')
    );
    await select.selectOption({ label: option! });
  }
  await expect(page.getByTestId('flow-next')).toBeVisible();
  // web fonts landing late would move things for reasons of their own: measure after they are in
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

const box = async (page: Page, id: string) => {
  const b = await page.getByTestId(id).boundingBox();
  return (
    b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }
  );
};

test.describe('v2 Handoff Flow: nothing moves under the cursor', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('five steps with messages of different lengths: the replay controls stay put', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    await openFlow(page);
    await page.getByTestId('flow-next').click();
    const first = {
      bar: await box(page, 'flow-replay'),
      next: await box(page, 'flow-next'),
      prev: await box(page, 'flow-prev'),
      play: await box(page, 'flow-play'),
      narration: await box(page, 'flow-narration'),
    };
    const messages = new Set<string>();
    for (let step = 1; step <= 5; step++) {
      if (step > 1) await page.getByTestId('flow-next').click();
      await expect(page.getByTestId('flow-step-count')).toHaveText(new RegExp(`^${step} / \\d+$`));
      // the message itself lives in the panel; its length differs from step to step
      const panel = (await page.locator('.handoff-panel').first().textContent()) ?? '';
      messages.add(String(panel.length));
      expect(await box(page, 'flow-replay'), `bar at step ${step}`).toEqual(first.bar);
      expect(await box(page, 'flow-next'), `▶ at step ${step}`).toEqual(first.next);
      expect(await box(page, 'flow-prev'), `◀ at step ${step}`).toEqual(first.prev);
      expect(await box(page, 'flow-play'), `play at step ${step}`).toEqual(first.play);
      expect(await box(page, 'flow-narration'), `narration at step ${step}`).toEqual(
        first.narration
      );
    }
    expect(messages.size, 'the steps carry messages of different lengths').toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });

  test('B1: Play from Structure shows Traffic, and the current handoff is lit with moving dots', async ({
    page,
  }) => {
    await openFlow(page);
    await page.getByTestId('flow-lens-structure').click();
    await expect(page.getByTestId('handoff-flow')).toHaveAttribute('data-lens', 'structure');
    await page.getByTestId('flow-next').click();
    await expect(page.getByTestId('handoff-flow')).toHaveAttribute('data-lens', 'traffic');
    await expect(page.locator('[data-testid="flow-edge"][data-current]')).toHaveCount(1);
    const dots = page.locator('[data-testid="flow-edge"][data-current] [data-testid="flow-pulse"]');
    await expect(dots.first()).toBeVisible();
    const at = async () => {
      const b = await dots.first().boundingBox();
      return `${Math.round(b!.x)},${Math.round(b!.y)}`;
    };
    const a = await at();
    await page.waitForTimeout(500);
    expect(await at(), 'the dot travels along its line').not.toEqual(a);
    // the panel follows the step, and the consoles say what they show
    await expect(page.locator('.handoff-panel').first()).not.toContainText('Click a line');
    await expect(page.getByTestId('console-mode')).toContainText('following the handoff');
  });
});
