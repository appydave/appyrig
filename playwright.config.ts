import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    headless: true,
    // Each lane / QA copy points at its own client port (MISSION.md); default = main's client.
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:7190',
  },
});
