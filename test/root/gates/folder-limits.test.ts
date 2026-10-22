import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs gate with no type declarations
import { compare, folderSizes, messageFor, oversize } from '../../../lint/folder-limits.mjs';

const REPO = join(import.meta.dirname, '../../..');
const names = (folder: string, n: number, ext = 'ts') =>
  Array.from({ length: n }, (_, i) => `${folder}/f${i}.${ext}`);

describe('folder sizes', () => {
  it('counts direct files and direct subfolders, not descendants', () => {
    const sizes = folderSizes([...names('client/src', 2), ...names('client/src/a/b', 3)]);

    expect(sizes['client/src']).toEqual({ files: 2, subfolders: 1 });
    expect(sizes['client/src/a']).toEqual({ files: 0, subfolders: 1 });
    expect(sizes['client/src/a/b']).toEqual({ files: 3, subfolders: 0 });
  });

  it('leaves out vendored and recorded files', () => {
    const sizes = folderSizes([...names('test/fixtures', 40), ...names('shared/src', 1)]);

    expect(Object.keys(sizes)).toEqual(['shared/src']);
  });

  it('flags the eleventh file, not the tenth', () => {
    const tenth = oversize(folderSizes(names('shared/src', 10)));
    const eleventh = oversize(folderSizes(names('shared/src', 11)));

    expect(tenth).toEqual({});
    expect(eleventh).toEqual({ 'shared/src': { files: 11 } });
  });

  it('flags a folder with eleven subfolders', () => {
    const files = Array.from({ length: 11 }, (_, i) => `shared/src/d${i}/index.ts`);

    expect(oversize(folderSizes(files))).toEqual({ 'shared/src': { subfolders: 11 } });
  });
});

describe('baseline comparison', () => {
  const baseline = { 'shared/src': { files: 21 } };

  it('passes when nothing grew', () => {
    expect(compare(baseline, baseline)).toEqual({ grown: [], shrunk: [] });
  });

  it('fails a baselined folder that gains a file, and a new oversize folder', () => {
    const actual = { 'shared/src': { files: 22 }, 'server/src/hub': { files: 11 } };

    expect(compare(actual, baseline).grown.map((g: { folder: string }) => g.folder)).toEqual([
      'shared/src',
      'server/src/hub',
    ]);
  });

  it('asks for a baseline update when a folder shrank', () => {
    expect(compare({ 'shared/src': { files: 15 } }, baseline).shrunk).toHaveLength(1);
  });

  it('tells the agent what to do instead', () => {
    expect(messageFor({ folder: 'shared/src', kind: 'files', now: 22 })).toBe(
      'shared/src has 22 direct files; maximum is 10. Split it into subfolders by feature.'
    );
  });
});

describe('the gate on a real tree', () => {
  it('fails a repo where a tracked folder is pushed past its limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'folder-gate-'));
    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' });

    mkdirSync(join(dir, 'lint'));
    mkdirSync(join(dir, 'shared/src'), { recursive: true });
    cpSync(join(REPO, 'lint/folder-limits.mjs'), join(dir, 'lint/folder-limits.mjs'));
    cpSync(join(REPO, 'lint/sorted.mjs'), join(dir, 'lint/sorted.mjs'));
    writeFileSync(join(dir, 'folder-baseline.json'), '{"folders":{}}');
    run('git', ['init', '-q']);
    for (const f of names('shared/src', 11)) {
      writeFileSync(join(dir, f), '');
    }

    const result = run('node', ['lint/folder-limits.mjs']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('shared/src has 11 direct files; maximum is 10.');
  });
});
