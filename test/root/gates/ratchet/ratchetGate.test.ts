import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The ratchet coupling and scores share, run as those gates run: its own process, judged by exit
 * code. The baseline lives in a temp folder, so the repo's own are never read or written.
 */

const REPO = join(import.meta.dirname, '../../../..');
const dirs: string[] = [];

afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function gate(scan: string, baseline: Record<string, Record<string, number>>) {
  const dir = mkdtempSync(join(tmpdir(), 'ratchet-'));
  const file = join(dir, 'probe-baseline.json');

  dirs.push(dir);
  writeFileSync(file, JSON.stringify({ about: 'probe', ...baseline }));

  const script = `
    import { runRatchetGate } from ${JSON.stringify(join(REPO, 'lint/gates/ratchet-gate.mjs'))};
    runRatchetGate({
      gate: 'probe',
      baselineFile: ${JSON.stringify(relative(REPO, file))},
      command: 'probe:baseline',
      about: 'probe',
      scan: () => ${scan},
      sections: { rule: (g) => g.file + ' went from ' + g.was + ' to ' + g.now },
    });`;

  return spawnSync('node', ['--input-type=module', '-e', script], {
    cwd: REPO,
    encoding: 'utf8',
  });
}

describe('Feature: the ratchet', () => {
  it('Scenario: given a finding above its baseline, then the gate fails and names it', () => {
    const run = gate(`({ rule: { 'a.ts': 3 } })`, { rule: { 'a.ts': 2 } });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('probe FAILED: 1 finding(s) above the baseline');
    expect(run.stderr).toContain('a.ts went from 2 to 3');
  });

  it('Scenario: given findings at their baseline, then the gate passes', () => {
    expect(gate(`({ rule: { 'a.ts': 2 } })`, { rule: { 'a.ts': 2 } }).status).toBe(0);
  });

  it('Scenario: given a finding below its baseline, then the gate fails as stale', () => {
    const run = gate(`({ rule: { 'a.ts': 1 } })`, { rule: { 'a.ts': 2 } });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('so it is stale');
  });

  it('Scenario: given a scan that throws, then it exits 2 and is not reported clean', () => {
    const run = gate(`(() => { throw new Error('no scan'); })()`, { rule: {} });

    expect(run.status).toBe(2);
  });
});
