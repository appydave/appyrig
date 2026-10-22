/** Helpers shared by the baseline writers (oxlint-gate, folder-limits, knip-gate): one module, so a script under scripts/ needs one `../` import, not two. */

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

/** A copy of `counts` with its keys in alphabetical order, so a rewritten baseline diffs cleanly. */
export function sortedByKey(counts, mapValue = (value) => value) {
  return Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map((key) => [key, mapValue(counts[key])])
  );
}
