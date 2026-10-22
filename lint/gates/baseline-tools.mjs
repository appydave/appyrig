/** Helpers shared by the baseline writers (oxlint-gate, folder-limits, knip-gate): one module, so a script under scripts/ needs one `../` import, not two. */

import { spawnSync } from 'node:child_process';
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

/** Stops the gate (exit 1, message prefixed with its `gate` name) when `--init` is asked for over an existing baseline. */
export function refuseInitOverBaseline({ gate, root, baseline, command }) {
  const refusal = initRefusal({ root, baseline, command });

  if (refusal) {
    console.error(`${gate}: ${refusal}`);
    process.exit(1);
  }
}

/** How much of git's own error text goes into a message. */
const GIT_ERROR_TAIL = 200;

const git = (root, args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });

/** The branch a baseline is compared with: `origin/main`, or `HEAD` when the repo has no such ref. */
export function baseRef(root) {
  return git(root, ['rev-parse', '--verify', '--quiet', 'origin/main']).status === 0
    ? 'origin/main'
    : 'HEAD';
}

/**
 * The sections the baseline file holds as COMMITTED on `ref`, never as it sits in the working copy:
 * [] when the file is not on `ref` at all. Throws when git cannot say (not a repository, bad ref), so
 * a caller that needs the answer fails closed.
 */
export function sectionsOnBase({ root, baselineFile, ref = baseRef(root) }) {
  const listed = git(root, ['ls-tree', '--name-only', ref, '--', baselineFile]);

  if (listed.status !== 0) {
    throw new Error(`git could not read ${ref} (${listed.stderr.trim().slice(0, GIT_ERROR_TAIL)})`);
  }

  if (!listed.stdout.trim()) {
    return [];
  }

  const shown = git(root, ['show', `${ref}:${baselineFile}`]);

  if (shown.status !== 0) {
    throw new Error(`git could not show ${baselineFile} on ${ref}`);
  }

  return Object.keys(JSON.parse(shown.stdout)).filter((key) => key !== 'about');
}

/** A copy of `counts` with its keys in alphabetical order, so a rewritten baseline diffs cleanly. */
export function sortedByKey(counts, mapValue = (value) => value) {
  return Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map((key) => [key, mapValue(counts[key])])
  );
}
