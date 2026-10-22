/**
 * The archlint run behind the architecture gates (G13 cohesion, G14 coupling): one workspace's
 * production code copied to a disposable tree, scanned, and the findings handed back with
 * repo-relative paths. Each gate keeps its own rules, baseline and messages.
 *
 * The copy is how tests and vendored code are left out (archlint 0.17.1 would still count ignored
 * test imports in its graph metrics), and it is the only thing edited: `.js` is stripped from the
 * copy's relative and workspace-alias imports, because archlint follows `./x.js` to `x.ts` but not to
 * `x.tsx`, so every edge into a React file would be missing from the graph.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIB = 1024;
const BUFFER_MIB = 64;
const MAX_BUFFER = BUFFER_MIB * KIB * KIB;

/** How much of an unreadable finding or a failed run's output goes into an error message. */
export const ERROR_TAIL = 400;

/** The repository root. */
export const ROOT = join(fileURLToPath(import.meta.url), '../../..');

/**
 * Workspaces scanned by the gates, each with its own path alias (archlint resolves imports against
 * one package root). `shared/`, the wire contract, is added by the gates that can read it.
 */
export const WORKSPACES = ['client', 'server', 'collector'];

/** Handed to archlint itself: contract files that only declare types (the role of Omer's `*-types.ts`). */
export const ARCHLINT_EXCLUDES = ['**/types.ts'];

/** Files left out of the scan, as paths relative to a workspace's `src/`. */
const SKIPPED_FILE =
  /(?:(^|\/)test\/)|(?:\.(?:test|spec)\.[^/]+$)|(?:test-kit)|(?:\.d\.ts$)|(?:^core\/vendor\/)/;

/** A relative or workspace-alias import specifier that ends in `.js`: `from './x.js'`, `import('@client/y.js')`. */
const JS_SPECIFIER = /(from\s+|import\s*\(\s*|import\s+)(['"])((?:\.{1,2}\/|@\w+\/)[^'"]*?)\.js\2/g;

const ARCHLINT_BIN = fileURLToPath(import.meta.resolve('@archlinter/cli/bin/archlint.js'));

function stripJsExtensions(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);

    if (statSync(path).isDirectory()) {
      stripJsExtensions(path);
    } else if (/\.tsx?$/.test(name)) {
      writeFileSync(path, readFileSync(path, 'utf8').replace(JS_SPECIFIER, '$1$2$3$2'));
    }
  }
}

/** Production files of one workspace copied to a disposable tree. */
function snapshot({ sourceDir, workspace, rules }) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'archlint-')));
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
  stripJsExtensions(join(tmp, 'src'));
  writeFileSync(join(tmp, 'package.json'), '{}');
  // The `lcom` rule is a switch, not a gate: without it archlint resolves no symbol references, and
  // every finding of the others reads wrong. Its own findings are all excluded.
  writeFileSync(
    join(tmp, 'archlint.json'),
    JSON.stringify({
      aliases: { [`@${workspace}/*`]: './src/*' },
      rules: { ...rules, lcom: { exclude: ['**/*'] } },
      tsconfig: false,
    })
  );

  return { tmp, copied };
}

/**
 * archlint's findings for one source directory, each with `files` as `<prefix>/<path under src>`.
 * Throws when the run did not look (nothing to scan, no JSON): never reported as a clean one.
 */
export function archlintSmells({ sourceDir, workspace, prefix, rules }) {
  const { tmp, copied } = snapshot({ sourceDir, workspace, rules });

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
        [...Object.keys(rules), 'lcom'].join(','),
        '--no-cache',
        '--no-git',
        '--json',
        '--quiet',
      ],
      { encoding: 'utf8', maxBuffer: MAX_BUFFER }
    );

    return parseSmells(r, { tmp, prefix });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function parseSmells(result, { tmp, prefix }) {
  let report;

  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `archlint printed no JSON (exit ${result.status}): ${result.stderr.slice(0, ERROR_TAIL)}`
    );
  }

  const inRepo = (text) => text?.replaceAll(`${tmp}/src/`, `${prefix}/`);

  return (report.smells ?? []).map((smell) => ({
    ...smell,
    files: smell.files.map((file) => `${prefix}/${relative(join(tmp, 'src'), file)}`),
    // A finding names its other file only in this text, with the disposable path: give it the repo's.
    locations: (smell.locations ?? []).map((l) => ({ ...l, description: inRepo(l.description) })),
  }));
}

/** One number of an archlint finding, by its metric name: `metric(smell, 'cbo')`. Throws on an unreadable finding. */
export function metric(smell, name) {
  const found = smell.metrics?.map((m) => m[name]).find((v) => typeof v === 'number');

  if (typeof found !== 'number' || !smell.files?.[0]) {
    throw new Error(`unreadable archlint finding: ${JSON.stringify(smell).slice(0, ERROR_TAIL)}`);
  }

  return found;
}

/** archlint's findings across `workspaces` of this repository. */
export function archlintSmellsOf({ workspaces, rules }) {
  return workspaces.flatMap((workspace) =>
    archlintSmells({
      sourceDir: join(ROOT, workspace, 'src'),
      workspace,
      prefix: `${workspace}/src`,
      rules,
    })
  );
}
