#!/usr/bin/env node
/**
 * The Claude Code PostToolUse hook for Edit / Write / MultiEdit (.claude/settings.json): ESLint on the one
 * edited file plus the Oxlint gate, run in parallel, about a second. A finding exits 2, which Claude Code
 * hands back to the agent (the edit has already happened, so this is a prompt to fix it). It never fixes
 * anything, and it fails OPEN: any crash, timeout or missing install exits 0, so it cannot block a session.
 * It only looks at TypeScript and JavaScript inside this checkout. Prettier is left to the pre-commit hook.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '../../..');
const CHECKED = /\.(ts|tsx|js|mjs)$/;
const TIMEOUT_MS = 20_000;
const FINDING_EXIT = 2;
const KIB = 1024;
const BUFFER_MIB = 16;
const MAX_BUFFER = BUFFER_MIB * KIB * KIB;
const ESLINT = join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
const OXLINT_GATE = join(ROOT, 'scripts', 'oxlint-gate.mjs');

/** The path of the edited file in Claude Code's hook JSON, or null. */
export function editedFile(json) {
  try {
    return JSON.parse(json).tool_input?.file_path ?? null;
  } catch {
    return null;
  }
}

const outside = (path) => path.startsWith('..') || path.startsWith('node_modules');

/** The repo-relative path to check, or null when the file is not ours to look at. */
export function scopedPath({ file, root = ROOT }) {
  if (!file || !isAbsolute(file)) {
    return null;
  }

  const path = relative(root, file);

  return !outside(path) && CHECKED.test(path) && existsSync(join(root, path)) ? path : null;
}

/** Runs a node script and resolves with its exit code and output; a run that timed out or could not start counts as clean. */
function run(script, args) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script, ...args],
      { cwd: ROOT, timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER },
      (error, stdout, stderr) => {
        const exited = typeof error?.code === 'number' && !error.killed;

        resolve({ code: exited ? error.code : 0, output: `${stdout}${stderr}` });
      }
    );
  });
}

const frozenRules = (path) => {
  const file = join(ROOT, 'eslint-suppressions.json');

  return existsSync(file) ? Object.keys(JSON.parse(readFileSync(file, 'utf8'))[path] ?? {}) : [];
};

/** ESLint's findings for one file as lines an agent can act on, plus the frozen-file note. */
export function eslintLines({ path, json, frozen }) {
  const messages = JSON.parse(json)[0]?.messages ?? [];
  const lines = messages.map((m) => `  ${path}:${m.line}:${m.column} ${m.ruleId}: ${m.message}`);
  const mixed = messages.some((m) => frozen.includes(m.ruleId));
  const note = mixed
    ? [
        '  This file now has more findings of a rule than it froze. The frozen ones are listed as well; fixing the new one is enough.',
      ]
    : [];

  return [...lines, ...note];
}

async function check(path) {
  const [lint, oxlint] = await Promise.all([
    run(ESLINT, ['-f', 'json', path]),
    run(OXLINT_GATE, []),
  ]);
  const report = [];

  if (lint.code === 1) {
    report.push(
      `ESLint found problems in ${path}:`,
      ...eslintLines({ path, json: lint.output, frozen: frozenRules(path) })
    );
  }

  if (oxlint.code === 1) {
    report.push('Oxlint (no type lies):', oxlint.output.trim());
  }

  return report;
}

async function main() {
  const input = readFileSync(0, 'utf8');
  const path = scopedPath({ file: editedFile(input) });
  const report = path ? await check(path) : [];

  if (report.length) {
    console.error(report.join('\n'));
    process.exit(FINDING_EXIT);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => process.exit(0));
}
