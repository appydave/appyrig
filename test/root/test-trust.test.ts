import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * G00b gate: scripts/test-trust.mjs must fail on each way a test stops proving anything, and pass on
 * a clean tree. The bad examples are written to a temp tree (and built from pieces, so this file
 * does not trip the gate it tests).
 */

const SCRIPT = join(new URL('../..', import.meta.url).pathname, 'scripts/test-trust.mjs');
const scratch = mkdtempSync(join(tmpdir(), 'test-trust-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(name: string, dir: string, file: string, body: string) {
  const root = join(scratch, name);
  mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, dir, file), body);
  const r = spawnSync('node', [SCRIPT, '--root', root], { encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const bad: [string, string, string, string, string][] = [
  ['skip', 'server/src', 'a.test.ts', `it.${'skipIf'}(!x)('a', () => {});`, '[skip]'],
  ['only', 'server/src', 'b.test.ts', `it.${'only'}('a', () => {});`, '[skip]'],
  ['todo', 'server/src', 'c.test.ts', `it.${'todo'}('a');`, '[skip]'],
  ['ci', 'client/src', 'd.test.ts', `if (process.env.${'CI'}) return;`, '[ci]'],
  [
    'snapshot',
    'collector/src',
    'e.test.ts',
    `const u = process.env.${'UPDATE_'}${'SNAPSHOTS'};`,
    '[snapshot]',
  ],
  [
    'env',
    'server/src',
    'f.test.ts',
    `if (process.env.TOKEN) ${'ex'}${'pect'}(x).toBe(1);`,
    '[env]',
  ],
  ['sleep', 'e2e', 'g.spec.ts', `await page.${'waitForTimeout'}(300);`, '[sleep]'],
];

describe('test-trust gate', () => {
  it.each(bad)('fails on a %s example and says what to do', (name, dir, file, body, tag) => {
    const r = run(name, dir, file, body);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(tag);
    expect(r.out).toContain(`${dir}/${file}:1`);
  });

  it('passes on a clean tree', () => {
    const r = run('clean', 'server/src', 'ok.test.ts', `it('a', () => { expect(1).toBe(1); });`);
    expect(r.status, r.out).toBe(0);
  });

  it('does not flag a sleep outside e2e', () => {
    const r = run(
      'unit-sleep',
      'server/src',
      'h.test.ts',
      `await new Promise((r) => setTimeout(r, 5));`
    );
    expect(r.status, r.out).toBe(0);
  });
});
