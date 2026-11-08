import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import stylelint from 'stylelint';
import { resolve } from 'node:path';

/** G05 wiring: named constants in source, palette-only colours in TypeScript and CSS, one bad example per form. */
const ROOT = resolve(import.meta.dirname, '../..');

async function eslintRules(code: string, name: string): Promise<Array<string | null>> {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath: resolve(ROOT, name) });

  return result?.messages.map((m) => m.ruleId) ?? [];
}

async function cssRules(code: string, file: string): Promise<string[]> {
  const result = await stylelint.lint({
    code,
    codeFilename: resolve(ROOT, file),
    configFile: resolve(ROOT, 'stylelint.config.mjs'),
  });

  return result.results.flatMap((r) => r.warnings.map((w) => w.rule));
}

describe('List 6: magic numbers are not a lint rule', () => {
  it('a bare number in production code passes, so the retired rule cannot come back unnoticed', async () => {
    const code =
      'export const options = { retries: 7, wait: () => setTimeout(() => undefined, 5000) };\n';

    expect(await eslintRules(code, 'server/src/list6-bare-number.ts')).toEqual([]);
  });
});

describe('G05 palette only', () => {
  it.each([
    ['a hex string', "export const c = '#1a1515';\n"],
    ['an rgb() string', "export const c = 'rgb(26, 21, 21)';\n"],
    ['an hsla() template', 'export const c = (a: number) => `hsla(0, 0%, 0%, ${a})`;\n'],
  ])('TypeScript fails on %s', async (_label, code) => {
    expect(await eslintRules(code, 'client/src/g05-bad-colour.ts')).toContain(
      'no-restricted-syntax'
    );
  });

  it('TypeScript accepts a custom property name', async () => {
    const code = "export const c = 'var(--ar-ink)';\n";

    expect(await eslintRules(code, 'client/src/g05-good-colour.ts')).toEqual([]);
  });

  it.each([
    ['color-no-hex', 'a { color: #fff; }\n'],
    ['function-disallowed-list', 'a { box-shadow: 0 0 1px rgba(0, 0, 0, 0.2); }\n'],
    ['color-named', 'a { color: red; }\n'],
  ])('CSS fails with %s', async (rule, code) => {
    expect(await cssRules(code, 'client/src/g05-bad.css')).toContain(rule);
  });

  it('CSS accepts var(--ar-*) and the palette file itself may hold literals', async () => {
    expect(await cssRules('a { color: var(--ar-ink); }\n', 'client/src/g05-good.css')).toEqual([]);
    expect(
      await cssRules(':root { --ar-ink: #342d2d; }\n', 'client/src/styles/tokens.css')
    ).toEqual([]);
  });
});
