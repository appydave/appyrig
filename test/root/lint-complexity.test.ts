import { describe, expect, it } from 'vitest';
import { ESLint, type Linter } from 'eslint';
import { resolve } from 'node:path';

/** G06 wiring: the repo's ESLint config applies the complexity limits to source files, one bad example per rule. */
const ROOT = resolve(import.meta.dirname, '../..');

// Eight sequential ifs: cyclomatic 9, cognitive 8 (at the limit), so only the cyclomatic rule fires.
const manyBranches = `export function f(a: number[]) {
  let r = 0;
${Array.from({ length: 8 }, (_, i) => `  if (a[${i}]) {\n    r += ${i};\n  }`).join('\n')}

  return r;
}
`;

// Five nested ifs: cognitive 15, cyclomatic 6 (at the limit), so only the cognitive rule fires.
const deeplyNested = `export function f(a: number, b: number, c: number, d: number, e: number) {
  if (a) {
    if (b) {
      if (c) {
        if (d) {
          if (e) {
            return 1;
          }
        }
      }
    }
  }

  return 0;
}
`;

// Five operands joined by four operators: expression 4 (limit 3).
const longCondition = `export const ok = (a: boolean, b: boolean, c: boolean, d: boolean, e: boolean) =>
  a && b && c && d && e;
`;

const BAD: Array<[string, string, string]> = [
  ['sonarjs/cyclomatic-complexity', 'function with 9 branches', manyBranches],
  ['sonarjs/cognitive-complexity', 'function with 5 nested ifs', deeplyNested],
  ['sonarjs/expression-complexity', 'condition with 4 operators', longCondition],
];

async function lint(code: string, name: string, ext = 'ts'): Promise<Linter.LintMessage[]> {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, {
    filePath: resolve(ROOT, `server/src/${name}.${ext}`),
  });

  return result?.messages ?? [];
}

const ruleIds = async (code: string, name: string): Promise<Array<string | null>> =>
  (await lint(code, name)).map((m) => m.ruleId);

describe('G06 complexity limits', () => {
  it.each(BAD)('%s fails on a %s', async (ruleId, label, code) => {
    expect(await ruleIds(code, `g06-bad-${label.replace(/\W+/g, '-')}`)).toContain(ruleId);
  });

  it('reports each example against its own rule only', async () => {
    expect(await ruleIds(manyBranches, 'g06-only-cyclomatic')).not.toContain(
      'sonarjs/cognitive-complexity'
    );
    expect(await ruleIds(deeplyNested, 'g06-only-cognitive')).not.toContain(
      'sonarjs/cyclomatic-complexity'
    );
  });

  it('reports the cyclomatic message as plain text, not SonarJS JSON', async () => {
    const [found] = (await lint(manyBranches, 'g06-message')).filter(
      (m) => m.ruleId === 'sonarjs/cyclomatic-complexity'
    );

    expect(found?.message).toBe(
      'Function has a complexity of 9 which is greater than 6 authorized.'
    );
  });

  it('accepts code at the limits', async () => {
    const good = `export function f(a: boolean, b: boolean, c: boolean) {
  if (a && b) {
    return c;
  }

  return false;
}
`;

    expect(await ruleIds(good, 'g06-good-example')).toEqual([]);
  });
});
