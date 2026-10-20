#!/usr/bin/env node
/**
 * G00b: tests you can trust. Fails on the ways a test stops proving anything:
 *   skip      a skipped, conditional, todo or focused test (skip, skipIf, runIf, todo, fixme, only)
 *   ci        a test that reads CI, so it behaves differently there
 *   snapshot  a switch that rewrites the expected value, so every change passes
 *   env       an assertion that runs only when an environment variable is set
 *   sleep     a wall-clock sleep in a browser test
 * Scans *.test.* and *.spec.* files. `--root <dir>` points it at another tree (test/root/test-trust.test.ts
 * uses that to prove it fails). Each message says what to do instead.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const rootArg = process.argv.indexOf('--root');
const root = resolve(rootArg > 0 ? process.argv[rootArg + 1] : join(import.meta.dirname, '..'));
const DIRS = ['client/src', 'server/src', 'collector/src', 'shared/src', 'e2e', 'test'];
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'fixtures',
  'test-results',
  'playwright-report',
]);
const TEST_FILE = /\.(test|spec)\.(ts|tsx|mjs|js)$/;

const RULES = [
  {
    id: 'skip',
    re: /\b(?:it|test|describe|suite)(?:\.concurrent)?\.(?:skip|skipIf|runIf|todo|fixme|only|fails)\b|\b(?:xit|xtest|xdescribe)\s*\(|\b(?:ctx|context|task)\.skip\s*\(/,
    why: 'a skipped, conditional or focused test proves nothing where it does not run. Make it run everywhere: put what it needs in test/fixtures, or delete the test.',
  },
  {
    id: 'ci',
    re: /process\.env\.CI\b|env\.CI\b/,
    why: 'a test that reads CI behaves differently in CI. Remove the branch so the same test runs on every machine.',
  },
  {
    id: 'snapshot',
    re: /UPDATE_SNAPSHOTS|UPDATE_FIXTURES|REGENERATE|updateSnapshots\s*:\s*['"](?:all|changed)['"]/,
    why: 'a switch that rewrites the expected value makes any change pass. The test only compares; put the rewrite in a script (npm run snapshots:update).',
  },
  {
    id: 'env',
    re: /\bif\s*\(\s*!*\s*process\.env\.\w+[^)]*\)\s*\{?\s*(?:await\s+)?expect\b/,
    why: 'an assertion that runs only when an environment variable is set does not run when it is not. Set the value in the test and assert unconditionally.',
  },
  {
    id: 'sleep',
    re: /\bwaitForTimeout\s*\(/,
    why: 'a fixed sleep is slow when the page is ready and flaky when it is not. Wait on a locator expectation, expect.poll, or run page.clock forward.',
    only: /(^|\/)e2e\//,
  },
];

function* walk(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (TEST_FILE.test(name)) yield p;
  }
}

const hits = [];
for (const d of DIRS) {
  for (const file of walk(join(root, d))) {
    const rel = relative(root, file);
    const text = readFileSync(file, 'utf8');
    for (const rule of RULES) {
      if (rule.only && !rule.only.test(rel)) continue;
      const g = new RegExp(rule.re.source, 'g');
      for (const m of text.matchAll(g)) {
        const line = text.slice(0, m.index).split('\n').length;
        hits.push(`${rel}:${line} [${rule.id}] ${m[0].trim()}`);
      }
    }
  }
}

// A rewrite flag on a test command in package.json.
try {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};
  for (const [name, cmd] of Object.entries(scripts))
    if (/\b(?:vitest|playwright)\b.*(?:\s-u\b|--update)/.test(cmd))
      hits.push(`package.json scripts.${name} [snapshot] ${cmd}`);
} catch {
  // no package.json in a --root tree
}

if (hits.length) {
  console.error(
    `test-trust FAILED: ${hits.length} finding(s)\n${hits.join('\n')}\n\n` +
      RULES.filter((r) => hits.some((h) => h.includes(`[${r.id}]`)))
        .map((r) => `[${r.id}] ${r.why}`)
        .join('\n')
  );
  process.exit(1);
}
console.log('test-trust ok: no skipped, CI-only, snapshot-rewriting, env-gated or sleeping tests');
