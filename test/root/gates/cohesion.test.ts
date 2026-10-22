import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs gate with no type declarations
import { compare, messageFor, scanDirectory } from '@root/lint/gates/cohesion.mjs';

const made: string[] = [];

/** A scratch workspace whose `src/` holds `files`, scanned the way the gate scans a real one. */
function scan(files: Record<string, string>): Record<string, number> {
  const root = mkdtempSync(join(tmpdir(), 'cohesion-probe-'));

  made.push(root);

  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, 'src', name)), { recursive: true });
    writeFileSync(join(root, 'src', name), text);
  }

  return scanDirectory({ sourceDir: join(root, 'src'), workspace: 'probe', prefix: 'probe/src' });
}

afterEach(() => {
  while (made.length) {
    rmSync(made.pop() as string, { recursive: true, force: true });
  }
});

/** Five exports that never use each other: a catch-all bucket. */
const MIXED = `
export const formatMoney = (n: number) => '$' + n.toFixed(2);
export const formatDate = (d: Date) => d.toISOString();
export const parseId = (s: string) => Number(s);
export const MAX_RETRIES = 3;
export const slug = (s: string) => s.toLowerCase();
`;

/** Five exports that build on one another: one responsibility. */
const COHESIVE = `
export const base = (n: number) => n * 2;
export const doubled = (n: number) => base(base(n));
export const tripled = (n: number) => base(n) + doubled(n);
export const label = (n: number) => String(tripled(n));
export const show = (n: number) => label(n) + base(n);
`;

describe('which files the cohesion gate flags', () => {
  it('flags a catch-all module of unrelated exports', () => {
    const found = scan({ 'mixed.ts': MIXED });

    expect(Object.keys(found)).toEqual(['probe/src/mixed.ts']);
    expect(found['probe/src/mixed.ts']).toBeGreaterThan(2);
  });

  it('passes a module whose exports build on one another', () => {
    expect(scan({ 'cohesive.ts': COHESIVE })).toEqual({});
  });

  it('passes a module with fewer exports than the minimum, however unrelated', () => {
    const few = 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n';

    expect(scan({ 'few.ts': few })).toEqual({});
  });

  it('does not flag a barrel, which re-exports and owns nothing', () => {
    const barrel = "export * from './mixed.js';\nexport * from './cohesive.js';\n";
    const found = scan({ 'index.ts': barrel, 'mixed.ts': MIXED, 'cohesive.ts': COHESIVE });

    expect(Object.keys(found)).toEqual(['probe/src/mixed.ts']);
  });

  it('leaves out a types.ts, tests and vendored code', () => {
    const found = scan({
      'types.ts': MIXED,
      'mixed.test.ts': MIXED,
      'test/helper.ts': MIXED,
      'core/vendor/lib.ts': MIXED,
      'plain.ts': 'export const x = 1;\n',
    });

    expect(found).toEqual({});
  });

  it('fails the run, instead of reporting clean, when there is nothing to scan', () => {
    expect(() => scan({ 'notes.md': 'nothing' })).toThrow('no TypeScript files');
  });
});

describe('comparing with the baseline', () => {
  it('accepts a file at its recorded count', () => {
    expect(compare({ 'a.ts': 3 }, { 'a.ts': 3 })).toEqual({ grown: [], shrunk: [] });
  });

  it('flags a new file and a worse count as grown', () => {
    const { grown } = compare({ 'a.ts': 4, 'new.ts': 3 }, { 'a.ts': 3 });

    expect(grown).toEqual([
      { file: 'a.ts', now: 4, was: 3 },
      { file: 'new.ts', now: 3, was: 0 },
    ]);
  });

  it('flags a better count or a fixed file as shrunk, so the baseline cannot go stale', () => {
    const { shrunk } = compare({ 'a.ts': 2 }, { 'a.ts': 3, 'gone.ts': 4 });

    expect(shrunk).toEqual([
      { file: 'a.ts', now: 2, was: 3 },
      { file: 'gone.ts', now: 0, was: 4 },
    ]);
  });

  it('tells the agent what to do, not just what is wrong', () => {
    const text = messageFor({ file: 'client/src/x.ts', now: 3, was: 0 });

    expect(text).toContain('client/src/x.ts');
    expect(text).toContain('Split it by responsibility');
  });
});
