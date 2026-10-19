import { test, expect, type Page } from '@playwright/test';
import { watchErrors } from './support/fleet';

// The merged Graph at 1440x900 on the frozen busy snapshot: rigs are boxes in machine columns, several
// can be open in place, agents are fixed-size compact cards, zoom shows less as you zoom out, a person is a
// human card (no NOT PLACED rails), and a rig's menu opens it in the Rig Map page.

const FROZEN = '/?frozen=busy-2026-10-18&v=2';

async function quietIntro(page: Page) {
  const gotIt = page.getByRole('button', { name: /got it/i });
  if (await gotIt.count()) await gotIt.first().click();
  const explain = page.getByRole('button', { name: /explain/i }).first();
  if (/on/i.test((await explain.textContent()) ?? '')) await explain.click();
}

const box = (page: Page, key: string) =>
  page.locator(`[data-testid="g2-rig"][data-rig-key="${key}"]`);

test.describe('Graph: open rigs and zoom', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('several rigs open in place with fixed-size cards; zoom shows less; "Open in Rig Map" goes to the Rig Map page', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors = watchErrors(page);
    await page.goto(FROZEN);
    await quietIntro(page);
    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-graph').click();
    await expect(page.getByTestId('v2-graph')).toBeVisible();
    await expect(page.getByTestId('g2-machine')).toHaveCount(3);

    // open two rigs at once
    await box(page, 'm4:workshop').getByTestId('g2-rig-toggle').click();
    await box(page, 'roamy:kernel').getByTestId('g2-rig-toggle').click();
    await expect(page.getByTestId('g2-inside')).toHaveCount(2);

    // every agent card is the same size, whatever it holds
    const sizes = await page
      .getByTestId('g2-agent-card')
      .evaluateAll((els) =>
        els.map(
          (e) =>
            `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`
        )
      );
    expect(sizes.length).toBeGreaterThan(3);
    expect(new Set(sizes).size, `one card size (${[...new Set(sizes)].join(', ')})`).toBe(1);

    // a person is a dark card, and nothing is "not placed"
    await expect(page.getByTestId('g2-human-card').first()).toBeVisible();
    await expect(page.getByText(/not placed/i)).toHaveCount(0);

    // no zoom control: a rig is a box or open. The key explains the box styles.
    await expect(page.getByTestId('g2-zoom-out')).toHaveCount(0);
    await expect(page.getByTestId('g2-fit')).toHaveCount(0);
    await expect(page.getByTestId('g2-key')).toContainText('frosted');
    await page.getByTestId('g2-collapse-all').click();
    await expect(page.getByTestId('g2-inside')).toHaveCount(0);
    await page.getByTestId('g2-expand-all').click();
    await expect(page.getByTestId('g2-inside').first()).toBeVisible();

    // a rig's ⋯ menu has "Open in Rig Map": the Rig Map page shows that rig, open, full width
    const first = page.getByTestId('g2-rig').first();
    const key = await first.getAttribute('data-rig-key');
    await first.getByTestId('g2-rig-menu').click();
    await page.getByTestId('g2-open-map').click();
    await expect(page.getByTestId('v2-rigmap')).toBeVisible();
    await expect(page.getByTestId('v2-graph')).toHaveCount(0);
    await expect(page.getByTestId('rm-body')).toHaveAttribute('data-rig-key', key!);
    await expect(page.getByTestId('g2-inside')).toHaveCount(1);
    await expect(page.getByTestId('g2-rig')).toHaveCount(0);

    expect(errors, 'no console or page errors').toEqual([]);
  });
});
