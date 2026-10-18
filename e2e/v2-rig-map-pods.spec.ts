import { test, expect, type Page } from '@playwright/test';
import { watchErrors } from './support/fleet';

// The Rig Map is horizontal: every pod of a rig sits in ONE row, left to right, each as wide as its
// agents, and the agents of the row sit side by side, the way the old map draws them. A pod that is
// stretched to full width (or stacked under another) while the row would fit is the bug this guards.
// Runs on the frozen busy snapshot at 1440 px, where `workshop` (M4) has two pods (orch, dev), four
// agents, and the old map fits them in one row.

const FROZEN = '/?frozen=busy-2026-10-18&v=2';

async function quietIntro(page: Page) {
  const gotIt = page.getByRole('button', { name: /got it/i });
  if (await gotIt.count()) await gotIt.first().click();
  const explain = page.getByRole('button', { name: /explain/i }).first();
  if (/on/i.test((await explain.textContent()) ?? '')) await explain.click();
}

/** Pod and own-agent boxes of the rig's own lane (the first lane), as drawn right now. */
async function layout(page: Page) {
  return page.evaluate(() => {
    const lane = document.querySelector('[data-testid="rig-map-lane"]')!;
    const box = (e: Element) => {
      const r = e.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) };
    };
    return {
      pods: [...lane.querySelectorAll('.pod')].map(box),
      agents: [...lane.querySelectorAll('[data-testid="rig-map-node"]')].map(box),
      lane: box(lane),
    };
  });
}

type Layout = Awaited<ReturnType<typeof layout>>;

function expectOneRow(l: Layout, what: string) {
  const tops = new Set(l.pods.map((p) => p.top));
  expect(tops.size, `${what}: all pods share one row (tops ${[...tops].join(', ')})`).toBe(1);
  const lefts = l.pods.map((p) => p.left);
  expect(lefts, `${what}: pods run left to right`).toEqual([...lefts].sort((a, b) => a - b));
  expect(new Set(l.agents.map((a) => a.top)).size, `${what}: agents share one row`).toBe(1);
  // each pod is sized to its agents, not stretched across the lane
  const widest = Math.max(...l.pods.map((p) => p.width));
  if (l.pods.length > 1) {
    expect(widest, `${what}: no pod stretched to the full lane`).toBeLessThan(l.lane.width * 0.9);
  }
}

test.describe('Rig Map v2 is horizontal', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const rig of ['m4:workshop', 'm4:ylo-d11']) {
    test(`${rig}: pods and agents in one row, and the old map agrees`, async ({ page }) => {
      test.setTimeout(60_000);
      const errors = watchErrors(page);
      await page.goto(FROZEN);
      await quietIntro(page);
      await page.getByTestId('v2-group-fleet').click();
      await page.getByTestId('v2-page-map').click();
      await expect(page.getByTestId('v2-rig-map')).toBeVisible();
      await page.getByTestId('rig-select').selectOption(rig);
      await expect(page.getByTestId('rig-map-node').first()).toBeVisible();

      const v2 = await layout(page);
      expect(v2.pods.length).toBeGreaterThan(0);
      expectOneRow(v2, 'v2');

      // B: the old Rig Map on the same rig lays the pods out the same way
      await page.keyboard.press('b');
      await expect(page.getByTestId('flip')).toHaveAttribute('data-showing', 'old');
      await expect(page.getByTestId('v2-rig-map')).toHaveCount(0);
      await expect(page.getByTestId('rig-map-node').first()).toBeVisible();
      const old = await layout(page);
      expectOneRow(old, 'old');
      expect(v2.pods.length).toBe(old.pods.length);
      expect(v2.agents.length).toBe(old.agents.length);

      expect(errors, 'no console or page errors').toEqual([]);
    });
  }
});
