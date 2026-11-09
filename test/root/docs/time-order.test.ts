import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/**
 * AFTER audit X3: the contract allows any UTC offset, so a timestamp sorted as text can be wrong.
 * Timestamps sort with compareTimes from shared; this fails if a text sort of one comes back.
 */
const TEXT_SORT = String.raw`\.(createdAt|updatedAt|at|ts|lastAt)\.localeCompare\(`;

function textSorts(): string[] {
  try {
    return execFileSync(
      'git',
      ['grep', '-nE', TEXT_SORT, '--', 'client/src', 'server/src', 'shared/src', ':!*.test.*'],
      { encoding: 'utf8' }
    )
      .trim()
      .split('\n');
  } catch (err) {
    // git grep exits 1 for "no matches"; anything else is a broken check, not a pass.
    if (err instanceof Error && 'status' in err && err.status === 1) {
      return [];
    }

    throw err;
  }
}

describe('no timestamp is sorted as text', () => {
  it('finds none in production code', () => {
    expect(textSorts()).toEqual([]);
  });

  it('the search does find a text sort when there is one', () => {
    const line = 'x.sort((a, b) => a.createdAt.localeCompare(b.createdAt));';

    expect(new RegExp(TEXT_SORT).test(line)).toBe(true);
  });
});
