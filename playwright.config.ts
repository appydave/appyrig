import { defineConfig } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
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
  use: {
    headless: true,
    baseURL,
  },
  // Never reuse a server: a busy port means another tree's process, and testing it would be wrong.
  webServer: [
    {
      name: 'hub',
      command: 'npm run build -w shared && npm run dev -w server',
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
