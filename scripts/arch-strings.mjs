#!/usr/bin/env node
/**
 * AC 12 (strings half): OpenRig/tmux/Herdr route and command strings may appear only under
 * collector/src/adapters/. Scans source in shared/, server/, client/ and collector/ (not tests'
 * fixtures, not dist, not node_modules). The import-boundary half is dependency-cruiser.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const ALLOWED = 'collector/src/adapters/';
const FORBIDDEN = ['/api/rigs', '/api/ps', 'capture-pane', 'herdr'];
const ROOTS = ['shared/src', 'server/src', 'server/scripts', 'client/src', 'collector/src'];
// Display copy that names the terminal app for the reader. Only the app name is allowed here: the
// route strings and `capture-pane` stay banned. rig-commands.json is generated from the brain.
const COPY_FILES = new Set([
  'client/src/learn/glossary.ts',
  'client/src/v2/pages/learn/rig-commands.json',
  'client/src/v2/pages/wall/index.tsx',
  'client/src/v2/pages/wall/wall.test.tsx',
]);
const COPY_ALLOWED = new Set(['herdr']);
const SKIP = new Set(['node_modules', 'dist']);
const EXT = /\.(ts|tsx|js|mjs|cjs|json)$/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.test(name)) yield p;
  }
}

const hits = [];
for (const r of ROOTS) {
  let files;
  try {
    files = [...walk(join(root, r))];
  } catch {
    continue;
  }
  for (const file of files) {
    const rel = relative(root, file);
    if (rel.startsWith(ALLOWED)) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        for (const s of FORBIDDEN)
          if (COPY_FILES.has(rel) && COPY_ALLOWED.has(s)) continue;
          else if (line.toLowerCase().includes(s)) hits.push(`${rel}:${i + 1}: "${s}"`);
      });
  }
}

if (hits.length) {
  console.error(
    `arch:check strings FAILED — only ${ALLOWED} may contain these:\n${hits.join('\n')}`
  );
  process.exit(1);
}
console.log(`arch:check strings ok (${FORBIDDEN.join(', ')} only under ${ALLOWED})`);
