import { test, expect, type Page } from '@playwright/test';

/**
 * AFTER walk R2, R3: screens never shift on a state change. Real browser, real CSS, so a test can
 * see what jsdom can't: the actual positions before and after.
 */
const positions = (page: Page, selector: string) =>
  page.evaluate(
    (s) =>
      [...document.querySelectorAll(s)].map((e) => {
        const r = e.getBoundingClientRect();

        return [r.x, r.y, r.width, r.height];
      }),
    selector
  );

/**
 * Waits for the web fonts, then for the boxes to hold still across a gap. On a cold open the Wall's
 * header wraps in the fallback font and unwraps when the web font lands, moving every card 35 px,
 * so a comparison made across that reads the page settling as a card moving.
 */
async function settled(page: Page, selector: string) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));

  let last = '';

  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await positions(page, selector));
        const still = now === last;

        last = now;

        return still;
      },
      { message: `${selector} never held still`, intervals: [300], timeout: 10_000 }
    )
    .toBe(true);
}

test('pressing Replay run and Pause moves nothing on the replay bar', async ({ page }) => {
  await page.goto('/?frozen=busy-2026-10-18&v=2&page=flow');
  await expect(page.getByTestId('flow-play')).toBeVisible({ timeout: 20_000 });

  const others = '[data-testid=flow-prev], [data-testid=flow-time], .flow-replay input';
  const before = await positions(page, others);

  await page.getByTestId('flow-play').click();
  await expect(page.getByTestId('flow-play')).toHaveText(/pause/i);
  expect(await positions(page, others)).toEqual(before);

  await page.getByTestId('flow-play').click();
  await expect(page.getByTestId('flow-play')).toHaveText(/replay run/i);
  expect(await positions(page, others)).toEqual(before);
});

test('a seat turning working or blocked moves nothing inside its card', async ({ page }) => {
  await page.goto('/?frozen=busy-2026-10-18&v=2&page=wall');
  await expect(page.locator('.wcard').first()).toBeVisible({ timeout: 20_000 });

  const parts = '.wcard-main, .wcard-head, .wcard-term, .wcard-foot';
  const setStates = (state: string) =>
    page.evaluate((s) => {
      document.querySelectorAll('.wcard').forEach((c) => c.setAttribute('data-pip', s));
    }, state);

  await setStates('idle');
  await settled(page, parts);

  const before = await positions(page, parts);

  for (const state of ['working', 'blocked', 'idle']) {
    await setStates(state);
    // Settling here too, so a shift that arrives late (a transition) is measured, not missed.
    await settled(page, parts);
    expect(await positions(page, parts)).toEqual(before);
  }
});

test('a cold open of the Wall moves nothing when the web fonts land', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });

  let release = () => {};

  const released = new Promise<void>((resolve) => {
    release = resolve;
  });

  // The font files wait until the Wall has drawn, so a Wall drawn in the fallback font is always
  // seen. A Wall that waits for its fonts never draws first, so they are let go after a second.
  await page.route(/fonts\.gstatic\.com/, async (route) => {
    await released;
    await route.continue();
  });
  await page.addInitScript(() => {
    const tops = new Set<number>();
    const sample = () => {
      const card = document.querySelector('.wcard');

      if (card) {
        tops.add(Math.round(card.getBoundingClientRect().y));
        document.documentElement.dataset.cardTops = [...tops].join(',');
      }

      requestAnimationFrame(sample);
    };

    requestAnimationFrame(sample);
  });

  // Not the load event: a font that is being held would hold that too.
  await page.goto('/?frozen=busy-2026-10-18&v=2&page=wall', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('.wcard') !== null || performance.now() > 1000
  );
  release();
  await expect(page.locator('.wcard').first()).toBeVisible({ timeout: 20_000 });
  await settled(page, '.wcard');

  // Without the real font there was no swap to survive, and the test would prove nothing.
  const fontLoaded = await page.evaluate(() =>
    [...document.fonts].some((f) => f.family.includes('Bebas Neue') && f.status === 'loaded')
  );

  expect(fontLoaded).toBe(true);

  const tops = (await page.evaluate(() => document.documentElement.dataset.cardTops ?? ''))
    .split(',')
    .map(Number);

  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(2);
});
