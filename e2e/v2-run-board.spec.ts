import { test, expect } from '@playwright/test';
import { chooseRigInDrawer, watchErrors } from './support/fleet';

// The Run board at 1440 x 900 on the frozen busy snapshot (no rig has to be running). d09-crew was
// idle there, before GO: the page must say "Waiting for GO", list the jobs from its MISSION.md, keep
// the job strip and the stations above the fold, put Spec on and the three files off, and keep the
// two toggles independent.

const FROZEN = '/?frozen=busy-2026-10-18&v=2';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('v2 Run board (frozen busy snapshot, 1440 px)', () => {
  test('waiting for GO, jobs from the mission file, strip and stations above the fold, toggles', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const errors = watchErrors(page);
    await page.goto(FROZEN);
    const gotIt = page.getByRole('button', { name: /got it/i });
    if (await gotIt.count()) await gotIt.first().click();

    await page.getByTestId('v2-group-fleet').click();
    await page.getByTestId('v2-page-run').click();
    await expect(page.getByTestId('v2-run')).toBeVisible();

    // choose the idle d09-crew on the M2 by its rig key (machine + rig, never the bare name)
    await chooseRigInDrawer(page, 'm2:d09-crew');

    const top = page.getByTestId('run-topline');
    await expect(top).toContainText('Waiting for GO');
    await expect(top).toContainText('jobs planned');
    const tiles = page.getByTestId('run-job');
    const n = await tiles.count();
    expect(n).toBeGreaterThan(0);
    await expect(top).toContainText(`${n} jobs planned`);
    // before GO nothing is done or current, and no rework number is drawn
    for (let i = 0; i < n; i++)
      await expect(tiles.nth(i)).toHaveAttribute('data-status', 'waiting');
    await expect(top).not.toContainText(/rework/);

    // the job strip and the stations are both above the 900 px fold
    const strip = await page.getByTestId('run-strip').boundingBox();
    const stations = await page.getByTestId('run-stations').boundingBox();
    expect(strip, 'strip is drawn').not.toBeNull();
    expect(stations, 'stations are drawn').not.toBeNull();
    console.log(
      `run board: job strip starts at y=${Math.round(strip!.y)}, stations end at y=${Math.round(stations!.y + stations!.height)}`
    );
    expect(strip!.y + strip!.height).toBeLessThan(900);
    expect(stations!.y + stations!.height).toBeLessThan(900);

    // toggles: Spec on, the other three off, each independent
    const pressed = async (k: string) =>
      page.getByTestId(`run-tog-${k}`).getAttribute('aria-pressed');
    expect([
      await pressed('spec'),
      await pressed('rig'),
      await pressed('culture'),
      await pressed('mission'),
    ]).toEqual(['true', 'false', 'false', 'false']);
    await page.getByTestId('run-tog-mission').click();
    await expect(page.getByTestId('run-doc-mission')).toBeVisible();
    await expect(page.getByTestId('run-doc-rig')).toHaveCount(0);
    await expect(page.getByTestId('run-doc-spec')).toBeVisible();
    await page.getByTestId('run-tog-spec').click();
    await expect(page.getByTestId('run-doc-spec')).toHaveCount(0);
    await expect(page.getByTestId('run-doc-mission')).toBeVisible();

    // the sample preview is labelled, and back to real data drops every sample mark
    await page.getByTestId('run-preview').click();
    await expect(page.getByTestId('run-topline')).toContainText(/Job \d+ of \d+/);
    expect(await page.getByTestId('mock-mark').count()).toBeGreaterThan(0);
    await page.getByTestId('run-preview').click();
    await expect(page.getByTestId('run-topline')).toContainText('Waiting for GO');

    // B on a v2-only page says there is no old version
    await page.keyboard.press('b');
    await expect(page.getByTestId('v2-flip-note')).toContainText('no old version');

    expect(errors, 'no console errors or uncaught exceptions').toEqual([]);
  });
});
