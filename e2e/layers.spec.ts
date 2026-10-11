import { test, expect } from '@playwright/test';
import { openWall, watchErrors } from './support/fleet';

// MERGE-ui: one Esc closes one layer. The seat panel (Focus) owns Esc only while nothing sits on
// top of it; the rig Files viewer (S7, O) and the feedback composer (S8, F) each take it first.
// Feedback over a seat is covered in feedback.spec.ts; this covers Files over a seat.

test('Files over an open seat: Esc closes only Files, then the seat; F does nothing while Files is open', async ({
  page,
}) => {
  const errors = watchErrors(page);
  await openWall(page);
  // A seat that belongs to a rig, so its panel can open the rig's files.
  await page.locator('[data-testid="seat-tile"][data-seat-id*="@"]').first().click();
  const seat = page.getByTestId('focus-view');
  await expect(seat).toBeVisible();
  await page.getByTestId('focus-rig-files').click();
  const files = page.getByTestId('rig-files');
  await expect(files).toBeVisible();
  // While Files is on top, F (Feedback) stands down.
  await page.keyboard.press('f');
  await expect(page.getByTestId('feedback-composer')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(files).toHaveCount(0);
  await expect(seat).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(seat).toHaveCount(0);
  expect(errors, 'no console errors').toEqual([]);
});
