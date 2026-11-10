#!/usr/bin/env node
/**
 * G11b: parent/child folder cycles. `arch:folders` (dependency-cruiser's folder scope) drops an edge
 * between a folder and one of its own subfolders, so a child that imports its parent while the parent
 * imports the child is never reported. This builds the folder-to-folder import edges from the same
 * depcruise run (.dependency-cruiser-folders.cjs: runtime code only, no tests, no type-only or dynamic
 * imports) and reports every ancestor/descendant pair that imports both ways.
 *
 *   npm run arch:parent-cycles           fail on a cycle not in parent-cycles-baseline.json, or one that is gone
 *   npm run arch:parent-cycles:baseline  rewrite the baseline; refuses if it would grow
 *
 * Exit codes are the ratchet's (ratchet-gate.mjs).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ERROR_TAIL, ROOT } from './archlint-scan.mjs';
import { runRatchetGate } from './ratchet-gate.mjs';

const DIRS = ['shared/src', 'server/src', 'client/src', 'collector/src'];
const SRC = /^(client|server|collector|shared)\/src\//;
const MAX_BUFFER = 64 * 1024 * 1024;

const folderOf = (file) => file.slice(0, file.lastIndexOf('/'));

/** `{ 'parent <-> child': 1 }` for each folder pair where one is inside the other and each imports the other. */
export function parentCycles(modules) {
  const edges = new Set();

  for (const { source, dependencies } of modules) {
    for (const { resolved, dynamic } of dependencies) {
      const [from, to] = [folderOf(source), folderOf(resolved)];

      if (!dynamic && SRC.test(resolved) && from !== to) {
        edges.add(`${from} -> ${to}`);
      }
    }
  }

  const cycles = [...edges]
    .map((edge) => edge.split(' -> '))
    .filter(([from, to]) => to.startsWith(`${from}/`) && edges.has(`${to} -> ${from}`));

  return Object.fromEntries(cycles.map(([parent, child]) => [`${parent} <-> ${child}`, 1]));
}

function scan() {
  const run = spawnSync(
    'npx',
    ['depcruise', ...DIRS, '--config', '.dependency-cruiser-folders.cjs', '--output-type', 'json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: MAX_BUFFER }
  );

  try {
    return { cycles: parentCycles(JSON.parse(run.stdout).modules) };
  } catch {
    throw new Error(
      `depcruise printed no JSON (exit ${run.status}): ${run.stderr.slice(0, ERROR_TAIL)}`
    );
  }
}

/** What to do about a new parent/child cycle, written for the agent that reads it as its prompt. */
export function cycleMessage({ file: pair }) {
  const [parent, child] = pair.split(' <-> ');

  return `${parent} and its subfolder ${child} import each other. A subfolder must not import its parent: move what ${child} needs from ${parent} into ${child} (or a folder both import), so the dependency runs one way.`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRatchetGate({
    gate: 'parent-cycles',
    baselineFile: 'parent-cycles-baseline.json',
    command: 'arch:parent-cycles:baseline',
    about:
      'G11b: folders that import one of their own subfolders while it imports them back, recorded when the gate was added (10 Nov). It may shrink, never grow. Rewrite with npm run arch:parent-cycles:baseline.',
    scan,
    sections: { cycles: cycleMessage },
  });
}
