import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSpecIndex, parseSpec, scanSpecs } from './specs.js';
import { enrichRigs } from '../builder.js';
import { specFoldersOf } from '../config.js';
import { DEFAULT_SPEC_FOLDERS, type QueueItem, type RigSummary, type Seat } from '@appydave/shared';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'appyrig-specs-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const write = (file: string, text: string) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
};

describe('parseSpec', () => {
  it('reads name and folds a block-scalar summary', () => {
    expect(parseSpec('version: "0.2"\nname: demo\nsummary: >\n  one two\n  three\n')).toEqual({
      name: 'demo',
      summary: 'one two three',
    });
  });
  it('has no summary when none is written, and is null for non-specs', () => {
    expect(parseSpec('name: demo\n')).toEqual({ name: 'demo', summary: null });
    expect(parseSpec('nothing: here\n')).toBeNull();
    expect(parseSpec(': : not yaml [')).toBeNull();
    expect(parseSpec('')).toBeNull();
  });
  it('redacts secrets and cuts a very long summary', () => {
    const long = parseSpec(`name: x\nsummary: ${'word '.repeat(400)}\n`);
    expect(long!.summary!.length).toBeLessThanOrEqual(600);
  });
});

describe('scanSpecs', () => {
  it('matches on name: not on the folder name, searches subfolders, first folder wins a clash', async () => {
    const a = tmp();
    const b = tmp();
    write(join(a, 'deep', 'team', 'rig.yaml'), 'name: alpha\nsummary: from a\n');
    write(join(b, 'alpha', 'rig.yaml'), 'name: alpha\nsummary: from b\n');
    write(join(b, 'folder-called-x', 'rig.yaml'), 'name: beta\n');
    write(join(b, 'node_modules', 'pkg', 'rig.yaml'), 'name: skipped\n');
    const found = await scanSpecs([a, b, join(b, 'does-not-exist')]);
    expect([...found.keys()].sort()).toEqual(['alpha', 'beta']);
    expect(found.get('alpha')).toEqual({
      path: join(a, 'deep', 'team', 'rig.yaml'),
      summary: 'from a',
    });
    expect(found.get('beta')!.summary).toBeNull();
  });

  it('reuses a scan inside the ttl, and rescans after it', async () => {
    const d = tmp();
    write(join(d, 'rig.yaml'), 'name: one\n');
    let t = 0;
    const index = createSpecIndex([d], 1000, () => t);
    expect((await index()).has('one')).toBe(true);
    write(join(d, 'two', 'rig.yaml'), 'name: two\n');
    t = 500;
    expect((await index()).has('two')).toBe(false);
    t = 1500;
    expect((await index()).has('two')).toBe(true);
  });
});

describe('specFoldersOf', () => {
  it('uses the config file, else the seeded defaults (missing, broken or empty file)', () => {
    const env = { APPYRIG_CONFIG: '/x/config.json' };
    expect(specFoldersOf(env, () => JSON.stringify({ specFolders: ['/a', '/b'] }))).toEqual([
      '/a',
      '/b',
    ]);
    const defaults = [...DEFAULT_SPEC_FOLDERS];
    expect(
      specFoldersOf(env, () => {
        throw new Error('ENOENT');
      })
    ).toEqual(defaults);
    expect(specFoldersOf(env, () => '{ nope')).toEqual(defaults);
    expect(specFoldersOf(env, () => JSON.stringify({ specFolders: [] }))).toEqual(defaults);
  });
});

describe('enrichRigs', () => {
  const rig = (name: string): RigSummary => ({
    id: `id-${name}`,
    name,
    status: 'running',
    lifecycleState: null,
    nodeCount: 1,
    runningCount: 1,
    attentionCount: 0,
  });
  const seat = (id: string, rigName: string, lastActivityAt: string | null) =>
    ({ id, rig: rigName, lastActivityAt }) as Seat;
  const q = (source: string, destination: string, updatedAt: string) =>
    ({ id: 'q', source, destination, updatedAt }) as QueueItem;

  it('recentAt is the newest seat activity or queue event touching the rig, else null', () => {
    const out = enrichRigs(
      [rig('a'), rig('b'), rig('c')],
      [seat('s@a', 'a', '2026-10-11T10:00:00.000Z'), seat('s@b', 'b', null)],
      [
        q('x@elsewhere', 's@a', '2026-10-11T11:00:00.000Z'),
        q('s@b', 'y', '2026-10-11T09:00:00.000Z'),
      ],
      undefined
    );
    expect(out.map((r) => r.recentAt)).toEqual([
      '2026-10-11T11:00:00.000Z',
      '2026-10-11T09:00:00.000Z',
      null,
    ]);
  });

  it('no spec scan → the spec fields are left out, never "not-found"', () => {
    const [r] = enrichRigs([rig('a')], [], [], undefined);
    expect(r).not.toHaveProperty('specStatus');
    expect(r).not.toHaveProperty('summary');
  });

  it('a scan that finds one rig and not another says so for each', () => {
    const specs = new Map([['a', { path: '/p/rig.yaml', summary: 'about a' }]]);
    const [a, b] = enrichRigs([rig('a'), rig('b')], [], [], specs);
    expect(a).toMatchObject({ specStatus: 'found', specPath: '/p/rig.yaml', summary: 'about a' });
    expect(b).toMatchObject({ specStatus: 'not-found', specPath: null, summary: null });
  });
});
