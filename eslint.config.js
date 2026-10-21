import appyConfig from '@appydave/appystack-config/eslint/react';
import stylistic from '@stylistic/eslint-plugin';
import { limitRules } from './lint/limits.js';
import { spacingRules } from './lint/spacing.js';

// OpenRig drops its own runtime files into every seat folder (git-excluded); they are not ours.
const openRigFiles = ['.openrig/**', '.claude/**', '.agents/**', '.codex/**', 'test/fixtures/**'];

// Vendored fli-core files keep upstream bytes (server/src/core/vendor/LICENSE). So do the OpenRig
// files copied into test/root/fixtures for the provenance check (Apache-2.0).
const vendored = ['server/src/core/vendor/**', 'test/root/fixtures/**'];

export default [
  { ignores: [...openRigFiles, ...vendored] },
  ...appyConfig,
  // The shared config only warns on `any`; a warning is a suggestion, so here it fails the build.
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  // G03: readable spacing. Today's findings sit in eslint-suppressions.json; only new ones fail.
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    plugins: { '@stylistic': stylistic },
    rules: spacingRules,
  },
  // G04: size. Today's findings sit in eslint-suppressions.json; only new ones fail.
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    rules: limitRules,
  },
  // A describe() callback is a list of tests, not a long function, and a test file may run to 500 lines.
  // Parameters and members still use the shared limits.
  {
    files: [
      '**/*.test.{ts,tsx,mjs,js}',
      '**/*.spec.{ts,tsx,mjs,js}',
      'e2e/**',
      'test/**',
      '**/test/**',
      '**/*test-kit*',
    ],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': ['error', { max: 500, skipBlankLines: false, skipComments: false }],
    },
  },
];
