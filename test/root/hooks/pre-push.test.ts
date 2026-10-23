import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs hook with no type declarations
import { CHECKS, failures } from '@root/lint/hooks/pre-push.mjs';

describe('the pre-push set', () => {
  it('runs the architecture and dead-code checks, and not the ones that rewrite files or take minutes', () => {
    expect(CHECKS).toEqual(
      expect.arrayContaining(['knip', 'cohesion', 'coupling', 'scores', 'typecheck'])
    );
    expect(CHECKS).not.toContain('arch:ratchet');
    expect(CHECKS).not.toContain('lint:duplicates:semantic');
  });

  it('reports only the checks that failed, with their output', () => {
    const runs = [
      { script: 'knip', code: 0, tail: 'ok' },
      { script: 'scores', code: 1, tail: 'scores FAILED' },
    ];

    expect(failures(runs)).toEqual(['npm run scores failed:\nscores FAILED']);
  });
});
