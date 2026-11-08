/**
 * Why each exemption exists, keyed by the key `collect()` gives it (see exemptions.mjs).
 * Only what a config comment, a commit or a generator says is written as a reason. Where nothing
 * says why, the text starts "reason unknown:" and names how to find out. Do not invent a reason:
 * the pin test fails an exemption with no entry here and an entry whose exemption is gone.
 */
const SHARED =
  'reason unknown: set by @appydave/appystack-config/eslint/react with no reason given; ask the AppyStack template owner';
const VENDOR_BYTES =
  'Keeps upstream bytes (server/src/core/vendor/LICENSE), so it is not reformatted or linted.';
const GENERATED =
  'Generated data, not hand-written code: it would be reported as a clone of itself.';
const DATA_TABLE =
  'reason unknown: a content or data table (see its head); added with the G08 duplicate profiles (16d1c5a), no reason recorded. Find out: git log -S"<file>" -- .jscpd.json';
const JSCPD_NOISE =
  'reason unknown: added with the G08 duplicate profiles (16d1c5a), no reason recorded. Find out: git log -S"<pattern>" -- .jscpd.json';
const NOT_TESTED_CODE =
  'Tests, e2e and test support are not production code, so knip does not count them as the project.';
const OPENRIG =
  'OpenRig drops its own runtime files into every seat folder (git-excluded); they are not ours.';

export const REASONS = {
  'eslint|ignore|.openrig/**': OPENRIG,
  'eslint|ignore|.claude/**': OPENRIG,
  'eslint|ignore|.agents/**': OPENRIG,
  'eslint|ignore|.codex/**': OPENRIG,
  'eslint|ignore|test/fixtures/**':
    'reason unknown: listed among the OpenRig files in eslint.config.js, whose comment does not cover it. Find out: git log -S"test/fixtures" -- eslint.config.js',
  'eslint|ignore|server/src/core/vendor/**': VENDOR_BYTES,
  'eslint|ignore|test/root/fixtures/**':
    'OpenRig files copied in for the provenance check (Apache-2.0) keep upstream bytes.',
  'eslint|ignore|**/dist/**': SHARED,
  'eslint|ignore|**/build/**': SHARED,
  'eslint|ignore|**/node_modules/**': SHARED,
  'eslint|ignore|**/coverage/**': SHARED,
  'eslint|off no-undef|**/*.{js,mjs,cjs,ts,tsx}':
    'TypeScript handles this (comment in the shared config).',
  'eslint|off no-unused-vars|**/*.{js,mjs,cjs,ts,tsx}':
    'The TypeScript-aware version is used instead (comment in the shared config).',
  'eslint|off no-array-constructor|**/*.{js,mjs,cjs,ts,tsx}': SHARED,
  'eslint|off no-unused-expressions|**/*.{js,mjs,cjs,ts,tsx}': SHARED,
  'eslint|off no-console|**/*.{js,mjs,cjs,ts,tsx}': SHARED,
  'eslint|off react/no-unsafe|**/*.{ts,tsx}': SHARED,
  'eslint|off react/prop-types|**/*.{ts,tsx}': SHARED,
  'eslint|off react/react-in-jsx-scope|**/*.{ts,tsx}': SHARED,
  'eslint|off max-lines-per-function|tests':
    'A describe() callback is a list of tests, not a long function (comment in eslint.config.js). max-lines still applies to test files.',
  'knip|.|ignore|test/fixtures/**':
    'reason unknown: no comment in knip.json. Find out: git log -S"test/fixtures" -- knip.json',
  'knip|.|ignore|test/root/fixtures/**':
    'reason unknown: same folder eslint treats as upstream bytes (provenance check). Find out: git log -S"test/root/fixtures" -- knip.json',
  'knip|server|ignore|src/core/vendor/**':
    'Vendored fli-core files keep upstream bytes (added in G11, 5c5f28a).',
  'knip|client|project|!src/**/*.test.{ts,tsx}!': NOT_TESTED_CODE,
  'knip|client|project|!src/**/test/**!': NOT_TESTED_CODE,
  'knip|client|project|!src/**/*test-kit*!': NOT_TESTED_CODE,
  'knip|server|project|!src/**/*.test.{ts,tsx}!': NOT_TESTED_CODE,
  'knip|server|project|!src/**/test/**!': NOT_TESTED_CODE,
  'knip|server|project|!src/**/*test-kit*!': NOT_TESTED_CODE,
  'knip|collector|project|!src/**/*.test.{ts,tsx}!': NOT_TESTED_CODE,
  'knip|collector|project|!src/**/test/**!': NOT_TESTED_CODE,
  'knip|collector|project|!src/**/*test-kit*!': NOT_TESTED_CODE,
  'knip|shared|project|!src/**/*.test.{ts,tsx}!': NOT_TESTED_CODE,
  'knip|shared|project|!src/**/test/**!': NOT_TESTED_CODE,
  'knip|shared|project|!src/**/*test-kit*!': NOT_TESTED_CODE,
  'jscpd|ignore|**/node_modules/**': JSCPD_NOISE,
  'jscpd|ignore|**/dist/**': JSCPD_NOISE,
  'jscpd|ignore|**/.git/**': JSCPD_NOISE,
  'jscpd|ignore|**/.mochaccino/**': JSCPD_NOISE,
  'jscpd|ignore|**/.claude/**': JSCPD_NOISE,
  'jscpd|ignore|**/package-lock.json': JSCPD_NOISE,
  'jscpd|ignore|**/playwright-report/**': JSCPD_NOISE,
  'jscpd|ignore|**/test-results/**': JSCPD_NOISE,
  'jscpd|ignore|**/coverage/**': JSCPD_NOISE,
  'jscpd|ignore|**/.quality-results/**': JSCPD_NOISE,
  'jscpd|ignore|**/.jscpd/**': JSCPD_NOISE,
  'jscpd|ignore|.dependency-cruiser-known-*.json': JSCPD_NOISE,
  'jscpd|ignore|scores-baseline.json': JSCPD_NOISE,
  'jscpd|ignore|**/*.css': JSCPD_NOISE,
  'jscpd|ignore|api/**': JSCPD_NOISE,
  'jscpd|ignore|test/fixtures/**': JSCPD_NOISE,
  'jscpd|ignore|test/root/fixtures/**': JSCPD_NOISE,
  'jscpd|ignore|client/src/domain/learn/atlas.json': `${GENERATED} Written by scripts/sync-atlas.mjs.`,
  'jscpd|ignore|client/src/domain/learn/rig-commands.json': `${GENERATED} Written by scripts/sync-rig-commands.mjs.`,
  'jscpd|ignore|client/src/domain/learn/commands.ts': DATA_TABLE,
  'jscpd|ignore|client/src/domain/learn/glossary.ts': DATA_TABLE,
  'jscpd|ignore|client/src/domain/learn/lessons.ts': DATA_TABLE,
  'jscpd|ignore|client/src/kit/v1ArchiveManifest.ts': DATA_TABLE,
};
