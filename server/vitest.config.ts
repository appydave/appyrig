import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@server': path.resolve(__dirname, 'src') } },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    // A fixed hub token for every server test: without one the hub refuses all browsers and
    // collectors. Tests that need "no token" build their own hub with hubToken: undefined.
    env: { HUB_TOKEN: 'test-hub-token-0123456789' },
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
