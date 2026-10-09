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

test('page title contains AppyStack', async ({ page }) => {
  await page.goto(`http://localhost:${CLIENT_PORT}`);
  await expect(page).toHaveTitle(/AppyStack/);
});

test('at least one status card is visible', async ({ page }) => {
  await page.goto(`http://localhost:${CLIENT_PORT}`);
  await page.waitForLoadState('networkidle');
  // The status grid renders cards for server health info
  const statusGrid = page.locator('[data-testid="status-grid"]');
  await expect(statusGrid).toBeVisible();
});

test('/health endpoint returns 200', async () => {
  const res = await fetch(`http://localhost:${SERVER_PORT}/health`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { status: string };
  expect(body.status).toBe('ok');
});
