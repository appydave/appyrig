import { test, expect, type Page } from '@playwright/test';

// The v2 frame on narrow windows (the bar wraps, nothing clips) and the shared .ar-explainer class.

const FROZEN = '/?frozen=busy-2026-10-18&v=2';

async function open(page: Page) {
  await page.goto(FROZEN);
  await expect(page.getByTestId('ar-strip')).toBeVisible({ timeout: 20_000 });
  for (const id of ['ar-welcome-dismiss']) {
    const b = page.getByTestId(id);
    if (await b.count()) {
      await b.click();
    }
  }
  await expect(page.getByTestId('ar-strip')).toBeVisible({ timeout: 20_000 });
}

const contentTop = (page: Page) =>
  page.evaluate(() => {
    const kids = [...document.querySelector('.app-main')!.children];
    const strip = document.querySelector('[data-testid="ar-strip"]')!;
    const first = kids[kids.indexOf(strip) + 1] as HTMLElement | undefined;

    return first ? Math.round(first.getBoundingClientRect().top) : -1;
  });

test.describe('v2 shell on narrow windows', () => {
  for (const [width, maxTop] of [
    [1280, 150],
    [1024, 150],
  ] as const) {
    test(`${width} px: no page link is clipped, and the content still starts high`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page);
      const r = await page.evaluate(() => {
        const links = [...document.querySelectorAll<HTMLElement>('.ar-nav-page')];
        const pages = document.querySelector<HTMLElement>('.ar-nav-pages')!;

        return {
          n: links.length,
          clipped: links.filter((l) => {
            const b = l.getBoundingClientRect();

            return b.right > window.innerWidth || b.width < l.scrollWidth - 1;
          }).length,
          pagesClipped: pages.scrollWidth > pages.clientWidth + 1,
          overflowX: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      expect(r.n).toBeGreaterThan(3);
      expect(r.clipped, JSON.stringify(r)).toBe(0);
      expect(r.pagesClipped, JSON.stringify(r)).toBe(false);
      expect(r.overflowX, `${width}: no sideways scroll`).toBe(false);
      const top = await contentTop(page);
      console.log(`shell ${width}px: content starts at y=${top}`);
      expect(top, `${width}: content starts at y=${top}`).toBeLessThanOrEqual(maxTop);
    });
  }
});

test.describe('v2 explainer class', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('a paragraph marked .ar-explainer is behind Legend · L', async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.className = 'ar-explainer';
      p.setAttribute('data-testid', 'probe-explainer');
      p.textContent = 'explainer';
      document.querySelector('.app-main')!.appendChild(p);
    });
    await expect(page.getByTestId('probe-explainer')).toBeHidden();
    await page.getByTestId('legend-toggle').click();
    await expect(page.getByTestId('probe-explainer')).toBeVisible();
  });
});

test.describe('v2 shell with the agent panel open', () => {
  for (const width of [1440, 1280, 1100]) {
    test(`${width} px: a pinned drawer gives way, and Got it and every machine chip stay clear of the panel`, async ({
      page,
    }) => {
      await page.addInitScript(() => localStorage.setItem('appyrig.rigDrawerPinned', '1'));
      await page.setViewportSize({ width, height: 800 });
      await page.goto(FROZEN);
      await expect(page.getByTestId('ar-strip')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('terminal-card-open').first().click();
      await expect(page.getByTestId('agent-panel')).toBeVisible();
      const m = await page.evaluate(() => {
        const left = document
          .querySelector('[data-testid="agent-panel"]')!
          .getBoundingClientRect().left;
        const rights = [
          ...document.querySelectorAll(
            '[data-testid="machine-chip"], [data-testid="ar-welcome-dismiss"]'
          ),
        ].map((e) => e.getBoundingClientRect().right);
        const main = document
          .querySelector('main[data-testid^="ar-"]')!
          .getBoundingClientRect().width;

        return { left, maxRight: Math.max(...rights), main };
      });
      expect(m.maxRight, JSON.stringify(m)).toBeLessThanOrEqual(m.left);
      expect(m.main, `page width ${m.main}`).toBeGreaterThanOrEqual(500);
      // the panel closes: the saved pin is back
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('agent-panel')).toHaveCount(0);
      await expect(page.getByTestId('rig-drawer')).toHaveAttribute('data-pinned', 'true');
    });
  }
});
