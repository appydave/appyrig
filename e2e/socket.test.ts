import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(__dirname, '..');

const SERVER_PORT = 5501;
const CLIENT_PORT = 5500;
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // Not ready yet — keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out waiting for ${url} after ${timeoutMs}ms`);
}

function killProcess(proc: ChildProcess): void {
  try {
    if (proc.pid !== undefined) {
      // Kill the entire process group (catches nodemon child processes)
      process.kill(-proc.pid, 'SIGTERM');
    } else {
      proc.kill('SIGTERM');
    }
  } catch {
    // Process may already be dead — ignore
  }
}

let serverProcess: ChildProcess;
let clientProcess: ChildProcess;

test.beforeAll(async () => {
  // detached: true creates a new process group so we can kill all children
  serverProcess = spawn('npm', ['run', 'dev', '-w', 'server'], {
    cwd: templateRoot,
    stdio: 'pipe',
    detached: true,
    env: { ...process.env, NODE_ENV: 'development' },
  });

  clientProcess = spawn('npm', ['run', 'dev', '-w', 'client'], {
    cwd: templateRoot,
    stdio: 'pipe',
    detached: true,
    env: { ...process.env, NODE_ENV: 'development' },
  });

  // Wait for both servers to be ready before running tests
  await Promise.all([
    waitForUrl(`http://localhost:${SERVER_PORT}/health`, STARTUP_TIMEOUT_MS),
    waitForUrl(`http://localhost:${CLIENT_PORT}`, STARTUP_TIMEOUT_MS),
  ]);
});

test.afterAll(async () => {
  // Use try/finally pattern to ensure both processes are killed even if one throws
  try {
    killProcess(serverProcess);
  } finally {
    killProcess(clientProcess);
  }
});

test('socket ping-pong flow sends ping and receives pong response', async ({ page }) => {
  await page.goto(`http://localhost:${CLIENT_PORT}`);
  await page.waitForLoadState('networkidle');

  // The Send Ping button is disabled until the socket connects — wait for it to be enabled
  const sendPingButton = page.getByRole('button', { name: 'Send Ping' });
  await expect(sendPingButton).toBeVisible();
  await expect(sendPingButton).toBeEnabled({ timeout: 10_000 });

  // Click Send Ping
  await sendPingButton.click();

  // Wait for the pong response — the component renders "server:pong received — ..."
  const pongResponse = page.getByText(/server:pong received/);
  await expect(pongResponse).toBeVisible({ timeout: 10_000 });

  // The Send Ping button should be available again (not in waiting state)
  await expect(sendPingButton).toBeVisible();
  await expect(sendPingButton).toBeEnabled();
});
