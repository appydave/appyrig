#!/usr/bin/env node
/**
 * G02: no type lies. Runs Oxlint with the anti-slop type rules (oxlint.config.ts) and compares the
 * findings with oxlint-baseline.json, so only NEW findings fail while today's are recorded.
 *
 *   npm run oxlint           fail on any (file, rule) count above the baseline, or below it
 *   npm run oxlint:baseline  rewrite the baseline; refuses if anything would grow
 *
 * Exit: 0 clean, 1 findings above the baseline (or a baseline that can shrink), 2 the run itself
 * failed (no JSON, no files, no rules): a run that did not look is never reported as a clean one.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const BASELINE_FILE = 'oxlint-baseline.json';
const RULE_PREFIX = /^anti-slop\((.*)\)$/;

/** Findings per file per rule: { 'server/src/x.ts': { 'no-unknown-parameters': 2 } }. */
export function countFindings(report) {
  const counts = {};
  for (const d of report.diagnostics ?? []) {
    const rule = RULE_PREFIX.exec(d.code ?? '')?.[1] ?? d.code ?? 'unknown-rule';
    counts[d.filename] ??= {};
    counts[d.filename][rule] = (counts[d.filename][rule] ?? 0) + 1;
  }
  return counts;
}

const flat = (counts) =>
  Object.entries(counts).flatMap(([file, rules]) =>
    Object.entries(rules).map(([rule, n]) => ({ file, rule, n }))
  );

/** `grown`: more than the baseline allows (or not in it). `shrunk`: fewer, so the baseline is stale. */
export function compare(actual, baseline) {
  const allowed = new Map(flat(baseline).map((r) => [`${r.file}\t${r.rule}`, r.n]));
  const seen = new Map(flat(actual).map((r) => [`${r.file}\t${r.rule}`, r.n]));
  const grown = [];
  const shrunk = [];
  for (const [key, n] of seen) {
    const was = allowed.get(key) ?? 0;
    const [file, rule] = key.split('\t');
    if (n > was) grown.push({ file, rule, now: n, was });
  }
  for (const [key, was] of allowed) {
    const n = seen.get(key) ?? 0;
    const [file, rule] = key.split('\t');
    if (n < was) shrunk.push({ file, rule, now: n, was });
  }
  return { grown, shrunk };
}

const sorted = (counts) =>
  Object.fromEntries(
    Object.keys(counts)
      .sort()
      .map((f) => [f, Object.fromEntries(Object.entries(counts[f]).sort())])
  );

/** Why a parsed report cannot be trusted as "clean", or null. A run that checked nothing is not a pass. */
export function reportProblem(report) {
  if (!(report.number_of_files > 0)) return 'oxlint checked 0 files';
  if (!(report.number_of_rules > 0))
    return 'oxlint loaded 0 rules (is the anti-slop plugin installed?)';
  return null;
}

function run() {
  const bin = join(ROOT, 'node_modules/.bin/oxlint');
  const r = spawnSync(bin, ['-c', 'oxlint.config.ts', '--format', 'json', '.'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    return {
      error: `oxlint printed no JSON (exit ${r.status}): ${(r.stderr || r.stdout).slice(0, 400)}`,
    };
  }
  const problem = reportProblem(report);
  if (problem) return { error: problem };
  return { report };
}

function main() {
  const update = process.argv.includes('--update');
  const init = process.argv.includes('--init');
  const out = run();
  if (out.error) {
    console.error(`oxlint-gate: the run failed, so nothing was checked.\n${out.error}`);
    process.exit(2);
  }
  const actual = countFindings(out.report);
  const total = flat(actual).reduce((s, r) => s + r.n, 0);
  const file = join(ROOT, BASELINE_FILE);
  const hasBaseline = existsSync(file);
  if (!hasBaseline && !init) {
    console.error(
      `oxlint-gate: ${BASELINE_FILE} is missing. Create it once with: node scripts/oxlint-gate.mjs --init`
    );
    process.exit(2);
  }
  const baseline = hasBaseline ? JSON.parse(readFileSync(file, 'utf8')).findings : {};
  const { grown, shrunk } = compare(actual, baseline);

  if (init || update) {
    if (grown.length && !init) {
      console.error(
        `oxlint-gate: refusing to grow the baseline (${grown.length} count(s) above it). Fix the new findings instead:\n` +
          grown.map((g) => `  ${g.file}: ${g.rule} ${g.was} -> ${g.now}`).join('\n')
      );
      process.exit(1);
    }
    writeFileSync(
      file,
      `${JSON.stringify({ about: 'Findings recorded when G02 was added: per file, per anti-slop rule. It may shrink, never grow. Rewrite with npm run oxlint:baseline.', findings: sorted(actual) }, null, 2)}\n`
    );
    console.log(
      `oxlint-gate: wrote ${BASELINE_FILE} (${total} findings in ${Object.keys(actual).length} files)`
    );
    return;
  }

  if (grown.length) {
    console.error(`oxlint-gate FAILED: ${grown.length} count(s) above the baseline\n`);
    const byKey = new Set(grown.map((g) => `${g.file}\t${g.rule}`));
    for (const d of out.report.diagnostics) {
      const rule = RULE_PREFIX.exec(d.code ?? '')?.[1] ?? d.code;
      if (!byKey.has(`${d.filename}\t${rule}`)) continue;
      const line = d.labels?.[0]?.span?.line ?? '?';
      console.error(`${d.filename}:${line} [${rule}] ${d.message}`);
    }
    console.error(
      '\nFix the new finding: give the function a named domain type and parse the input where it enters ' +
        '(a schema or parser at the I/O boundary), or inject the dependency instead of mocking a module. ' +
        'Do not add it to the baseline.'
    );
    process.exit(1);
  }
  if (shrunk.length) {
    console.error(
      `oxlint-gate FAILED: the baseline is out of date, ${shrunk.length} count(s) went down. Good: record it with npm run oxlint:baseline.\n` +
        shrunk.map((s) => `  ${s.file}: ${s.rule} ${s.was} -> ${s.now}`).join('\n')
    );
    process.exit(1);
  }
  console.log(
    `oxlint-gate ok: ${total} findings, all in the baseline (${out.report.number_of_files} files, ${out.report.number_of_rules} rules)`
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
