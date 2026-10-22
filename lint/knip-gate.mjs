#!/usr/bin/env node
/**
 * G11: dead code. Mirrors Omer's `knip` and `knip --production` (spaghetti-busters 7f13d40). Knip has no
 * baseline of its own, so this runs it twice, counts the findings per file and issue type, and compares
 * them with knip-baseline.json: only a count above the baseline fails, and a count below it fails until
 * the baseline is rewritten, so it can only shrink.
 *
 *   npm run knip             fail on any (mode, file, type) count above the baseline, or below it
 *   npm run knip:baseline    rewrite the baseline; refuses if anything would grow
 *
 * `--production` leaves out tests, so a helper that only a test uses shows up there.
 * Exit: 0 clean, 1 findings, 2 the run itself failed (a run that did not look is never a clean one).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initRefusal } from './gates/baseline-tools.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const BASELINE_FILE = 'knip-baseline.json';
const MODES = { normal: [], production: ['--production'] };
const KIB = 1024;
const BUFFER_MIB = 64;
const MAX_BUFFER = BUFFER_MIB * KIB * KIB;
const ERROR_TAIL = 400;
const NOT_A_TYPE = new Set(['file', 'owners']);

const ADVICE = {
  files:
    'Unused file. Delete it, or import it from code that runs. Do not keep it for a test: the production run does not count tests.',
  exports:
    'Unused export. Delete the function or constant if nothing uses it. Dropping only `export` leaves an unused declaration that fails the typecheck.',
  types: 'Unused exported type. Delete it, or use it. Dropping only `export` leaves it unused.',
  duplicates: 'The same thing is exported under two names. Export it once and import that name.',
  dependencies: 'Unused dependency. Remove it from package.json.',
  devDependencies: 'Unused devDependency. Remove it from package.json.',
  unlisted:
    'Imported but not in package.json. Add it to the dependencies of the workspace that imports it.',
  binaries: 'A command run here that no dependency provides. Add its package to devDependencies.',
};

/** The issue types one file has, with how many: { exports: 2, types: 1 }. */
function typeCounts(issue) {
  return Object.fromEntries(
    Object.entries(issue)
      .filter(([type]) => !NOT_A_TYPE.has(type))
      .map(([type, found]) => [type, Object.keys(found ?? {}).length])
      .filter(([, n]) => n > 0)
  );
}

/** Findings per file per type for one Knip JSON report: { 'server/src/x.ts': { exports: 2 } }. */
export function countIssues(report) {
  const counts = {};

  for (const issue of report.issues ?? []) {
    const types = typeCounts(issue);

    if (Object.keys(types).length) {
      counts[issue.file] = types;
    }
  }

  return counts;
}

/** { mode: { file: { type: n } } } as flat rows: key "mode\tfile\ttype" -> n. */
const flatten = (byMode) =>
  new Map(
    Object.entries(byMode).flatMap(([mode, files]) =>
      Object.entries(files).flatMap(([file, types]) =>
        Object.entries(types).map(([type, n]) => [`${mode}\t${file}\t${type}`, n])
      )
    )
  );

/** `grown`: above the baseline (or not in it). `shrunk`: below it, so the baseline is stale. */
export function compare(actual, baseline) {
  const now = flatten(actual);
  const was = flatten(baseline);
  const keys = new Set([...now.keys(), ...was.keys()]);
  const rows = [...keys].map((key) => ({ key, now: now.get(key) ?? 0, was: was.get(key) ?? 0 }));

  return {
    grown: rows.filter((r) => r.now > r.was),
    shrunk: rows.filter((r) => r.now < r.was),
  };
}

export function messageFor({ key, now, was }) {
  const [mode, file, type] = key.split('\t');
  const note = was ? ` (baseline allows ${was})` : '';

  return `${file} [${mode}] ${now} ${type}${note}: ${ADVICE[type] ?? 'Remove it.'}`;
}

function runKnip(extra) {
  const r = spawnSync('npx', ['knip', '--reporter', 'json', '--no-exit-code', ...extra], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });

  try {
    return { report: JSON.parse(r.stdout) };
  } catch {
    return {
      error: `knip printed no JSON (exit ${r.status}): ${(r.stderr || r.stdout).slice(0, ERROR_TAIL)}`,
    };
  }
}

function measure() {
  const actual = {};

  for (const [mode, extra] of Object.entries(MODES)) {
    const out = runKnip(extra);

    if (out.error) {
      console.error(`knip-gate: the ${mode} run failed, so nothing was checked.\n${out.error}`);
      process.exit(2);
    }

    actual[mode] = countIssues(out.report);
  }

  return actual;
}

const total = (byMode) => [...flatten(byMode).values()].reduce((a, b) => a + b, 0);
const sortKeys = (o) =>
  Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]])
  );
const sortedModes = (byMode) =>
  Object.fromEntries(Object.entries(byMode).map(([m, files]) => [m, sortKeys(files)]));

function writeBaseline(file, actual) {
  const about =
    'Knip findings recorded when G11 was added: per mode (normal, production), file and issue type. It may shrink, never grow. Rewrite with npm run knip:baseline.';

  writeFileSync(file, `${JSON.stringify({ about, findings: sortedModes(actual) }, null, 2)}\n`);
  console.log(`knip-gate: wrote ${BASELINE_FILE} (${total(actual)} findings)`);
}

function fail(code, text) {
  console.error(text);
  process.exit(code);
}

function report({ grown, shrunk }) {
  if (grown.length) {
    fail(
      1,
      `knip-gate FAILED: ${grown.length} count(s) above the baseline\n${grown.map(messageFor).join('\n')}`
    );
  }

  if (shrunk.length) {
    fail(
      1,
      `knip-gate FAILED: the baseline is out of date, ${shrunk.length} count(s) went down. Good: record it with npm run knip:baseline.\n` +
        shrunk.map((s) => `  ${s.key.replaceAll('\t', ' ')}: ${s.was} -> ${s.now}`).join('\n')
    );
  }
}

/** `--update` rewrites the baseline, but never to a bigger one. */
const wantsUpdate = ({ grown }) => process.argv.includes('--update') && !grown.length;

function refuseInit() {
  const refusal = initRefusal({ root: ROOT, baseline: BASELINE_FILE, command: 'knip:baseline' });

  if (refusal) {
    fail(1, `knip-gate: ${refusal}`);
  }
}

function main() {
  refuseInit();

  const file = join(ROOT, BASELINE_FILE);
  const init = process.argv.includes('--init');

  if (!existsSync(file) && !init) {
    fail(
      2,
      `knip-gate: ${BASELINE_FILE} is missing. Create it once with: node lint/knip-gate.mjs --init`
    );
  }

  const actual = measure();
  const baseline = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).findings : {};
  const result = compare(actual, baseline);

  if (init || wantsUpdate(result)) {
    return writeBaseline(file, actual);
  }

  report(result);
  console.log(`knip-gate ok: ${total(actual)} findings, all in the baseline`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
