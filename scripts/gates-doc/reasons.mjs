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

const GIT_IGNORED =
  'Git-ignored, so not source (git check-ignore confirms it against the repo .gitignore).';
const PI_SCAFFOLD =
  'reason unknown: in the first scaffold commit (5ef74dd, create-appystack), whose message gives none. Find out: git show 5ef74dd -- .prettierignore';
const PI_OPENRIG =
  'OpenRig drops its own runtime files into every seat folder (git-excluded); added in 186c751 with no reason in its message.';
const COV_TESTS =
  'reason unknown: no comment in the vitest config (the server one is from the scaffold, 5ef74dd). Find out: git log -S"exclude" -- <the config>';
const TS_DEFAULT =
  'reason unknown: no comment in the tsconfig. Find out: git log -S"exclude" -- <the tsconfig>';

export const REASONS = {
  'eslint|ignore|.openrig/**': OPENRIG,
  'eslint|ignore|.claude/**': OPENRIG,
  'eslint|ignore|.agents/**': OPENRIG,
  'eslint|ignore|.codex/**': OPENRIG,
  'eslint|ignore|test/fixtures/**':
    'reason unknown: added in 186c751 (P0b, which created these snapshot fixtures), message gives none; it sits among the OpenRig files in eslint.config.js, whose comment does not cover it.',
  'eslint|ignore|server/src/core/vendor/**': VENDOR_BYTES,
  'eslint|ignore|test/root/fixtures/**':
    'OpenRig files copied in for the provenance check (Apache-2.0) keep upstream bytes.',
  'eslint|ignore|**/dist/**': GIT_IGNORED,
  'eslint|ignore|**/build/**': GIT_IGNORED,
  'eslint|ignore|**/node_modules/**': GIT_IGNORED,
  'eslint|ignore|**/coverage/**': GIT_IGNORED,
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
    'reason unknown: in the first knip.json (G11, 5c5f28a), whose message gives none.',
  'knip|.|ignore|test/root/fixtures/**':
    'reason unknown: in the first knip.json (G11, 5c5f28a), whose message gives none; eslint treats the same folder as upstream bytes.',
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
  'jscpd|ignore|**/node_modules/**': GIT_IGNORED,
  'jscpd|ignore|**/dist/**': GIT_IGNORED,
  'jscpd|ignore|**/.git/**': JSCPD_NOISE,
  'jscpd|ignore|**/.mochaccino/**': JSCPD_NOISE,
  'jscpd|ignore|**/.claude/**': JSCPD_NOISE,
  'jscpd|ignore|**/package-lock.json': JSCPD_NOISE,
  'jscpd|ignore|**/playwright-report/**': JSCPD_NOISE,
  'jscpd|ignore|**/test-results/**': GIT_IGNORED,
  'jscpd|ignore|**/coverage/**': GIT_IGNORED,
  'jscpd|ignore|**/.quality-results/**': GIT_IGNORED,
  'jscpd|ignore|**/.jscpd/**': JSCPD_NOISE,
  'jscpd|ignore|.dependency-cruiser-known-*.json': JSCPD_NOISE,
  'jscpd|ignore|scores-baseline.json':
    'A data file the scores gate writes (B04, e9206c5: ".jscpd.json ignores the data file").',
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
  'prettier|ignore|dist': GIT_IGNORED,
  'prettier|ignore|build': GIT_IGNORED,
  'prettier|ignore|node_modules': GIT_IGNORED,
  'prettier|ignore|coverage': GIT_IGNORED,
  'prettier|ignore|package-lock.json': PI_SCAFFOLD,
  'prettier|ignore|test-results': GIT_IGNORED,
  'prettier|ignore|playwright-report': PI_SCAFFOLD,
  'prettier|ignore|.openrig': PI_OPENRIG,
  'prettier|ignore|.claude': PI_OPENRIG,
  'prettier|ignore|.agents': PI_OPENRIG,
  'prettier|ignore|.codex': PI_OPENRIG,
  'prettier|ignore|test/fixtures':
    'reason unknown: added in 186c751 (P0b, the snapshot fixtures), message gives none. Find out: git show 186c751 -- .prettierignore',
  'prettier|ignore|CLAUDE.local.md':
    'reason unknown: added in 186c751, message gives none (the file is OpenRig-written and git-excluded). Find out: git show 186c751 -- .prettierignore',
  'prettier|ignore|.mcp.json': 'OpenRig writes this file (dev-hub): D6, commit 988b51b.',
  'prettier|ignore|server/src/core/vendor':
    'Vendored fli-core files keep upstream bytes; "excluded from prettier/eslint" in eb1a7a2 and the comment in .prettierignore.',
  'prettier|ignore|/api':
    'reason unknown: anchored to the repo root in fc51624 ("r1 collector P4 L1"), which gives no reason. Find out: git show fc51624',
  'prettier|ignore|test/root/fixtures':
    'OpenRig spec files copied as-is (Apache-2.0) so the schema test parses the real bytes (comment in .prettierignore, b07fa02).',
  'prettier|ignore|scripts/provenance/out':
    'Provenance check output (comment in .prettierignore, 79e0d1f).',
  'prettier|ignore|eslint-suppressions.json':
    'ESLint rewrites this file itself (--prune-suppressions) in its own format (comment in .prettierignore).',
  'prettier|ignore|stylelint-suppressions.json':
    'Stylelint writes this file itself (--suppress) in its own format (comment in .prettierignore).',
  'prettier|ignore|docs/gates.md':
    'Generated by npm run docs:gates; prettier would pad the table and the pin test would then fail (List 7a-1, #85).',
  'tsconfig|client/tsconfig.json|exclude|node_modules': GIT_IGNORED,
  'tsconfig|server/tsconfig.json|exclude|node_modules': GIT_IGNORED,
  'tsconfig|server/tsconfig.json|exclude|dist': GIT_IGNORED,
  'tsconfig|collector/tsconfig.json|exclude|node_modules': GIT_IGNORED,
  'tsconfig|collector/tsconfig.json|exclude|dist': GIT_IGNORED,
  'tsconfig|collector/tsconfig.build.json|exclude|node_modules': GIT_IGNORED,
  'tsconfig|collector/tsconfig.build.json|exclude|dist': GIT_IGNORED,
  'tsconfig|shared/tsconfig.json|exclude|node_modules': GIT_IGNORED,
  'tsconfig|shared/tsconfig.json|exclude|dist': GIT_IGNORED,
  'tsconfig|collector/tsconfig.build.json|exclude|src/**/*.test.ts':
    'reason unknown: the build config leaves tests out of dist; no comment says so. Find out: git log -S"test.ts" -- collector/tsconfig.build.json',
  'tsconfig|collector/tsconfig.build.json|exclude|src/adapters/fixtureSources.ts':
    'reason unknown: no comment. Find out: git log -S"fixtureSources" -- collector/tsconfig.build.json',
  'vitest|server/vitest.config.ts|coverage exclude|src/**/*.test.{ts,tsx}': COV_TESTS,
  'vitest|server/vitest.config.ts|coverage exclude|src/test/**': COV_TESTS,
  'vitest|collector/vitest.config.ts|coverage exclude|src/**/*.test.ts': COV_TESTS,
  'tsconfig|tsconfig.e2e.json|exclude|test/root/fixtures':
    'reason unknown: the exclude arrived with the first tsconfig.e2e.json (G00b, 48900cb), whose message gives none; the folder holds OpenRig spec files copied as-is.',
  'vitest|client/vitest.config.ts|coverage exclude|src/**/*.test.{ts,tsx}': COV_TESTS,
  'vitest|client/vitest.config.ts|coverage exclude|src/test/**': COV_TESTS,
};
