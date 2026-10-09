import { test, expect, type Page } from '@playwright/test';
import {
  expectXtermCount,
  openWall,
  tileFor,
  watchErrors,
  type ExpectedSeat,
} from './support/fleet';

// AC 11 — Playwright smoke: Focus. Clicking a tile opens Focus, exactly one xterm exists, the
// rich-text toggle switches, Esc returns to the Wall and the xterm is disposed (0 instances).
// docs/contract.md: xtermCount() is 0 on the Wall, 1 the whole time Focus is open (both views),
// 0 after Esc.

async function openFocus(page: Page, seat: ExpectedSeat) {
  await tileFor(page, seat).click();
  const focus = page.getByTestId('focus-view');
  await expect(focus).toBeVisible();
  await expect(focus).toHaveAttribute('data-seat-id', seat.seatId);
  return focus;
}

async function closeFocus(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('focus-view')).toHaveCount(0);
  await expect(page.getByTestId('wall')).toBeVisible();
}

test.describe('Focus', () => {
  test('tile → Focus with one xterm, toggle to rich text and back, Esc disposes it', async ({
    page,
  }) => {
    const errors = watchErrors(page);
    const seats = await openWall(page);
    const seat = seats.find((s) => s.status === 'working' && s.hasTail);
    expect(seat, 'fixtures need a working seat with a tail').toBeDefined();

    await expectXtermCount(page, 0);

    const focus = await openFocus(page, seat!);
    await expect(focus).toHaveAttribute('data-mode', 'terminal');
    await expect(page.getByTestId('focus-terminal')).toBeVisible();
    await expectXtermCount(page, 1);

    const toggle = page.getByTestId('focus-mode-toggle');
    await toggle.click();
    await expect(focus).toHaveAttribute('data-mode', 'rich');
    await expect(page.getByTestId('focus-rich')).toBeVisible();
    await expect(page.getByTestId('focus-terminal')).toBeHidden();
    await expectXtermCount(page, 1);

    await toggle.click();
    await expect(focus).toHaveAttribute('data-mode', 'terminal');
    await expect(page.getByTestId('focus-terminal')).toBeVisible();
    await expectXtermCount(page, 1);

    await closeFocus(page);
    await expectXtermCount(page, 0);

    expect(errors, 'no console errors through the Focus round trip').toEqual([]);
  });

  test('repeated open/close never leaks an xterm, including seats with no tail', async ({
    page,
  }) => {
    const seats = await openWall(page);
    const withTail = seats.find((s) => s.hasTail)!;
    const blocked = seats.find((s) => s.status === 'blocked');
    const stopped = seats.find((s) => s.status === 'stopped' && !s.hasTail);
    const targets = [withTail, blocked, stopped, withTail].filter((s): s is ExpectedSeat => !!s);
    expect(
      targets.length,
      'fixtures should give a tail, a blocked and a tail-less stopped seat'
    ).toBe(4);

    for (const seat of targets) {
      await openFocus(page, seat);
      await expectXtermCount(page, 1);
      await closeFocus(page);
      await expectXtermCount(page, 0);
    }
  });
});
