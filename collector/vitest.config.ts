import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@collector': path.resolve(__dirname, 'src') } },
  test: {
    // Rebuild shared/dist first, so a stale build cannot give a false pass (scripts/vitest/build-shared.mjs).
    globalSetup: ['../scripts/vitest/build-shared.mjs'],
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    include: ['src/**/*.test.ts'],
  },
});
