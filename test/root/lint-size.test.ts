import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { resolve } from 'node:path';

/** G04 wiring: the repo's ESLint config applies the size limits to source files, one bad example per limit. */
const ROOT = resolve(import.meta.dirname, '../..');

const lines = (n: number): string =>
  Array.from({ length: n }, (_, i) => `  const v${i} = ${i};`).join('\n');
const steps = (n: number): string => Array.from({ length: n }, () => '  a += b;').join('\n');
const members = (n: number): string =>
  Array.from({ length: n }, (_, i) => `  m${i}: number;`).join('\n');

const BAD: Array<[string, string, string]> = [
  [
    'max-lines',
    'file of 301 lines',
    `${Array.from({ length: 301 }, (_, i) => `export const c${i} = ${i};`).join('\n')}\n`,
  ],
  ['max-lines-per-function', 'function of 41 lines', `export function f() {\n${lines(39)}\n}\n`],
  [
    'max-params',
    'function with 4 parameters',
    'export function f(a: number, b: number, c: number, d: number) {\n  return a + b + c + d;\n}\n',
  ],
  [
    'no-restricted-syntax',
    'interface with 31 members',
    `export interface I {\n${members(31)}\n}\n`,
  ],
  [
    'no-restricted-syntax',
    'type literal with 31 members',
    `export type T = {\n${members(31)}\n};\n`,
  ],
  ['no-restricted-syntax', 'class with 31 members', `export class C {\n${members(31)}\n}\n`],
  [
    'no-restricted-syntax',
    'method signature with 4 parameters',
    'export interface S {\n  call(a: number, b: number, c: number, d: number): void;\n}\n',
  ],
];

async function ruleIds(code: string, name: string): Promise<Array<string | null>> {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, {
    filePath: resolve(ROOT, `server/src/${name}.ts`),
  });

  return result?.messages.map((m) => m.ruleId) ?? [];
}

describe('G04 size limits', () => {
  it.each(BAD)('%s fails on a %s', async (ruleId, label, code) => {
    expect(await ruleIds(code, `g04-bad-${label.replace(/\W+/g, '-')}`)).toContain(ruleId);
  });

  it('accepts code at the limits', async () => {
    const good = `export function f(a: number, b: number, c: number) {\n${steps(36)}\n\n  return a + b + c;\n}\n`;

    expect(await ruleIds(good, 'g04-good-example')).toEqual([]);
  });
});
