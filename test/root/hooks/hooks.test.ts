import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs hook with no type declarations
import { editedFile, eslintLines, scopedPath } from '@root/lint/hooks/edit-check.mjs';

const root = new URL('../../..', import.meta.url).pathname.replace(/\/$/, '');

describe('which edits the Claude Code hook looks at', () => {
  it('reads the file path from the hook JSON, and nothing from anything else', () => {
    expect(editedFile('{"tool_input":{"file_path":"/a/b.ts"}}')).toBe('/a/b.ts');
    expect(editedFile('not json')).toBeNull();
    expect(editedFile('{}')).toBeNull();
  });

  it('checks a TypeScript file inside this checkout', () => {
    const file = `${root}/lint/hooks/edit-check.mjs`;

    expect(scopedPath({ file, root })).toBe('lint/hooks/edit-check.mjs');
  });

  it.each([
    ['a file outside the checkout', '/somewhere/else/x.ts'],
    ['a file in node_modules', `${root}/node_modules/eslint/package.json`],
    ['a non-code file', `${root}/README.md`],
    ['a file that does not exist', `${root}/client/src/nope.ts`],
    ['no path at all', null],
  ])('leaves %s alone', (_name, file) => {
    expect(scopedPath({ file, root })).toBeNull();
  });
});

describe('what the hook says about a finding', () => {
  const json = JSON.stringify([
    { messages: [{ line: 3, column: 1, ruleId: 'max-params', message: 'Too many parameters.' }] },
  ]);

  it('names the file, the position, the rule and the message', () => {
    const [line] = eslintLines({ path: 'a.ts', json, frozen: [] });

    expect(line).toContain('a.ts:3:1 max-params: Too many parameters.');
  });

  it('explains a file that has frozen findings of the same rule', () => {
    const lines = eslintLines({ path: 'a.ts', json, frozen: ['max-params'] });

    expect(lines.at(-1)).toMatch(/more findings of a rule than it froze/);
  });

  it('adds no note when the rule was never frozen in that file', () => {
    expect(eslintLines({ path: 'a.ts', json, frozen: ['max-lines'] })).toHaveLength(1);
  });
});

describe('the hook as Claude Code runs it', () => {
  const run = (input: string) =>
    spawnSync(process.execPath, [`${root}/lint/hooks/edit-check.mjs`], { input, encoding: 'utf8' });

  it('fails open on input it cannot read', () => {
    expect(run('not json').status).toBe(0);
  });

  it('passes a clean file quickly and silently', () => {
    const input = JSON.stringify({
      tool_input: { file_path: `${root}/lint/hooks/edit-check.mjs` },
    });
    const result = run(input);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});
