import { test, expect, type Page, type Locator } from '@playwright/test';
import { chooseRigInDrawer, watchErrors } from '../support/fleet';

// The Agent panel takes ~520 px from the page. With it open, the Run board and the Handoff Flow must
// still lay out: on the Run board the ledger moves below the job panel, the document tabs keep their
// own row, the job panel keeps a usable width and the header actions are not clipped; on the Flow the
// diagram keeps a readable scale and scrolls sideways in its own box. Checked at 1440 and 1100 px.

const FROZEN = '/?frozen=busy-2026-10-18&v=2';

async function box(l: Locator) {
  const b = await l.boundingBox();

  expect(b, 'drawn').not.toBeNull();

  return b!;
}

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function open(page: Page, group: string, pageKey: string) {
  await page.goto(FROZEN);

  const gotIt = page.getByRole('button', { name: /got it/i });

  if (await gotIt.count()) {
    await gotIt.first().click();
  }

  await page.getByTestId(`ar-group-${group}`).click();
  await page.getByTestId(`ar-page-${pageKey}`).click();
}

for (const width of [1440, 1100]) {
  test.describe(`v2 pages with the Agent panel open (${width} px)`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('Run board: ledger below the job panel, tabs clear of it, header not clipped', async ({
      page,
    }) => {
      const errors = watchErrors(page);

      await open(page, 'fleet', 'run');
      await chooseRigInDrawer(page, 'm2:d09-crew');
      await expect(page.getByTestId('run-topline')).toContainText('Waiting for GO');
      await page.getByTestId('run-station-docs').first().click();
      await expect(page.getByTestId('agent-panel')).toBeVisible();

      const panel = await box(page.getByTestId('agent-panel'));
      const job = await box(page.locator('.run-lower > :first-child'));
      const ledger = await box(page.locator('.run-lower > :nth-child(2)'));
      const tabs = await box(page.locator('.run-tabs'));

      expect(ledger.y, 'the ledger sits below the job panel').toBeGreaterThanOrEqual(
        job.y + job.height - 1
      );
      expect(job.width, 'the job panel keeps a usable width').toBeGreaterThan(400);
      expect(overlaps(tabs, ledger), 'the document tabs never overlap the ledger').toBe(false);
      expect(job.x + job.width, 'the job panel is not under the Agent panel').toBeLessThanOrEqual(
        panel.x + 1
      );

      const preview = page.getByTestId('run-preview');
      const pb = await box(preview);

      expect(pb.x + pb.width, 'the header action is not under the panel').toBeLessThanOrEqual(
        panel.x + 1
      );
      expect(
        await preview.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        'the header action text is whole'
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      expect(errors).toEqual([]);
    });

    test('Flow: the diagram keeps a readable scale and scrolls sideways in its own box', async ({
      page,
    }) => {
      const errors = watchErrors(page);

      // a deep link: Flow on d09-crew with dev-qa's panel open
      // (the welcome banners' "Got it" can sit under the panel here, so it is left alone)
      await page.goto(`${FROZEN}&page=flow&rig=d09-crew%40m2&agent=dev-qa%40d09-crew%40m2`);
      await expect(page.getByTestId('ar-flow')).toBeVisible();
      await expect(page.getByTestId('agent-panel')).toBeVisible();

      const panel = await box(page.getByTestId('agent-panel'));
      const scroller = page.getByTestId('flow-diagram-scroll');
      const sb = await box(scroller);

      expect(sb.x + sb.width, 'the diagram box is not under the panel').toBeLessThanOrEqual(
        panel.x + 1
      );

      const svgWidth = await scroller.evaluate(
        (el) => el.querySelector('svg')!.getBoundingClientRect().width
      );

      expect(svgWidth, 'the drawing never shrinks below 760 px').toBeGreaterThanOrEqual(759);

      const [sw, cw] = await scroller.evaluate((el) => [el.scrollWidth, el.clientWidth]);

      expect(sw, 'the drawing scrolls sideways inside its box').toBeGreaterThan(cw);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      expect(errors).toEqual([]);
    });
  });
}
