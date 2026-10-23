#!/usr/bin/env node
/**
 * The pre-push hook (.husky/pre-push): the architecture and dead-code checks that CI would otherwise be the
 * first to run, in parallel, printing only the ones that fail. `arch:ratchet` is left out because it
 * rewrites baseline files. Unit tests, e2e and the semantic duplicate check stay in CI.
 * SKIP_PREPUSH=1 and `git push --no-verify` are for a human in a hurry; CI is the only thing behind them.
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../../..');
const TAIL_LINES = 40;
const MS_PER_SECOND = 1000;

export const CHECKS = [
  'knip',
  'arch:check',
  'arch:folders',
  'cohesion',
  'coupling',
  'scores',
  'folders',
  'lint:duplicates:fast',
  'typecheck',
];

/** Runs `npm run <script>`; resolves with its name, exit code and the end of its output. */
function runScript(script) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', script], { cwd: ROOT });
    const chunks = [];

    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('close', (code) => {
      const tail = Buffer.concat(chunks).toString().trim().split('\n').slice(-TAIL_LINES);

      resolve({ script, code, tail: tail.join('\n') });
    });
  });
}

/** The failing runs, as the text to print. */
export function failures(runs) {
  return runs
    .filter((run) => run.code !== 0)
    .map((run) => `npm run ${run.script} failed:\n${run.tail}`);
}

async function main() {
  if (process.env.SKIP_PREPUSH === '1') {
    console.log('pre-push: skipped (SKIP_PREPUSH=1). CI still runs every check.');

    return;
  }

  const started = Date.now();
  const broken = failures(await Promise.all(CHECKS.map(runScript)));

  if (broken.length) {
    console.error(
      `${broken.join('\n\n')}\n\npre-push: ${broken.length} of ${CHECKS.length} checks failed. Fix them, then push again.`
    );
    process.exit(1);
  }

  console.log(
    `pre-push: ${CHECKS.length} checks passed in ${Math.round((Date.now() - started) / MS_PER_SECOND)} s`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
