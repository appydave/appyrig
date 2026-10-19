import { test, expect, type Page } from '@playwright/test';
import { watchErrors } from './support/fleet';

// C54: the Run board's job and document tab, and a rig's mission, are links. A cold load of the
// address opens them; clicks write them back with replaceState. Frozen busy snapshot, d09-crew.

const FROZEN = '/?frozen=busy-2026-10-18&v=2';
const param = (page: Page, k: string) =>
  page.evaluate((key) => new URLSearchParams(location.search).get(key), k);

for (const width of [1440, 1100]) {
  test.describe(`v2 deep links (${width} px)`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('Run board: job 3 and MISSION.md from a cold link; clicks write the address', async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await page.goto(`${FROZEN}&page=run&rig=d09-crew%40m2&job=3&doc=mission`);
      await expect(page.getByTestId('v2-run')).toBeVisible();
      await expect(page.getByTestId('run-topline')).toContainText('Waiting for GO');
      const third = page.getByTestId('run-job').nth(2);
      const slice = await third.getAttribute('data-job');
      await expect(page.getByTestId('run-detail')).toHaveAttribute('data-job', slice ?? '');
      await expect(page.getByTestId('run-tog-mission')).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('run-doc-mission')).toBeVisible();

      // a click on job 2 and on the rig.yaml tab replaces the address, so reload keeps them
      const len = await page.evaluate(() => history.length);
      await page.getByTestId('run-job').nth(1).click();
      await page.getByTestId('run-tog-rig').click();
      expect(await param(page, 'job')).toBe('2');
      expect(await param(page, 'doc')).toBe('rig');
      expect(await page.evaluate(() => history.length)).toBe(len);
      await page.reload();
      await expect(page.getByTestId('run-tog-rig')).toHaveAttribute('aria-selected', 'true');
      const second = await page.getByTestId('run-job').nth(1).getAttribute('data-job');
      await expect(page.getByTestId('run-detail')).toHaveAttribute('data-job', second ?? '');

      // a bad value falls back to the first job and Spec
      await page.goto(`${FROZEN}&page=run&rig=d09-crew%40m2&job=zzz&doc=nope`);
      await expect(page.getByTestId('run-tog-spec')).toHaveAttribute('aria-selected', 'true');
      expect(errors).toEqual([]);
    });

    test("Missions: a cold link to d09-crew's mission opens MISSION.md in the reader", async ({
      page,
    }) => {
      const errors = watchErrors(page);
      await page.goto(`${FROZEN}&page=missions&rig=d09-crew%40m2&doc=mission`);
      await expect(page.getByTestId('v2-missions')).toBeVisible();
      const reader = page.getByTestId('docs-drawer');
      await expect(reader).toBeVisible();
      await expect(reader.getByTestId('docs-reader-name')).toHaveText('MISSION.md');
      await expect(reader.getByTestId('docs-group-mission')).toContainText('MISSION.md');
      // the rig's mission is on top of the page, with its own Read action
      await expect(page.getByTestId('ms-rig-mission')).toHaveAttribute('data-state', 'ok');
      await reader.getByTestId('docs-close').click();
      await expect(reader).toHaveCount(0);
      expect(await param(page, 'doc')).toBeNull();
      await expect(page.getByTestId('v2-missions')).toBeVisible();
      await page.getByTestId('ms-rig-mission').getByTestId('ms-read-mission').click();
      await expect(page.getByTestId('docs-drawer')).toBeVisible();
      expect(await param(page, 'doc')).toBe('mission');
      expect(errors).toEqual([]);
    });
  });
}
