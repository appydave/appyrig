// Loads the built UI behind the session gate in headless Chromium; prints the websocket and any errors.
// Usage: node server/scripts/hub-ui-probe.mjs <hub base url> <hub token>
import { chromium } from '@playwright/test';

const [base, token] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const problems = [];
const sockets = [];
page.on('console', (m) => {
  if (m.type() === 'error') {
    problems.push(m.text());
  }
});
page.on('pageerror', (e) => problems.push(String(e)));
page.on('websocket', (ws) => {
  sockets.push(ws.url());
  ws.on('framereceived', (f) => {
    if (String(f.payload).includes('fleet:update')) {
      sockets.push('got fleet:update');
    }
  });
});
await page.goto(`${base}/?token=${token}`);
await page.waitForTimeout(2500);
console.log('final url:', page.url());
console.log('title:', await page.title());
console.log('websockets:', sockets.length ? [...new Set(sockets)] : 'none');
console.log('console/page errors:', problems.length ? problems : 'none');
await browser.close();
