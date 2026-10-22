#!/usr/bin/env node
/**
 * G13: module cohesion. A file's exports should belong together. Runs archlint's `module_cohesion`
 * over the production code of client, server and collector and compares the findings with
 * cohesion-baseline.json, so only NEW findings fail while today's are recorded.
 *
 *   npm run cohesion           fail on a file above its baseline (or not in it), or below it
 *   npm run cohesion:baseline  rewrite the baseline; refuses if anything would grow
 *
 * Exit: 0 clean, 1 findings above the baseline (or a baseline that can shrink), 2 the run itself
 * failed: a run that did not look is never reported as a clean one.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseInitOverBaseline, sortedByKey } from './baseline-tools.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '../../..');
const BASELINE_FILE = 'cohesion-baseline.json';
const KIB = 1024;
const BUFFER_MIB = 64;
const MAX_BUFFER = BUFFER_MIB * KIB * KIB;
const ERROR_TAIL = 400;

/** The calibrated policy: a file with at least MIN_EXPORTS exports may fall into at most MAX_COMPONENTS groups. */
const MIN_EXPORTS = 5;
const MAX_COMPONENTS = 2;

/**
 * Workspaces scanned, each with its own path alias (archlint resolves imports against one package
 * root). `shared/` is not: it is the wire contract (zod schemas with their inferred types, their
 * limits and enum lists, event tables, plain types and a dozen helper functions). archlint counts each
 * schema/type pair as an unconnected group, so scanning it would turn every new schema into a red build.
 * Seven files there carry functions (daemondata, loadout, openrig/chainFiles, openrig/rigSpec, rigspecs,
 * snapshot, health); they are on the cleanup list so shared/ holds only declarations (rigSpec.ts and
 * snapshot.ts first): /Users/davidcruwys/dev/appyrigs/runs/spaghetti/appyrig/burn-down-backlog.md
 */
const WORKSPACES = ['client', 'server', 'collector'];

/** Files left out of the scan, as paths relative to a workspace's `src/`. */
const SKIPPED_FILE =
  /(?:(^|\/)test\/)|(?:\.(?:test|spec)\.[^/]+$)|(?:test-kit)|(?:\.d\.ts$)|(?:^core\/vendor\/)/;

/** Handed to archlint itself: contract files that only declare types (the role of Omer's `*-types.ts`). */
const ARCHLINT_EXCLUDES = ['**/types.ts'];

const ARCHLINT_BIN = fileURLToPath(import.meta.resolve('@archlinter/cli/bin/archlint.js'));

/** archlint's `lcom` detector is the switch that makes it resolve symbol references; its findings are all excluded. */
function archlintConfig(workspace) {
  return {
    aliases: { [`@${workspace}/*`]: './src/*' },
    rules: {
      module_cohesion: {
        severity: 'high',
        min_exports: MIN_EXPORTS,
        max_components: MAX_COMPONENTS,
        exclude: ARCHLINT_EXCLUDES,
      },
      lcom: { exclude: ['**/*'] },
    },
    tsconfig: false,
  };
}

/** Production files of one workspace copied to a disposable tree, so tests and vendored code are not scanned. */
function snapshot({ sourceDir, workspace }) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'cohesion-')));
  let copied = 0;

  cpSync(sourceDir, join(tmp, 'src'), {
    recursive: true,
    filter: (path) => {
      const rel = relative(sourceDir, path).replaceAll('\\', '/');
      const keep = !SKIPPED_FILE.test(rel);

      copied += keep && /\.tsx?$/.test(rel) ? 1 : 0;

      return keep;
    },
  });
  writeFileSync(join(tmp, 'package.json'), '{}');
  writeFileSync(join(tmp, 'archlint.json'), JSON.stringify(archlintConfig(workspace)));

  return { tmp, copied };
}

