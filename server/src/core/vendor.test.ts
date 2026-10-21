import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The vendored fli-core files are byte-identical to @flivideo/core v0.23.0 (fc55518) below their
 * 5-line attribution header, so a later re-copy diffs cleanly. A formatter run over them fails
 * here. Hashes are of `git show fc55518:src/<file>` in flivideo/fli-core.
 */
const UPSTREAM_SHA256: Record<string, string> = {
  'capability.ts': 'e0f2b73420d997bdcc95eefb76a18d927eece2ac80cd615a13db509f5390998c',
  'failure-codes.ts': 'a3d6bb9a6f146cbf11edd92e378cf1e109f03b27cc5c528d63d909f1d66c9b20',
  'openrpc.ts': '8867a9331032be07a5f39072fc6ed08d940bc9cab9880d71caf24fbdb5493e84',
  'api-page.ts': '26a8be20da32771d0e7b9de5e96b125910f3da9f042a05866a5d91cdd76194e1',
};

describe('vendored fli-core files', () => {
  for (const [file, sha] of Object.entries(UPSTREAM_SHA256)) {
    it(`${file} is unchanged below its attribution header`, () => {
      const text = readFileSync(resolve(import.meta.dirname, 'vendor', file), 'utf8');
      const lines = text.split('\n');

      expect(lines[1]).toContain('Vendored from @flivideo/core v0.23.0 (commit fc55518');

      const body = lines.slice(5).join('\n');

      expect(createHash('sha256').update(body).digest('hex')).toBe(sha);
    });
  }
});
