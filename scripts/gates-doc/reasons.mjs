/**
 * Why each exemption exists, keyed by the key `collect()` gives it (see exemptions.mjs).
 * Only what a config comment, a commit or a generator says is written as a reason. Where nothing
 * says why, the text starts "reason unknown:" and names how to find out. Do not invent a reason:
 * the pin test fails an exemption with no entry here and an entry whose exemption is gone.
 */
const TS_ESLINT_SWAP =
  'Set by @appydave/appystack-config: typescript-eslint recommended turns the core rule off and its TS-aware @typescript-eslint/ version on.';
const VENDOR_BYTES =
  'Keeps upstream bytes (server/src/core/vendor/LICENSE), so it is not reformatted or linted.';
const GENERATED =
  'Generated data, not hand-written code: it would be reported as a clone of itself.';
const DATA_TABLE =
  'A content table with no logic: "literal normalization flags every table as a clone" (docs/duplicate-detection.md, Scope).';
const CAPTURED =
  'Captured OpenRig output and vendored spec files: data, not an implementation to share (docs/duplicate-detection.md, Scope).';
const NOT_TESTED_CODE =
  'Tests, e2e and test support are not production code, so knip does not count them as the project.';
const OPENRIG =
  'OpenRig drops its own runtime files into every seat folder (git-excluded); they are not ours.';

const GIT_IGNORED =
  'Git-ignored, so not source (git check-ignore confirms it against the repo .gitignore).';
const PI_OPENRIG =
  'OpenRig drops its own runtime files into every seat folder (git-excluded); added in 186c751 with no reason in its message.';
const COV_SUPPORT = 'Test support code (setup, helpers); coverage measures production code.';
const OX_AGENT =
  'Agent-tooling and OpenRig runtime folders, not our code ("agent-tooling files", comment in scripts/oxlint-gate.mjs).';
const RECORDED =
  'Vendored or recorded files (comment in lint/folder-limits.mjs, G09 4b1b721: "the same ones oxlint.config.ts ignores").';
const TEST_LOADER =
  'Test-only fixture loading (used by tests and scripts/update-snapshots.ts), not shipped in the built collector.';
const CRUISE_TESTS =
  'Production code is src/ minus tests and test support (header comment in .dependency-cruiser.cjs, G12 211f10f).';

