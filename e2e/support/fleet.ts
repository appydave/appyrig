import type { Page } from '@playwright/test';

/**
 * The scenarios the fake collector replays into the e2e hub (playwright.config.ts). roamy--blocked
 * and roamy share machine id `roamy`, so only one runs at a time; roamy--blocked covers more pip
 * states (working, idle, blocked, unknown) and m2 adds stopped. fit is a synthetic machine with
 * 4 working teams and 5 idle-only teams.
 */
export const E2E_SCENARIOS = ['roamy--blocked', 'm2', 'fit'];

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
