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
    // The cast ratchet (G02-as-ratchet): every `as T` / `<T>x` in production code is a finding, so
    // today's count is the baseline and it can only go down. `as const` is not counted. The marker is
    // a string nobody writes, so a comment cannot exempt a cast; the gate also fails on the marker.
    'anti-slop/require-safety-comment-for-type-assertion': [
      'error',
      { markers: ['no-cast-exemption-exists'] },
    ],
  },
  overrides: [
    {
      // Production code only: tests, e2e, test support and recorded fixtures are not counted.
      files: [
        '**/*.test.{ts,tsx,mjs,js}',
        '**/*.spec.{ts,tsx,mjs,js}',
        'e2e/**',
        'test/**',
        '**/test/**',
        '**/*test-kit*',
      ],
      rules: { 'anti-slop/require-safety-comment-for-type-assertion': 'off' },
    },
    {
      // The I/O boundary: these adapters turn daemon JSON into domain types, so taking `unknown`
      // is their job. Everywhere else a function takes a named type.
      files: ['collector/src/adapters/**'],
      rules: { 'anti-slop/no-unknown-parameters': 'off' },
    },
  ],
});
