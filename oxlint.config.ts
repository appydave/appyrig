import { defineConfig } from 'oxlint';

// G02: no type lies. Only the anti-slop type rules run here; ESLint stays the general linter.
// Today's findings are recorded in oxlint-baseline.json and only new ones fail (scripts/oxlint-gate.mjs).
export default defineConfig({
  jsPlugins: [{ name: 'anti-slop', specifier: 'oxlint-plugin-anti-slop' }],
  categories: { correctness: 'off' },
  ignorePatterns: [
    '**/dist/**',
    '**/node_modules/**',
    '.claude/**',
    '.openrig/**',
    '.agents/**',
    '.codex/**',
    'api/**',
    'scripts/provenance/out/**',
    'server/src/core/vendor/**',
    'test/fixtures/**',
    'test/root/fixtures/**',
  ],
  rules: {
    'anti-slop/no-chained-type-assertions': 'error',
    'anti-slop/no-unknown-parameters': 'error',
    'anti-slop/no-unsafe-dictionary-type': 'error',
    'anti-slop/no-module-mocking': 'error',
    // No findings today: these keep it that way.
    'anti-slop/no-widen-then-assert': 'error',
    'anti-slop/no-unknown-type-aliases': 'error',
    'anti-slop/no-reflect-get': 'error',
    'anti-slop/no-reflect-apply': 'error',
  },
  overrides: [
    {
      // The I/O boundary: these adapters turn daemon JSON into domain types, so taking `unknown`
      // is their job. Everywhere else a function takes a named type.
      files: ['collector/src/adapters/**'],
      rules: { 'anti-slop/no-unknown-parameters': 'off' },
    },
  ],
});
