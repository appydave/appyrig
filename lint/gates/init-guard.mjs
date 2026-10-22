import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `--init` writes a baseline from scratch, so over an existing one it would skip the refuse-growth rule.
 * Returns the message to fail with when `--init` was asked for and the baseline already exists, else null.
 */
export function initRefusal({ root, baseline, command }) {
  if (!process.argv.includes('--init') || !existsSync(join(root, baseline))) {
    return null;
  }

  return `${baseline} exists: use \`npm run ${command}\` (it refuses growth); --init is only for a repo with no baseline yet`;
}
