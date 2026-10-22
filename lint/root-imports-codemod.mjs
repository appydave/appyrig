#!/usr/bin/env node
/**
 * G10: rewrites every `../` import to the project alias that names the same file (tsconfig.json
 * `paths`: @client, @server, @collector, @shared for each workspace's src/, @root for the repo root).
 * Purely mechanical: only the text inside the quotes changes, and a `../` that has no alias (for
 * example one workspace reaching into another's src) is left and reported.
 *
 *   node lint/root-imports-codemod.mjs          rewrite the files
 *   node lint/root-imports-codemod.mjs --check  list what would change, write nothing
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../..');
const KIB = 1024;
const BUFFER_MIB = 16;
const MAX_BUFFER = BUFFER_MIB * KIB * KIB;
const WORKSPACES = ['client', 'server', 'collector', 'shared'];
const SOURCE = /\.(ts|tsx|js|mjs|cjs|mts)$/;
const NOT_SCANNED = ['test/fixtures/', 'test/root/fixtures/', 'server/src/core/vendor/'];
/** `from '..'`, `import('..')`, `import '..'`, `require('..')`: the quoted specifier is group 2. */
const SPECIFIER = /\b(from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)(['"])(\.\.\/[^'"\n]*)\2/g;

/** The workspace whose src/ holds this repo-relative path, or null. */
export function workspaceOf(path) {
  return WORKSPACES.find((w) => path.startsWith(`${w}/src/`)) ?? null;
}

const inWorkspace = (path) => WORKSPACES.some((w) => path.startsWith(`${w}/`));

/** Both ends live at the repo root (scripts, test, e2e, lint, bin), outside every workspace. */
const rootLevel = ({ importer, target }) =>
  !inWorkspace(importer) && !inWorkspace(target) && !target.startsWith('..');

/** Which aliases a file may use: its own workspace's, or (outside any workspace) all of them. */
function aliasFor({ importer, target }) {
  const owner = workspaceOf(importer);
  const home = workspaceOf(target);

  if (home && (!owner || owner === home)) {
    return `@${home}/${target.slice(`${home}/src/`.length)}`;
  }

  return rootLevel({ importer, target }) ? `@root/${target}` : null;
}

/** The new specifier for `spec` written in `importer` (repo-relative), or null when no alias fits. */
export function rewrite({ importer, spec }) {
  const target = relative(ROOT, resolve(ROOT, dirname(importer), spec));

  return aliasFor({ importer, target });
}

/** Rewritten text, plus the specifiers left alone. */
export function convert({ importer, text }) {
  const left = [];
  const out = text.replace(SPECIFIER, (...match) => {
    const [whole, lead, quote, spec] = match;
    const alias = rewrite({ importer, spec });

    if (!alias) {
      left.push(spec);

      return whole;
    }

    return `${lead}${quote}${alias}${quote}`;
  });

  return { out, left };
}

function trackedSources() {
  const r = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });

  return r.stdout
    .split('\n')
    .filter((f) => SOURCE.test(f) && !NOT_SCANNED.some((p) => f.startsWith(p)));
}

function main() {
  const check = process.argv.includes('--check');
  let changed = 0;
  const leftovers = [];

  for (const importer of trackedSources()) {
    const text = readFileSync(join(ROOT, importer), 'utf8');
    const { out, left } = convert({ importer, text });

    leftovers.push(...left.map((spec) => `${importer}: ${spec}`));

    if (out !== text) {
      changed += 1;
      if (!check) {
        writeFileSync(join(ROOT, importer), out);
      }
    }
  }

  console.log(`${check ? 'would change' : 'changed'} ${changed} files; left ${leftovers.length}`);
  leftovers.forEach((l) => console.log(`  left: ${l}`));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