/** Components per file for one source directory: { 'server/src/x.ts': 3 }. Throws when the run did not look. */
export function scanDirectory({ sourceDir, workspace, prefix }) {
  const { tmp, copied } = snapshot({ sourceDir, workspace });

  try {
    if (copied === 0) {
      throw new Error(`${sourceDir} holds no TypeScript files to scan`);
    }

    const r = spawnSync(
      process.execPath,
      [
        ARCHLINT_BIN,
        'scan',
        join(tmp, 'src'),
        '--config',
        join(tmp, 'archlint.json'),
        '--detectors',
        'module_cohesion,lcom',
        '--no-cache',
        '--no-git',
        '--json',
        '--quiet',
      ],
      { encoding: 'utf8', maxBuffer: MAX_BUFFER }
    );
    let report;

    try {
      report = JSON.parse(r.stdout);
    } catch {
      throw new Error(
        `archlint printed no JSON (exit ${r.status}): ${r.stderr.slice(0, ERROR_TAIL)}`
      );
    }

    return countComponents(report, { tmp, prefix });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Reads archlint's report: files whose exports split into more groups than allowed, with the group count. */
function countComponents(report, { tmp, prefix }) {
  const counts = {};

  for (const smell of report.smells ?? []) {
    const components = smell.metrics?.[0]?.components;
    const file = smell.files?.[0];

    if (typeof components !== 'number' || !file) {
      throw new Error(`unreadable archlint finding: ${JSON.stringify(smell).slice(0, ERROR_TAIL)}`);
    }

    counts[`${prefix}/${relative(join(tmp, 'src'), file)}`] = components;
  }

  return counts;
}

/** Findings for the whole application. */
function scanApplication() {
  const counts = {};

  for (const workspace of WORKSPACES) {
    Object.assign(
      counts,
      scanDirectory({
        sourceDir: join(ROOT, workspace, 'src'),
        workspace,
        prefix: `${workspace}/src`,
      })
    );
  }

  return counts;
}

/** Entries of `from` whose count differs from `against` in the direction `isOff` names. */
function differences({ from, against, isOff }) {
  return Object.entries(from)
    .map(([file, count]) => ({ file, count, other: against[file] ?? 0 }))
    .filter(({ count, other }) => isOff(count, other));
}

/** `grown`: a file above its baseline or not in it. `shrunk`: a file below it or gone, so the baseline is stale. */
export function compare(actual, baseline) {
  return {
    grown: differences({ from: actual, against: baseline, isOff: (now, was) => now > was }).map(
      ({ file, count, other }) => ({ file, now: count, was: other })
    ),
    shrunk: differences({ from: baseline, against: actual, isOff: (was, now) => now < was }).map(
      ({ file, count, other }) => ({ file, now: other, was: count })
    ),
  };
}

/** What to do about a file that is over the limit, written for the agent that reads it as its prompt. */
export function messageFor({ file, now, was }) {
  const status = was ? `was ${was} groups in the baseline` : 'not in the baseline';

  return `${file}: its exports fall into ${now} unconnected groups (${status}; limit ${MAX_COMPONENTS} once a file has ${MIN_EXPORTS} exports). Split it by responsibility: move each group of exports that do not use each other into its own file, named for what it does.`;
}

function writeBaseline({ file, actual }) {
  writeFileSync(
    file,
    `${JSON.stringify(
      {
        about:
          'Files whose exports fall into more groups than G13 allows, with the group count when it was recorded. It may shrink, never grow. Rewrite with npm run cohesion:baseline.',
        findings: sortedByKey(actual),
      },
      null,
      2
    )}\n`
  );
  console.log(`cohesion: wrote ${BASELINE_FILE} (${Object.keys(actual).length} files)`);
}

function fail(code, ...lines) {
  console.error(lines.join('\n'));
  process.exit(code);
}

function scanOrExit() {
  try {
    return scanApplication();
  } catch (error) {
    return fail(2, `cohesion: the run failed, so nothing was checked.\n${error.message}`);
  }
}

/** Writes the baseline for --init and --update; --update refuses to grow it. */
function record({ file, actual, grown }) {
  if (grown.length && !process.argv.includes('--init')) {
    fail(1, 'cohesion: refusing to grow the baseline.', ...grown.map(messageFor));
  }

  writeBaseline({ file, actual });
}

/** Fails when the scan is above the baseline, or below it (the baseline is stale). */
function check({ actual, grown, shrunk }) {
  if (grown.length) {
    fail(
      1,
      `cohesion FAILED: ${grown.length} file(s) above the baseline\n`,
      ...grown.map(messageFor)
    );
  }

  if (shrunk.length) {
    fail(
      1,
      `cohesion FAILED: ${shrunk.length} file(s) are better than the baseline, so it is stale. Record the gain with npm run cohesion:baseline:`,
      ...shrunk.map((s) => `  ${s.file}: ${s.was} -> ${s.now}`)
    );
  }

  console.log(`cohesion: ok (${Object.keys(actual).length} files at their baseline)`);
}

function main() {
  refuseInitOverBaseline({
    gate: 'cohesion',
    root: ROOT,
    baseline: BASELINE_FILE,
    command: 'cohesion:baseline',
  });

  const file = join(ROOT, BASELINE_FILE);
  const hasBaseline = existsSync(file);

  if (!hasBaseline && !process.argv.includes('--init')) {
    fail(
      2,
      `cohesion: ${BASELINE_FILE} is missing. Create it once with: node lint/gates/cohesion.mjs --init`
    );
  }

  const actual = scanOrExit();
  const baseline = hasBaseline ? JSON.parse(readFileSync(file, 'utf8')).findings : {};
  const { grown, shrunk } = compare(actual, baseline);
  const writing = process.argv.includes('--init') || process.argv.includes('--update');

  if (writing) {
    record({ file, actual, grown });
  } else {
    check({ actual, grown, shrunk });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
