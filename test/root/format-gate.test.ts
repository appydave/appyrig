import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * G01 gate: formatting is enforced by `prettier --check .` in CI. This proves the gate itself:
 * unformatted code fails it, formatted code passes it, CI runs it, and the ignore file does not
 * hide app source from it.
 */

const ROOT = new URL('../..', import.meta.url).pathname;
const PRETTIER = join(ROOT, 'node_modules/.bin/prettier');
const scratch = mkdtempSync(join(tmpdir(), 'format-gate-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function prettier(args: string[]) {
  const r = spawnSync(PRETTIER, args, { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Writes `body` to a temp file and checks it with this repo's own config, as `format:check` does. */
function check(name: string, body: string) {
  const file = join(scratch, name);
  writeFileSync(file, body);
  return { file, ...prettier(['--config', join(ROOT, '.prettierrc'), '--check', file]) };
}

describe('Feature: the format gate fails unformatted files', () => {
  const bad: [string, string, string][] = [
    ['ts: double quotes, no semicolon, spacing', 'a.ts', 'const  x = "a"\nexport { x }\n'],
    ['tsx: bad indentation', 'b.tsx', 'export const B = () => {\n      return <div>b</div>;\n};\n'],
    ['json: one-line object', 'c.json', '{"a":1,"b":[1,2]}\n'],
    ['md: list marker and blank lines', 'd.md', '#  Title\n\n\n*  item\n'],
    ['css: braces on one line', 'e.css', 'a{color:red}\n'],
  ];

  it.each(bad)(
    'Scenario: given a %s, when prettier checks it, then it exits 1 and names the file',
    (_name, file, body) => {
      const r = check(file, body);
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain(file);
    }
  );
});

/**
 * Written in the repo's style so that each option in .prettierrc matters: arrow parens, single
 * quotes, semicolons, a 93-column line that must stay on one line (print width 100), an object that
 * must break with a trailing comma, and 2-space nesting. Change an option and this stops passing.
 */
const REPO_STYLE = `const id = (x) => x;
export const mid = { alpha: id('a'), beta: id('b'), gamma: id('c'), delta: id('d'), eps: 1 };
export const wide = {
  alpha: id('a'),
  beta: id('b'),
  gamma: id('c'),
  delta: id('d'),
  epsilon: id('e'),
  z: 1,
};
function nested() {
  if (true) {
    return [1, 2];
  }
}
`;

describe('Feature: the format gate passes formatted files', () => {
  it('Scenario: given code written to the repo style, when prettier checks it, then it exits 0', () => {
    const r = check('ok.ts', REPO_STYLE);
    expect(r.status, r.out).toBe(0);
  });
});

describe('Feature: the format gate runs where it counts', () => {
  it('Scenario: given the CI workflow, then it runs npm run format:check', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/run:\s*npm run format:check\s*$/m);
  });

  it('Scenario: given package.json, then format:check is a failing check, not a rewrite', () => {
    const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
    expect(scripts['format:check']).toBe('prettier --check .');
  });

  it('Scenario: given the pre-commit hook, then it formats staged files', () => {
    const hook = readFileSync(join(ROOT, '.husky/pre-commit'), 'utf8');
    expect(hook).toContain('lint-staged');
    const staged = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))['lint-staged'];
    expect(JSON.stringify(staged)).toContain('prettier --write');
  });
});

describe('Feature: the format gate does not hide app source', () => {
  const source = [
    'client/src/App.tsx',
    'server/src/index.ts',
    'collector/src/builder.ts',
    'shared/src/index.ts',
    'scripts/arch-strings.mjs',
    'e2e/v2-esc.spec.ts',
    'test/root/format-gate.test.ts',
    '.github/workflows/ci.yml',
    'package.json',
  ];

  it.each(source)('Scenario: given %s, then prettier does not ignore it', (path) => {
    const r = prettier(['--file-info', path]);
    expect(r.status, r.out).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ ignored: false });
  });

  it('Scenario: given vendored OpenRig bytes, then prettier leaves them alone', () => {
    const r = prettier(['--file-info', 'test/root/fixtures/openrig-0.6.11-source/LICENSE']);
    expect(JSON.parse(r.out)).toMatchObject({ ignored: true });
  });
});
