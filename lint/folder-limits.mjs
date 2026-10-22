#!/usr/bin/env node
/**
 * G09: folder size. Mirrors Omer's lint/folder-limits.js (spaghetti-busters 4e7a65f): a folder holds
 * at most 10 files and 10 subfolders. Today's oversize folders are recorded in folder-baseline.json
 * and only a folder that grows past its recorded count fails.
 *
 *   npm run folders            fail on any folder above the baseline, or a baseline that can shrink
 *   npm run folders:baseline   rewrite the baseline; refuses if anything would grow
 *
 * Counts git-tracked and not-ignored files, so a .DS_Store or a build folder cannot change the answer.
 * Exit: 0 clean, 1 findings, 2 the run itself failed (it counted nothing).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initRefusal } from './gates/init-guard.mjs';
import { sortedByKey } from './sorted.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const BASELINE_FILE = 'folder-baseline.json';

export const MAX_FILES = 10;
export const MAX_SUBFOLDERS = 10;

/** Every code and test root; the folders under them are checked. */
export const SCANNED = [
  'client/src',
  'server/src',
  'server/scripts',
  'shared/src',
  'collector/src',
  'test',
  'e2e',
  'scripts',
  'bin',
  'lint',
];

/** Vendored and recorded files: the same ones oxlint.config.ts ignores. */
export const NOT_SCANNED = [
  'test/fixtures/',
  'test/root/fixtures/',
  'server/src/core/vendor/',
  'scripts/provenance/out/',
];

const inScope = (file) =>
  SCANNED.some((r) => file.startsWith(`${r}/`)) && !NOT_SCANNED.some((p) => file.startsWith(p));

/** Direct files and subfolders of every folder at or under a scanned root: { folder: { files, subfolders } }. */
export function folderSizes(files) {
  const direct = new Map();
  const children = new Map();
  const touch = (folder) => {
    if (!direct.has(folder)) {
      direct.set(folder, 0);
      children.set(folder, new Set());
    }
  };

  for (const file of files.filter(inScope)) {
    let folder = dirname(file);

    touch(folder);
    direct.set(folder, direct.get(folder) + 1);

    while (SCANNED.every((r) => folder !== r)) {
      const parent = dirname(folder);

      touch(parent);
      children.get(parent).add(folder);
      folder = parent;
    }
  }

  return Object.fromEntries(
    [...direct].map(([folder, n]) => [folder, { files: n, subfolders: children.get(folder).size }])
  );
}

/** Folders over a limit, as { folder: { files?, subfolders? } } holding only the oversize counts. */
export function oversize(sizes) {
  const found = {};

  for (const [folder, size] of Object.entries(sizes)) {
    const over = {};

    if (size.files > MAX_FILES) {
      over.files = size.files;
    }

    if (size.subfolders > MAX_SUBFOLDERS) {
      over.subfolders = size.subfolders;
    }

    if (Object.keys(over).length) {
      found[folder] = over;
    }
  }

  return found;
}

const rows = (counts) =>
  Object.entries(counts).flatMap(([folder, kinds]) =>
    Object.entries(kinds).map(([kind, n]) => [`${folder}\t${kind}`, n])
  );

/** Rows of `from` whose count `differs(n, other count)` from the same row of `against`. */
function changed(from, against, differs) {
  const other = new Map(rows(against));

  return rows(from)
    .map(([key, n]) => ({ key, n, other: other.get(key) ?? 0 }))
    .filter((r) => differs(r.n, r.other))
    .map((r) => ({
      folder: r.key.split('\t')[0],
      kind: r.key.split('\t')[1],
      now: r.n,
      was: r.other,
    }));
}

/** `grown`: above the baseline (or not in it). `shrunk`: below it, so the baseline is stale. */
export function compare(actual, baseline) {
  return {
    grown: changed(actual, baseline, (n, was) => n > was),
    shrunk: changed(baseline, actual, (was, n) => n < was).map((r) => ({
      ...r,
      now: r.was,
      was: r.now,
    })),
  };
}

export function messageFor({ folder, kind, now }) {
  const limit = kind === 'files' ? MAX_FILES : MAX_SUBFOLDERS;
  const advice =
    kind === 'files'
      ? 'Split it into subfolders by feature.'
      : 'Group related subfolders under a parent folder by feature.';

  return `${folder} has ${now} direct ${kind}; maximum is ${limit}. ${advice}`;
}

const KIB = 1024;
const BUFFER_MIB = 16;
const MAX_BUFFER = BUFFER_MIB * KIB * KIB;

function listFiles() {
  const r = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', ...SCANNED],
    {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    }
  );

  // A file deleted in the working tree is still in the index until it is committed.
  return r.status === 0 ? r.stdout.split('\n').filter((f) => f && existsSync(join(ROOT, f))) : null;
}

const sorted = (counts) => sortedByKey(counts);

const ABOUT =
  'Folders over 10 files or 10 subfolders when G09 was added, with their counts. It may shrink, never grow. Rewrite with npm run folders:baseline.';

function fail(code, text) {
  console.error(text);
  process.exit(code);
}

function writeBaseline({ file, actual, grown, init }) {
  if (grown.length && !init) {
    fail(1, `folder-limits: refusing to grow the baseline.\n${grown.map(messageFor).join('\n')}`);
  }

  writeFileSync(file, `${JSON.stringify({ about: ABOUT, folders: sorted(actual) }, null, 2)}\n`);
  console.log(`folder-limits: wrote ${BASELINE_FILE} (${Object.keys(actual).length} folders)`);
}

function report({ grown, shrunk }) {
  if (grown.length) {
    fail(
      1,
      `folder-limits FAILED: ${grown.length} folder(s) above the baseline\n\n${grown.map(messageFor).join('\n')}`
    );
  }

  if (shrunk.length) {
    fail(
      1,
      `folder-limits FAILED: the baseline is out of date, ${shrunk.length} count(s) went down. Good: record it with npm run folders:baseline.\n` +
        shrunk.map((s) => `  ${s.folder}: ${s.kind} ${s.was} -> ${s.now}`).join('\n')
    );
  }
}

function readBaseline(file, init) {
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, 'utf8')).folders;
  }

  if (!init) {
    fail(
      2,
      `folder-limits: ${BASELINE_FILE} is missing. Create it once with: node lint/folder-limits.mjs --init`
    );
  }

  return {};
}

function main() {
  const refusal = initRefusal({ root: ROOT, baseline: BASELINE_FILE, command: 'folders:baseline' });

  if (refusal) {
    fail(1, `folder-limits: ${refusal}`);
  }

  const files = listFiles();

  if (!files?.length) {
    fail(2, 'folder-limits: git listed no files, so nothing was checked.');
  }

  const sizes = folderSizes(files);
  const actual = oversize(sizes);
  const file = join(ROOT, BASELINE_FILE);
  const init = process.argv.includes('--init');
  const result = compare(actual, readBaseline(file, init));

  if (init || process.argv.includes('--update')) {
    return writeBaseline({ file, actual, grown: result.grown, init });
  }

  report(result);
  console.log(
    `folder-limits ok: ${Object.keys(actual).length} oversize folders, all in the baseline (${Object.keys(sizes).length} folders checked)`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
