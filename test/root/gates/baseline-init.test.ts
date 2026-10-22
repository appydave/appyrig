import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(import.meta.dirname, '../../..');
const GATES = [
  {
    script: 'scripts/oxlint-gate.mjs',
    baseline: 'oxlint-baseline.json',
    command: 'oxlint:baseline',
  },
  {
    script: 'lint/folder-limits.mjs',
    baseline: 'folder-baseline.json',
    command: 'folders:baseline',
  },
  { script: 'lint/knip-gate.mjs', baseline: 'knip-baseline.json', command: 'knip:baseline' },
];

describe('--init on a baseline that already exists', () => {
  it.each(GATES)(
    '$script refuses and leaves $baseline as it was',
    ({ script, baseline, command }) => {
      const before = readFileSync(join(REPO, baseline), 'utf8');
      const result = spawnSync('node', [script, '--init'], { cwd: REPO, encoding: 'utf8' });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`${baseline} exists: use \`npm run ${command}\``);
      expect(readFileSync(join(REPO, baseline), 'utf8')).toBe(before);
    }
  );
});

describe('--init with no baseline yet', () => {
  it('folder-limits creates it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'folder-init-'));
    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });

    mkdirSync(join(dir, 'lint/gates'), { recursive: true });
    mkdirSync(join(dir, 'shared/src'), { recursive: true });
    cpSync(join(REPO, 'lint/folder-limits.mjs'), join(dir, 'lint/folder-limits.mjs'));
    cpSync(join(REPO, 'lint/gates/init-guard.mjs'), join(dir, 'lint/gates/init-guard.mjs'));
    cpSync(join(REPO, 'lint/sorted.mjs'), join(dir, 'lint/sorted.mjs'));
    writeFileSync(join(dir, 'shared/src/a.ts'), '');
    run('git', ['init', '-q']);

    const result = run('node', ['lint/folder-limits.mjs', '--init']);

    expect(result.status).toBe(0);
    expect(existsSync(join(dir, 'folder-baseline.json'))).toBe(true);
  });
});
