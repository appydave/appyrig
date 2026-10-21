import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { resolve } from 'node:path';

/** G03 wiring: the repo's ESLint config applies the spacing rules to source files, one bad example per rule. */
const ROOT = resolve(import.meta.dirname, '../..');

const BAD: Array<[string, string]> = [
  ['curly', 'export function f(a: boolean) {\n\n  if (a) return 1;\n\n  return 2;\n}\n'],
  ['no-sequences', 'export let a = 0;\nexport let b = 0;\n\na = 1, b = 2;\n'],
  ['one-var', 'export function f() {\n  let a = 1, b = 2;\n\n  return a + b;\n}\n'],
  [
    '@stylistic/max-statements-per-line',
    'export function f() {\n  const a = 1; const b = 2;\n\n  return a + b;\n}\n',
  ],
  [
    '@stylistic/brace-style',
    'export function f(a: boolean) {\n  if (a) { return 1; }\n\n  return 2;\n}\n',
  ],
  [
    '@stylistic/lines-between-class-members',
    'export class A {\n  a() {\n    return 1;\n  }\n  b() {\n    return 2;\n  }\n}\n',
  ],
  [
    '@stylistic/padding-line-between-statements',
    'export function f() {\n  const a = 1;\n  return a;\n}\n',
  ],
];

describe('G03 readable spacing', () => {
  it.each(BAD)('%s fails on a deliberately bad example', async (ruleId, code) => {
    const eslint = new ESLint({ cwd: ROOT });
    const [result] = await eslint.lintText(code, {
      filePath: resolve(ROOT, 'server/src/g03-bad-example.ts'),
    });

    expect(result?.messages.map((m) => m.ruleId)).toContain(ruleId);
  });

  it('accepts well-spaced code', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const good =
      'export function f(a: boolean) {\n  if (a) {\n    return 1;\n  }\n\n  return 2;\n}\n';
    const [result] = await eslint.lintText(good, {
      filePath: resolve(ROOT, 'server/src/g03-good-example.ts'),
    });

    expect(result?.messages).toEqual([]);
  });
});
