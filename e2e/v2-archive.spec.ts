import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// The V1 archive opens from the ⋯ menu and steps. The hub's temp DATA_DIR gets a two-file fixture
// folder (a real 1x1 png); nothing here reads the real data/ or any token file.

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

test.use({ viewport: { width: 1440, height: 900 } });

test('V1 archive: open from the menu, step once, Esc closes', async ({ page }) => {
  const data = process.env.E2E_DATA_DIR;
  if (!data) throw new Error('E2E_DATA_DIR unset');
  const dir = path.join(data, 'v1-archive');
  mkdirSync(dir, { recursive: true });
  for (const f of ['v1-01-wall-by-rig.png', 'v1-01-wall-by-machine.png'])
    writeFileSync(path.join(dir, f), PNG_1X1);

  await page.goto('/?frozen=busy-2026-10-18&v=2');
  await expect(page.getByTestId('v2-strip')).toBeVisible({ timeout: 20_000 });
  for (const id of ['v2-welcome-dismiss', 'explain-hint-dismiss']) {
    const b = page.getByTestId(id);
    if (await b.count()) await b.click();
  }
  await page.getByTestId('more-open').click();
  await page.getByTestId('v1-archive-open').click();
  await expect(page.getByTestId('v1-archive')).toBeVisible();
  await expect(page.getByTestId('v1-archive-title')).toContainText('1. The Wall');
  await page.getByTestId('v1-archive-next').click();
  await expect(page.getByTestId('v1-archive-title')).toContainText('by machine');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('v1-archive')).toHaveCount(0);
});
