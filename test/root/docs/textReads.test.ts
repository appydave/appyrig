import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script with no types
import { collectFiles } from '@root/scripts/gates-doc/files.mjs';

/**
 * Some config lists are read as text because the config cannot be loaded. A read that finds no list
 * must stop the run: otherwise a reworded config lists nothing and the doc still looks complete.
 */

const made: string[] = [];
const VITEST = ['client', 'server', 'collector'].map((w) => `${w}/vitest.config.ts`);
const collect: (root: string) => unknown[] = collectFiles;

function scratch(vitestText: string): string {
  const root = mkdtempSync(join(tmpdir(), 'gates-doc-'));

  made.push(root);
  for (const [file, text] of [
    ['.prettierignore', 'dist\n'],
    ...VITEST.map((f) => [f, vitestText]),
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }

  return root;
}

afterEach(() => {
  while (made.length) {
    rmSync(made.pop() as string, { recursive: true, force: true });
  }
});

describe('Feature: a text-read config list that finds nothing stops the run', () => {
  it('Scenario: given vitest configs whose coverage list is reworded, then it throws and names the config', () => {
    const root = scratch("coverage: { skip: ['src/**/*.test.ts'] }");

    expect(() => collect(root)).toThrow('client/vitest.config.ts: found no exemption list');
  });

  it('Scenario: given vitest configs with a coverage exclude list, then they are read', () => {
    expect(collect(scratch("coverage: { exclude: ['src/x/**'] }")).length).toBeGreaterThan(0);
  });
});
