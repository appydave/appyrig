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
    environment: 'node',
    testTimeout: 30000,
    include: ['test/root/**/*.test.ts'],
    root: repo,
  },
});
