import { defineConfig } from 'vitest/config';

const repo = new URL('../..', import.meta.url).pathname;

/** Root-level suite: tests of repo-root tools (bin/appyrig.mjs, scripts/gen-api.ts) that belong to no one package. */
export default defineConfig({
  // The same aliases as tsconfig.json: these tests import scripts, lint and the other workspaces.
  resolve: {
    alias: {
      '@root': repo,
      '@shared': `${repo}shared/src`,
      '@server': `${repo}server/src`,
      '@collector': `${repo}collector/src`,
    },
  },
  test: {
    // Rebuild shared/dist first, so a stale build cannot give a false pass (scripts/vitest/build-shared.mjs).
    globalSetup: [`${repo}scripts/vitest/build-shared.mjs`],
    environment: 'node',
    testTimeout: 30000,
    include: ['test/root/**/*.test.ts'],
    root: repo,
  },
});
