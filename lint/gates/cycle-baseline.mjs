#!/usr/bin/env node
/**
 * G11: rewrites the two cycle baselines (`npm run arch:baseline`, and `arch:ratchet` in CI), and refuses
 * to write anything but a cycle that is not bigger than the committed one. depcruise's own `--baseline`
 * records every violation of every rule, so a layer violation (a client file importing @server/...) would
 * be written into the baseline and then ignored. Here each baseline holds one rule, and may only shrink.
 *
 * Exit: 0 written, 1 refused, 2 the run itself failed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../../..');
const ERROR_TAIL = 300;
const KIB = 1024;
const BUFFER_MIB = 16;
const MAX_BUFFER = BUFFER_MIB * KIB * KIB;

const BASELINES = [
  {
    rule: 'no-circular',
    config: '.dependency-cruiser.cjs',
    file: '.dependency-cruiser-known-violations.json',
    dirs: ['shared/src', 'server/src', 'server/scripts', 'client/src', 'collector/src'],
  },
  {
    rule: 'no-runtime-folder-cycles',
    config: '.dependency-cruiser-folders.cjs',
    file: '.dependency-cruiser-known-folder-cycles.json',
    dirs: ['shared/src', 'server/src', 'client/src', 'collector/src'],
  },
];

/** Why this baseline may not be written, or []: another rule's violations, or more cycles than before. */
export function problems({ entries, rule, committed }) {
  const other = entries.filter((e) => e.rule.name !== rule);
  const found = other.map(
    (e) =>
      `${e.rule.name}: ${e.from} -> ${e.to}. Fix the import (move what is shared, or import from the layer below); a layer violation is never baselined.`
  );

  if (entries.length - other.length > committed) {
    found.push(
      `${rule}: ${entries.length - other.length} cycles, the baseline holds ${committed}. A new cycle is fixed, not baselined: move what both sides need into a module or folder neither imports from.`
    );
  }

  return found;
}

function cruise({ config, dirs }) {
  const r = spawnSync(
    'npx',
    ['depcruise', ...dirs, '--config', config, '--output-type', 'baseline'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    }
  );

  try {
    return JSON.parse(r.stdout);
  } catch {
    console.error(
      `cycle-baseline: depcruise printed no JSON (exit ${r.status}): ${r.stderr.slice(0, ERROR_TAIL)}`
    );
    process.exit(2);
  }
}

const committedCount = (file) =>
  existsSync(join(ROOT, file)) ? JSON.parse(readFileSync(join(ROOT, file), 'utf8')).length : 0;

function main() {
  const refused = [];
  const pending = [];

  for (const baseline of BASELINES) {
    const entries = cruise(baseline);
    const found = problems({
      entries,
      rule: baseline.rule,
      committed: committedCount(baseline.file),
    });

    refused.push(...found);
    pending.push({ file: baseline.file, entries });
  }

  if (refused.length) {
    console.error(`cycle-baseline REFUSED:\n${refused.join('\n')}`);
    process.exit(1);
  }

  for (const { file, entries } of pending) {
    writeFileSync(join(ROOT, file), `${JSON.stringify(entries, null, 2)}\n`);
    spawnSync('npx', ['prettier', '--write', file], { cwd: ROOT });
    console.log(`cycle-baseline: wrote ${file} (${entries.length})`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
