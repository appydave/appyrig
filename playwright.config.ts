import { defineConfig } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { E2E_SCENARIOS } from './e2e/support/fleet';

// Ports come from this tree's root .env, the same file the hub (dotenv, override on) and Vite read,
// so each lane worktree and QA archive runs on its own ports (MISSION.md) without editing this file.
// .env wins, as it does for the hub. Vite instead lets process.env win, so a stray PORT or
// CLIENT_URL in the shell would split hub and client: refuse that rather than guess.
// Only PLAYWRIGHT_BASE_URL may come from the environment alone.
const root = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(root, '.env');
const dotenv: Record<string, string | undefined> = existsSync(envFile)
  ? parseEnv(readFileSync(envFile, 'utf8'))
  : {};
const get = (key: string) => {
  const fromFile = dotenv[key];
  const fromShell = process.env[key];
  if (fromFile !== undefined && fromShell !== undefined && fromFile !== fromShell) {
    throw new Error(
      `${key} is ${fromShell} in the environment but ${fromFile} in .env; the hub would use .env ` +
        `and Vite the environment. Unset ${key} in the shell.`
    );
  }

  return fromFile ?? fromShell;
};

const hubPort = Number(get('PORT') ?? 7191);
const clientUrl = get('CLIENT_URL') ?? 'http://localhost:7190';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? clientUrl;
const hubUrl = `http://localhost:${hubPort}`;
const hubToken = get('HUB_TOKEN');

// Fail loudly rather than test against another tree's hub.
const socketUrl = get('VITE_SOCKET_URL');
if (socketUrl && Number(new URL(socketUrl).port) !== hubPort) {
  throw new Error(
    `.env VITE_SOCKET_URL (${socketUrl}) does not point at this tree's hub (PORT=${hubPort}). ` +
      `Fix .env so the browser talks to the hub Playwright starts.`
  );
}
if (!hubToken || hubToken.length < 16) {
  throw new Error('HUB_TOKEN (16+ chars) must be set in .env or the environment for the e2e hub.');
}

// The e2e hub must never read or write the tree's real data/ (it persists snapshots there, and a
// real hub would later load the fixtures as live state). It gets a fresh temp DATA_DIR, created
// once in the runner (workers inherit the env var). The hub loads .env with override on, so a
// DATA_DIR line in .env, even a blank one, would replace the injected path: refuse it.
if ('DATA_DIR' in dotenv) {
  throw new Error(
    '.env sets DATA_DIR; the e2e hub loads .env with override on, so that line would replace the ' +
      "e2e temp data dir and the run could touch real state. Remove DATA_DIR from this tree's .env."
  );
}
process.env.E2E_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'appyrig-e2e-data-'));
const e2eDataDir = process.env.E2E_DATA_DIR;

// Read by specs (e2e/support/fleet.ts) so they know where the hub is and how to log in.
process.env.E2E_HUB_URL = hubUrl;
process.env.E2E_HUB_TOKEN = hubToken;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  // Proves the hub used the temp DATA_DIR, then removes it.
  globalTeardown: './e2e/support/global-teardown.ts',
  use: {
    headless: true,
    baseURL,
  },
  // Never reuse a server: a busy port means another tree's process, and testing it would be wrong.
  webServer: [
    {
      name: 'hub',
      command: 'npm run build -w shared && npm run dev -w server',
      env: { DATA_DIR: e2eDataDir },
      url: `${hubUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
    },
    {
      name: 'fake-collector',
      // Keeps pushing every 3 s for the whole run (reconnects until the hub is up).
      command: [
        'node server/scripts/fake-collector.mjs',
        `--hub ${hubUrl}`,
        ...E2E_SCENARIOS.map((s) => `--scenario ${s}`),
      ].join(' '),
      env: { HUB_TOKEN: hubToken },
      wait: { stdout: /\[m2\] \{"ok":true/ },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      name: 'client',
      command: 'npm run dev -w client',
      url: clientUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
