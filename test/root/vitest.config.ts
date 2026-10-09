import { defineConfig } from 'vitest/config';

/** Root-level suite: tests of repo-root tools (bin/appyrig.mjs, scripts/gen-api.ts) that belong to no one package. */
export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
    include: ['test/root/**/*.test.ts'],
    root: new URL('../..', import.meta.url).pathname,
  },
});
