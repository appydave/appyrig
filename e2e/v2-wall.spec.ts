import { test, expect } from '@playwright/test';
import { chooseRigInDrawer, watchErrors } from './support/fleet';

// The v2 Wall at 1440 x 900 on the frozen busy snapshot: V1's dark terminal cards, all one fixed size,
// grouped by rig with the rig as the heading, plain tmux sessions under "No rig", V2's triage kept.

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('v2 Wall (frozen busy snapshot, 1440 px)', () => {
  test('one fixed card size, rig headings, No-rig group, dense, triage kept', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = watchErrors(page);
    await page.goto('/?frozen=busy-2026-10-18&v=2');
    const gotIt = page.getByRole('button', { name: /got it/i });
    if (await gotIt.count()) await gotIt.first().click();
    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-wall').click();
    await expect(page.getByTestId('v2-wall')).toBeVisible();

    const cards = page.getByTestId('v2-seat-card');
    const n = await cards.count();
    expect(n).toBeGreaterThan(10);

    // every card is the same size, whatever it holds
    const sizes = await cards.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return `${Math.round(r.width)}x${Math.round(r.height)}`;
      })
    );
    expect(new Set(sizes).size, `card sizes: ${[...new Set(sizes)].join(', ')}`).toBe(1);

    // the rig is the heading, the machine sits beside it; plain tmux sessions say what they are
    const heads = await page.getByTestId('v2w-group-head').allInnerTexts();
    expect(heads.some((h) => /d09-crew/i.test(h) && /M2/.test(h))).toBe(true);
    expect(heads.some((h) => /No rig · /i.test(h))).toBe(true);
    await expect(
      page.getByTestId('v2w-summary').filter({ hasText: 'plain tmux sessions' }).first()
    ).toBeVisible();

    // default order is by machine (headings with counts, in machine order); no two groups share a row
    const mh = await page.getByTestId('v2w-machine-head').allInnerTexts();
    expect(mh.length).toBeGreaterThan(1);
    expect(mh[0]).toMatch(/^\S+ · \d+ seats/);

    // dense: cards sit above the fold. The app frame above the page belongs to the shell lane,
    // so count against a page that starts where the shell puts it (y = 140).
    const top = await page.getByTestId('v2-wall').evaluate((e) => e.getBoundingClientRect().top);
    const above = await cards.evaluateAll(
      (els, offset) => els.filter((e) => e.getBoundingClientRect().bottom - offset <= 900).length,
      top - 140
    );
    console.log(
      `wall: ${n} cards, ${above} above the fold with the page at y=140 (page top now y=${Math.round(top)})`
    );
    expect(above).toBeGreaterThanOrEqual(10);

    // triage and the notes
    await expect(page.getByTestId('v2-hide-stopped')).toBeVisible();
    for (const f of ['all', 'needs', 'stuck', 'failing'])
      await expect(page.getByTestId(`v2-filter-${f}`)).toBeVisible();
    await expect(page.getByTestId('v2w-order')).toContainText('by machine');
    await page.getByTestId('v2w-order-busy').click();
    await expect(page).toHaveURL(/order=busy/);
    await expect(page.getByTestId('v2w-order')).toContainText('blocked → working');
    await expect(page.getByTestId('v2w-machine-head')).toHaveCount(0);
    await page.getByTestId('v2w-order-machine').click();
    await expect(page).not.toHaveURL(/order=busy/);
    await expect(page.getByTestId('v2w-not-read')).toContainText('default tmux server');

    // the ⋯ popover is not clipped by the card, and a click on a card opens the Agent page
    await page.getByTestId('v2-card-more').first().click();
    await expect(page.getByTestId('v2-card-actions')).toBeVisible();
    const pop = page.getByTestId('v2-card-actions');
    await expect(pop.getByRole('button', { name: 'Documents' })).toBeVisible();
    await expect(pop.getByRole('button', { name: 'Restart' })).toBeVisible();
    await expect(pop.getByRole('button', { name: 'Stop' })).toBeVisible();
    expect(
      await pop.evaluate((e) => e.scrollHeight <= e.clientHeight && e.scrollWidth <= e.clientWidth)
    ).toBe(true);
    await page.getByTestId('v2-card-more').first().click();
    // a card body opens the agent panel over the Wall: the page does not change
    await page.getByTestId('terminal-card-open').first().click();
    await expect(page.getByTestId('v2-wall')).toBeVisible();
    await expect(page.getByTestId('v2-agent')).toHaveCount(0);
    await expect(page.getByTestId('agent-panel')).toBeVisible();
    // the panel sits over the right side of the page (where the header's chips are): close it
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('agent-panel')).toHaveCount(0);

    // a rig pick in the drawer is never a no-op: its group is outlined, and "Only this rig" narrows
    await chooseRigInDrawer(page, 'm2:d09-crew');
    const group = page.locator('[data-testid="v2w-group"][data-group-key="m2:d09-crew"]');
    await expect(group).toHaveAttribute('data-focused', 'true');
    // the page header sticks UNDER the shell's top bar, so it (and the chip) stay in reach
    await expect
      .poll(async () => {
        const bar = await page.locator('.app-header').boundingBox();
        const head = await page.getByTestId('v2-page-head').boundingBox();
        return head!.y >= bar!.y + bar!.height - 1 && head!.y < 140;
      })
      .toBe(true);
    await expect
      .poll(async () => {
        const head = await page.getByTestId('v2-page-head').boundingBox();
        const h = await group.getByTestId('v2w-group-head').boundingBox();
        return h!.y >= head!.y + head!.height - 1;
      })
      .toBe(true);
    const all = await page.getByTestId('v2w-group').count();
    // an action while all rigs show, a state once it is on
    await expect(page.getByTestId('v2-only-rig')).toContainText('Show only d09-crew');
    await page.getByTestId('v2-only-rig').click();
    await expect(page.getByTestId('v2w-group')).toHaveCount(1);
    await expect(page.getByTestId('v2-only-rig')).toContainText(
      'Showing only d09-crew · × show all'
    );
    await page.getByTestId('v2-only-rig').click();
    await expect(page.getByTestId('v2w-group')).toHaveCount(all);

    // one line header, no Group switch
    await expect(page.getByTestId('v2-page-head')).toHaveCount(1);
    await expect(page.getByText('Group', { exact: true })).toHaveCount(0);

    expect(errors, 'no console errors or uncaught exceptions').toEqual([]);
  });
});