export const REASONS = {
  'eslint|ignore|.openrig/**': OPENRIG,
  'eslint|ignore|.claude/**': OPENRIG,
  'eslint|ignore|.agents/**': OPENRIG,
  'eslint|ignore|.codex/**': OPENRIG,
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
  'eslint|off no-array-constructor|**/*.{js,mjs,cjs,ts,tsx}': TS_ESLINT_SWAP,
  'eslint|off no-unused-expressions|**/*.{js,mjs,cjs,ts,tsx}': TS_ESLINT_SWAP,
  'eslint|off no-console|**/*.{js,mjs,cjs,ts,tsx}':
    'Set by @appydave/appystack-config; a no-op here: nothing in this config turns no-console on, and the CLIs, scripts and server print to the console.',
  'eslint|off react/no-unsafe|**/*.{ts,tsx}':
    'Set by @appydave/appystack-config; eslint-plugin-react recommended leaves it off too, and there is no UNSAFE_ lifecycle code here.',
  'eslint|off react/prop-types|**/*.{ts,tsx}':
    'Set by @appydave/appystack-config: TypeScript types the props.',
  'eslint|off react/react-in-jsx-scope|**/*.{ts,tsx}':
    'Set by @appydave/appystack-config: the automatic JSX runtime (jsx: react-jsx, React 19) needs no React import.',
  'eslint|off max-lines-per-function|tests':
    'A describe() callback is a list of tests, not a long function (comment in eslint.config.js). max-lines still applies to test files.',
  'knip|.|ignore|test/root/fixtures/**':
    'Upstream OpenRig sources (Apache-2.0, see PINNED.md) read as files by the provenance test, never imported, so knip would call them unused.',
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
  'jscpd|ignore|**/.git/**': "Git's object store, not source.",
  'jscpd|ignore|**/.mochaccino/**': 'Design mockups (docs/duplicate-detection.md, Scope).',
  'jscpd|ignore|**/.claude/**':
    'Agent skills from the AppyStack scaffold (docs/duplicate-detection.md, Scope).',
  'jscpd|ignore|**/package-lock.json': 'Lockfile written by npm, not hand-written code.',
  'jscpd|ignore|**/test-results/**': GIT_IGNORED,
  'jscpd|ignore|**/coverage/**': GIT_IGNORED,
  'jscpd|ignore|**/.quality-results/**': GIT_IGNORED,
  'jscpd|ignore|**/.jscpd/**': "jscpd's own baselines, which quote the clones they record.",
  'jscpd|ignore|.dependency-cruiser-known-*.json':
    'Generated cycle baselines (npm run arch:baseline), added with them in G11 (5c5f28a).',
  'jscpd|ignore|scores-baseline.json':
    'A data file the scores gate writes (B04, e9206c5: ".jscpd.json ignores the data file").',
  'jscpd|ignore|**/*.css':
    '"The Stylelint ratchet owns styles; repeated declaration lists are not shareable code" (docs/duplicate-detection.md, Scope).',
  'jscpd|ignore|api/**': 'Generated by npm run api:gen (docs/duplicate-detection.md, Scope).',
  'jscpd|ignore|test/fixtures/**': CAPTURED,
  'jscpd|ignore|test/root/fixtures/**': CAPTURED,
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
  'prettier|ignore|package-lock.json': 'npm writes the lockfile in its own format.',
  'prettier|ignore|test-results': GIT_IGNORED,
  'prettier|ignore|.appynet':
    'An agent run folder inside a worktree (briefs and screenshots), git-ignored and not app source.',
  'prettier|ignore|.openrig': PI_OPENRIG,
  'prettier|ignore|.claude': PI_OPENRIG,
  'prettier|ignore|.agents': PI_OPENRIG,
  'prettier|ignore|.codex': PI_OPENRIG,
  'prettier|ignore|test/fixtures':
    'Recorded, redacted OpenRig captures (test/fixtures/README.md), kept as captured; D6 in docs/contract.md.',
  'prettier|ignore|CLAUDE.local.md':
    'OpenRig writes it into seat folders (D6 in docs/contract.md); it is excluded only in .git/info/exclude, which prettier does not read.',
  'prettier|ignore|.mcp.json': 'OpenRig writes this file (dev-hub): D6, commit 988b51b.',
  'prettier|ignore|server/src/core/vendor':
    'Vendored fli-core files keep upstream bytes; "excluded from prettier/eslint" in eb1a7a2 and the comment in .prettierignore.',
  'prettier|ignore|/api':
    'Generated by npm run api:gen and compared byte-for-byte by npm run api:check; anchored to the root so no other folder named api is skipped.',
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
    'Keeps tests out of the built collector that launchd runs.',
  'tsconfig|collector/tsconfig.build.json|exclude|src/adapters/fixtureSources.ts': TEST_LOADER,
  'tsconfig|collector/tsconfig.build.json|exclude|src/snapshotCases.ts': TEST_LOADER,
  'vitest|server/vitest.config.ts|coverage exclude|src/test/**': COV_SUPPORT,
  'tsconfig|tsconfig.e2e.json|exclude|test/root/fixtures':
    'Partial upstream OpenRig sources whose imports are not copied in, so typechecking them would fail.',
  'vitest|client/vitest.config.ts|coverage exclude|src/test/**': COV_SUPPORT,
  'oxlint|ignore|**/dist/**': GIT_IGNORED,
  'oxlint|ignore|**/node_modules/**': GIT_IGNORED,
  'oxlint|ignore|.claude/**': OX_AGENT,
  'oxlint|ignore|.openrig/**': OX_AGENT,
  'oxlint|ignore|.agents/**': OX_AGENT,
  'oxlint|ignore|.codex/**': OX_AGENT,
  'oxlint|ignore|scripts/provenance/out/**': RECORDED,
  'oxlint|ignore|server/src/core/vendor/**': RECORDED,
  'oxlint|ignore|test/fixtures/**': RECORDED,
  'oxlint|ignore|test/root/fixtures/**': RECORDED,
  'oxlint|off anti-slop/require-safety-comment-for-type-assertion|**/*.test.{ts,tsx,mjs,js}, **/*.spec.{ts,tsx,mjs,js}, e2e/**, test/**, **/test/**, **/*test-kit*':
    'Production code only: tests, e2e, test support and recorded fixtures are not counted (comment in oxlint.config.ts).',
  'oxlint|off anti-slop/no-unknown-parameters|collector/src/adapters/**':
    'The I/O boundary: adapters turn daemon JSON into domain types, so taking `unknown` is their job (comment in oxlint.config.ts).',
  'depcruise|pathNot|(^|/)test/': CRUISE_TESTS,
  'depcruise|pathNot|test-kit': CRUISE_TESTS,
  'depcruise|pathNot|\\.(test|spec)\\.[cm]?[jt]sx?$': CRUISE_TESTS,
  'depcruise|pathNot|\\.test\\.tsx?$':
    'Layer rules guard production code; a test renders the app above the layer it tests.',
  'depcruise|pathNot|\\.test\\.ts$':
    'The layer rule guards production code; an adapter test may import above the adapters.',
  'depcruise|doNotFollow|node_modules': GIT_IGNORED,
  'depcruise|exclude|^(client|server|collector|shared)/dist/': GIT_IGNORED,
  'depcruise-folders|doNotFollow|node_modules': GIT_IGNORED,
  'depcruise-folders|exclude|(node_modules|dist)|\\.(test|spec)\\.tsx?$':
    'Folder cycles count only code that runs, so no tests (header comment in .dependency-cruiser-folders.cjs); node_modules and dist are git-ignored.',
  'folder-limits|not scanned|test/fixtures/': RECORDED,
  'folder-limits|not scanned|test/root/fixtures/': RECORDED,
  'folder-limits|not scanned|server/src/core/vendor/': RECORDED,
  'folder-limits|not scanned|scripts/provenance/out/': RECORDED,
  'test-trust|skip dir|node_modules': GIT_IGNORED,
  'test-trust|skip dir|dist': GIT_IGNORED,
  'test-trust|skip dir|fixtures':
    'Fixture folders hold recorded or upstream files, not our tests (pinned in test/root/test-trust.test.ts).',
  'test-trust|skip dir|test-results': GIT_IGNORED,
};
