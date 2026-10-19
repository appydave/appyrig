import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared ground truth for the UI smoke tests (AC 10, 11).
 *
 * The fake collector replays these AppyRig-shaped snapshots into the hub, and the specs read the
 * same files, so every assertion is "the screen shows what the fixtures say", not a hard-coded
 * count. roamy--blocked and roamy share machine id `roamy`, so only one runs at a time;
 * roamy--blocked covers more pip states (working, idle, blocked, unknown) and m2 adds stopped.
 * fit (v1.4 S3-fit) is a synthetic machine with 4 working teams and 5 idle-only teams.
 */
export const E2E_SCENARIOS = ['roamy--blocked', 'm2', 'fit'];
/** Machines the e2e hub reports (one per scenario). */
export const E2E_MACHINES = E2E_SCENARIOS.length;

const snapshotsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../test/fixtures/snapshots'
);

export interface ExpectedSeat {
  machineId: string;
  seatId: string;
  status: string;
  hasTail: boolean;
}

export function expectedSeats(): ExpectedSeat[] {
  return E2E_SCENARIOS.flatMap((scenario) => {
    const snapshot = JSON.parse(readFileSync(path.join(snapshotsDir, `${scenario}.json`), 'utf8'));
    return snapshot.seats.map(
      (seat: { id: string; status: string; tail: unknown }): ExpectedSeat => ({
        machineId: snapshot.machine.id,
        seatId: seat.id,
        status: seat.status,
        hasTail: seat.tail !== null,
      })
    );
  });
}

/** `[data-testid="seat-tile"]` for one seat. Seat ids are unique per machine only. */
export function tileFor(page: Page, seat: Pick<ExpectedSeat, 'machineId' | 'seatId'>) {
  return page.locator(
    `[data-testid="seat-tile"][data-machine-id="${seat.machineId}"][data-seat-id="${seat.seatId}"]`
  );
}

/** Collects console errors and uncaught page errors from the moment it is called. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/**
 * Browser login (AC 18): one visit to the hub's `/?token=` sets the session cookie. Cookies are
 * scoped by host, not port, so the cookie set by the hub also rides the client's proxied socket.
 * Before the hub lane lands browser auth the visit is a no-op; the Wall assertions still decide.
 */
export async function signIn(page: Page): Promise<void> {
  const hub = process.env.E2E_HUB_URL;
  const token = process.env.E2E_HUB_TOKEN;
  if (!hub || !token)
    throw new Error('E2E_HUB_URL / E2E_HUB_TOKEN unset: run through playwright.config.ts');
  await page
    .context()
    .request.get(`${hub}/?token=${encodeURIComponent(token)}`, { maxRedirects: 0 });
}

/** Opens every collapsed Wall group (S3), keyboard-free and idempotent. */
export async function openAllGroups(page: Page): Promise<void> {
  const cards = page.getByTestId('idle-team');
  while ((await cards.count()) > 0) await cards.first().click();
  const closed = page.locator('[data-testid="wall-group-head"][aria-expanded="false"]');
  while ((await closed.count()) > 0) await closed.first().click();
  const chips = page.getByTestId('group-show-all');
  while ((await chips.count()) > 0) await chips.first().click();
}

/** Signs in, opens the Wall and waits until every fixture seat has a tile. */
export async function openWall(page: Page): Promise<ExpectedSeat[]> {
  const seats = expectedSeats();
  await signIn(page);
  await page.goto('/');
  await expect(page.getByTestId('wall')).toBeVisible();
  // S3: stopped and asleep groups start collapsed; open them so every fixture seat has a tile.
  await expect(page.getByTestId('wall-group-head').first()).toBeVisible({ timeout: 15_000 });
  await expect(async () => {
    await openAllGroups(page);
    await expect(page.getByTestId('seat-tile')).toHaveCount(seats.length, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  return seats;
}

/** window.__appyrig.xtermCount(), or -1 when the hook is missing (so a missing hook fails loudly). */
export function xtermCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hooks = (window as unknown as { __appyrig?: { xtermCount?: () => number } }).__appyrig;
    return typeof hooks?.xtermCount === 'function' ? hooks.xtermCount() : -1;
  });
}

/** Polls until xtermCount() equals n (xterm is created lazily and disposed on close). */
export async function expectXtermCount(page: Page, n: number): Promise<void> {
  await expect.poll(() => xtermCount(page), { message: `xtermCount() should be ${n}` }).toBe(n);
}

/**
 * v2 frame: choose a rig through the Rigs drawer (the picker and chip row are gone from the screen).
 * Opens the drawer for the click and leaves it as it found it.
 */
export async function chooseRigInDrawer(page: Page, rigKey: string): Promise<void> {
  const panel = page.getByTestId('rig-drawer-panel');
  const wasOpen = await panel.isVisible();
  if (!wasOpen) await page.getByTestId('rig-drawer-tab').click();
  await page.locator(`[data-testid="drawer-rig"][data-rig-key="${rigKey}"]`).click();
  if (!wasOpen) await page.getByTestId('rig-drawer-tab').click();
}
