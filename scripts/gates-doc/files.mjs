import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { make, quotedIn } from './entry.mjs';

const TSCONFIGS = [
  'tsconfig.e2e.json',
  'client/tsconfig.json',
  'server/tsconfig.json',
  'collector/tsconfig.json',
  'collector/tsconfig.build.json',
  'shared/tsconfig.json',
];
const VITEST_CONFIGS = [
  'client/vitest.config.ts',
  'server/vitest.config.ts',
  'collector/vitest.config.ts',
];
// Known limit: the list ends at the first `]`, so a coverage pattern that contains one (a glob like
// 'src/[a-z]/**') cuts the list short and the rest go unlisted. test/root/docs/gates-doc.test.ts does
// not catch that.
const COVERAGE_EXCLUDE = /exclude:\s*\[([^\]]*)\]/;

const text = (root, file) => readFileSync(join(root, file), 'utf8');

/** Files each tsconfig leaves out of its program. */
const fromTsconfig = (root) =>
  TSCONFIGS.filter((file) => existsSync(join(root, file))).flatMap((file) =>
    (JSON.parse(text(root, file)).exclude ?? []).map((pattern) =>
      make({ source: 'tsconfig', where: file, kind: 'exclude', pattern })
    )
  );

/** Files each vitest config leaves out of coverage (the `exclude: [...]` list in the source). */
const fromVitest = (root) =>
  VITEST_CONFIGS.flatMap((file) =>
    quotedIn({ root, file, pattern: COVERAGE_EXCLUDE }).map((pattern) =>
      make({ source: 'vitest', where: file, kind: 'coverage exclude', pattern })
    )
  );

/** Paths the format gate (prettier --check) skips: every non-comment line of .prettierignore. */
const fromPrettier = (root) =>
  text(root, '.prettierignore')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((pattern) => make({ source: 'prettier', kind: 'ignore', pattern }));

/** Exemptions in configs that need no import: plain JSON, a bracketed list, or a line list. */
export const collectFiles = (root) => [
  ...fromTsconfig(root),
  ...fromVitest(root),
  ...fromPrettier(root),
];
