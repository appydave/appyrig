import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs gate with no type declarations
import { problems } from '@root/lint/gates/cycle-baseline.mjs';

const entry = (rule: string) => ({
  rule: { name: rule },
  from: 'client/src/a.ts',
  to: 'server/src/b.ts',
});

describe('writing a cycle baseline', () => {
  it('accepts the cycles it already holds', () => {
    expect(
      problems({ entries: [entry('no-circular')], rule: 'no-circular', committed: 1 })
    ).toEqual([]);
  });

  it('accepts fewer cycles than before (the baseline shrinks)', () => {
    expect(problems({ entries: [], rule: 'no-circular', committed: 1 })).toEqual([]);
  });

  it('refuses a layer violation and says to fix the import', () => {
    const found = problems({
      entries: [entry('client-not-server-or-collector')],
      rule: 'no-circular',
      committed: 0,
    });

    expect(found).toHaveLength(1);
    expect(found[0]).toContain(
      'client-not-server-or-collector: client/src/a.ts -> server/src/b.ts'
    );
    expect(found[0]).toContain('never baselined');
  });

  it('refuses a bigger cycle count than the committed one', () => {
    const entries = [entry('no-circular'), entry('no-circular')];

    expect(problems({ entries, rule: 'no-circular', committed: 1 })[0]).toContain(
      '2 cycles, the baseline holds 1'
    );
  });
});
