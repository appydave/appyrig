import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs gate with no type declarations
import { compare, countIssues, messageFor } from '@root/lint/knip-gate.mjs';

type Found = Partial<Record<'files' | 'exports' | 'types', object[]>>;

const issue = (file: string, found: Found) => ({
  file,
  files: [],
  exports: [],
  types: [],
  ...found,
});

describe('counting Knip findings', () => {
  it('counts each issue type per file and skips files with none', () => {
    const report = {
      issues: [
        issue('a.ts', { exports: [{ name: 'x' }, { name: 'y' }], types: [{ name: 'T' }] }),
        issue('b.ts', {}),
        issue('c.ts', { files: [{ name: 'c.ts' }] }),
      ],
    };

    expect(countIssues(report)).toEqual({
      'a.ts': { exports: 2, types: 1 },
      'c.ts': { files: 1 },
    });
  });
});

describe('knip baseline', () => {
  const baseline = { normal: { 'a.ts': { exports: 2 } }, production: { 'a.ts': { exports: 3 } } };

  it('passes when nothing changed', () => {
    expect(compare(baseline, baseline)).toEqual({ grown: [], shrunk: [] });
  });

  it('fails a baselined file that gains a finding, and a new file, in either mode', () => {
    const actual = {
      normal: { 'a.ts': { exports: 3 }, 'z.ts': { files: 1 } },
      production: baseline.production,
    };

    expect(compare(actual, baseline).grown.map((g: { key: string }) => g.key)).toEqual([
      'normal\ta.ts\texports',
      'normal\tz.ts\tfiles',
    ]);
  });

  it('asks for the baseline to be rewritten when a count went down, in either mode', () => {
    const actual = { normal: { 'a.ts': { exports: 2 } }, production: { 'a.ts': { exports: 2 } } };

    expect(compare(actual, baseline).shrunk).toEqual([
      { key: 'production\ta.ts\texports', now: 2, was: 3 },
    ]);
  });

  it('tells the agent what to do, not only what is wrong', () => {
    const text = messageFor({ key: 'production\ta.ts\texports', now: 4, was: 3 });

    expect(text).toContain('a.ts [production] 4 exports (baseline allows 3)');
    expect(text).toContain('Delete the function or constant');
  });
});
