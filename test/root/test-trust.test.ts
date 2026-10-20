import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * G00b gate: scripts/test-trust.mjs must fail on each way a test stops proving anything, and pass on
 * a clean tree. The bad examples are written to a temp tree and built from pieces, so this file
 * does not trip the gate it tests.
 */

const SCRIPT = join(new URL('../..', import.meta.url).pathname, 'scripts/test-trust.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'test-trust-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
/** Writes `files` ({ 'dir/name': body }) into a fresh tree and runs the gate over it. */
function gate(files: Record<string, string>) {
  const root = join(scratch, `tree-${n++}`);
  for (const [path, body] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }
  const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const ENV = (name: string) => `process.env.${'T'}${name}`;
const EXPECT = `${'ex'}${'pect'}`;

describe('Feature: the test-trust gate fails a test that proves nothing', () => {
  const failing: [string, string, string, string][] = [
    ['skipIf', 'server/src/a.test.ts', `it.${'skipIf'}(!x)('a', () => {});`, '[skip]'],
    ['only', 'server/src/b.test.ts', `it.${'only'}('a', () => {});`, '[skip]'],
    ['todo', 'server/src/c.test.ts', `it.${'todo'}('a');`, '[skip]'],
    ['xit', 'server/src/d.test.ts', `${'x'}it('a', () => {});`, '[skip]'],
    ['ctx.skip', 'server/src/e.test.ts', `it('a', (ctx) => { ctx.${'skip'}(); });`, '[skip]'],
    ['playwright skip', 'e2e/f.spec.ts', `test.${'skip'}(true, 'x');`, '[skip]'],
    ['CI branch', 'client/src/g.test.ts', `if (process.env.${'CI'}) return;`, '[ci]'],
    [
      'snapshot switch',
      'collector/src/h.test.ts',
      `const u = process.env.${'UPDATE_'}${'SNAPSHOTS'};`,
      '[snapshot]',
    ],
    [
      'env-gated assertion',
      'server/src/i.test.ts',
      `if (${ENV('OKEN')}) ${EXPECT}(x).toBe(1);`,
      '[env]',
    ],
    ['waitForTimeout', 'e2e/j.spec.ts', `await page.${'waitForTimeout'}(300);`, '[sleep]'],
  ];

  it.each(failing)(
    'Scenario: given a %s, when the gate runs, then it exits 1 and names the file and line',
    (_name, file, body, tag) => {
      const r = gate({ [file]: body });
      expect(r.status, r.out).toBe(1);
      expect(r.out).toContain(tag);
      expect(r.out).toContain(`${file}:1`);
    }
  );

  it('Scenario: given a failure, when the gate prints it, then it says what to do instead', () => {
    const r = gate({ 'e2e/k.spec.ts': `await page.${'waitForTimeout'}(1);` });
    expect(r.out).toContain('page.clock');
  });

  it('Scenario: given a snapshot flag on a test command in package.json, then it fails', () => {
    const r = gate({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run -u' } }) });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain('package.json scripts.test [snapshot]');
  });
});

describe('Feature: the test-trust gate leaves honest tests alone', () => {
  it('Scenario: given a clean test, when the gate runs, then it exits 0', () => {
    const r = gate({ 'server/src/ok.test.ts': `it('a', () => { ${EXPECT}(1).toBe(1); });` });
    expect(r.status, r.out).toBe(0);
  });

  it('Scenario: given a promise sleep in a unit test, then it is not flagged (only browser tests)', () => {
    const r = gate({
      'server/src/l.test.ts': `await new Promise((r) => ${'setTimeout'}(r, 5));`,
    });
    expect(r.status, r.out).toBe(0);
  });

  it('Scenario: given test.setTimeout in a browser test, then it is not flagged', () => {
    const r = gate({ 'e2e/m.spec.ts': `test.${'setTimeout'}(60_000);` });
    expect(r.status, r.out).toBe(0);
  });

  it('Scenario: given a bad example under a fixtures folder, then it is not scanned', () => {
    const r = gate({ 'test/fixtures/n.test.ts': `it.${'skip'}('a', () => {});` });
    expect(r.status, r.out).toBe(0);
  });
});

describe('Feature: the test-trust gate has no easy way round it', () => {
  // Found by the tester audit: each of these ran an assertion only sometimes, or slept, and passed.
  it('Scenario: given an early return when an env var is unset, then it fails', () => {
    const r = gate({
      'server/src/o.test.ts': `if (!${ENV('OKEN')}) return;\n${EXPECT}(x).toBe(1);`,
    });
    expect(r.status, r.out).toBe(1);
  });

  it('Scenario: given an env var && assertion, then it fails', () => {
    const r = gate({ 'server/src/p.test.ts': `${ENV('OKEN')} && ${EXPECT}(x).toBe(1);` });
    expect(r.status, r.out).toBe(1);
  });

  it('Scenario: given an env var ? assertion : nothing, then it fails', () => {
    const r = gate({
      'server/src/q.test.ts': `${ENV('OKEN')} ? ${EXPECT}(x).toBe(1) : undefined;`,
    });
    expect(r.status, r.out).toBe(1);
  });

  it('Scenario: given a bare setTimeout sleep in a browser test, then it fails', () => {
    const r = gate({
      'e2e/r.spec.ts': `await new Promise((r) => ${'setTimeout'}(r, 500));`,
    });
    expect(r.status, r.out).toBe(1);
  });

  it('Scenario: given a setTimeout sleep inside page.evaluate, then it fails', () => {
    const r = gate({
      'e2e/s.spec.ts': `await page.evaluate(() => new Promise((r) => ${'setTimeout'}(r, 300)));`,
    });
    expect(r.status, r.out).toBe(1);
  });
});
