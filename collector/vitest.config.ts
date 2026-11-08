import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Collector coverage floor, as the most uncovered lines/statements/functions/branches allowed. It starts at
// today's measured count (2026-11-08, 87% executed; main.ts and sources.ts are almost untested) and may only
// go DOWN: when you add tests, lower these numbers to the new count in the same PR. Raising one needs the
// judge's say. New code arrives with its own tests, or the uncovered count grows and `npm run test:coverage`
// fails with "Uncovered lines (N) exceed global threshold (M)".
const UNCOVERED_LINES = 215;
const UNCOVERED_STATEMENTS = 234;
const UNCOVERED_FUNCTIONS = 53;
const UNCOVERED_BRANCHES = 294;

export default defineConfig({
  resolve: { alias: { '@collector': path.resolve(__dirname, 'src') } },
  test: {
    // Rebuild shared/dist first, so a stale build cannot give a false pass (scripts/vitest/build-shared.mjs).
    globalSetup: ['../scripts/vitest/build-shared.mjs'],
    globals: true,
    environment: 'node',
    testTimeout: 10000,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      // The floor is on what is NOT covered (see UNCOVERED_* above); vitest reads a negative number as
      // "at most this many uncovered".
      thresholds: {
        lines: -UNCOVERED_LINES,
        statements: -UNCOVERED_STATEMENTS,
        functions: -UNCOVERED_FUNCTIONS,
        branches: -UNCOVERED_BRANCHES,
      },
    },
  },
});
