import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RIG_FILES_CHUNK_BYTES, RIG_FILE_MAX_BYTES, type RigFile } from '@appydave/shared';
import { candidatesFor, chunkRigFiles, readRigFiles, RigFilesReader } from './rigfiles.js';
import type { SpecInfo } from './specs.js';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'appyrig-rf-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const put = (path: string, text = 'x\n') => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

/** root/ mission/ team/rig.yaml — the appyrig-v1.4 shape. */
function layout() {
  const root = tmp();
  const mission = join(root, 'proj');
  const team = join(mission, 'team');
  put(join(team, 'rig.yaml'), 'name: demo\nsummary: s\n');
  const spec: SpecInfo = { path: join(team, 'rig.yaml'), root, summary: 's' };
  return { root, mission, team, spec };
}
const ids = async (spec: SpecInfo) => (await candidatesFor(spec)).map((c) => c.id);

describe('which files may be read (the boundary)', () => {
  it('rig.yaml and the allowed names in the spec folder and its mission folder, nothing else', async () => {
    const { mission, team, spec } = layout();
    for (const n of [
      'MISSION.md',
      'CULTURE.md',
      'LEARNED.md',
      'LEARNED-dev-ui.md',
      'notes.md',
      'secrets.md',
      'brief.md.bak',
      'brief.txt',
    ])
      put(join(team, n));
    for (const n of [
      'brief.md',
      'REPORT.md',
      'DEBRIEF.md',
      'MISSION.md',
      'rig.yaml',
      'other.yaml',
      'package.json',
    ])
      put(join(mission, n));
    expect(await ids(spec)).toEqual([
      'spec:CULTURE.md',
      'spec:LEARNED-dev-ui.md',
      'spec:LEARNED.md',
      'spec:MISSION.md',
      'spec:rig.yaml',
      'mission:DEBRIEF.md',
      'mission:MISSION.md',
      'mission:REPORT.md',
      'mission:brief.md',
    ]);
    // rig.yaml in the MISSION folder is another rig's spec, not this one's: not offered
    expect(await ids(spec)).not.toContain('mission:rig.yaml');
  });

  it('other extensions are refused even when the name looks right', async () => {
    const { team, spec } = layout();
    put(join(team, 'LEARNED.txt'));
    put(join(team, 'LEARNED.md.sh'));
    put(join(team, 'CULTURE.markdown'));
    put(join(team, 'MISSION.MD'));
    expect(await ids(spec)).toEqual(['spec:rig.yaml']);
  });

  it('a symlink to a file OUTSIDE the configured folder is refused', async () => {
    const { team, spec } = layout();
    const outside = tmp();
    put(join(outside, 'passwd.md'), 'root:x:0:0\n');
    symlinkSync(join(outside, 'passwd.md'), join(team, 'MISSION.md'));
    expect(await ids(spec)).toEqual(['spec:rig.yaml']);
    const files = await readRigFiles(spec);
    expect(JSON.stringify(files)).not.toContain('root:x');
  });

  it('a symlink to a file INSIDE the configured folder is fine (and read by its real path)', async () => {
    const { root, team, spec } = layout();
    put(join(root, 'shared', 'CULTURE-real.md'), 'inside\n');
    symlinkSync(join(root, 'shared', 'CULTURE-real.md'), join(team, 'CULTURE.md'));
    expect(await ids(spec)).toContain('spec:CULTURE.md');
    expect((await readRigFiles(spec)).find((f) => f.name === 'CULTURE.md')?.content).toBe(
      'inside\n'
    );
  });

  it('a symlinked spec or mission FOLDER that leads out of the configured folder yields nothing', async () => {
    const root = tmp();
    const outside = tmp();
    put(join(outside, 'team', 'rig.yaml'), 'name: x\n');
    put(join(outside, 'team', 'MISSION.md'), 'secret plans\n');
    symlinkSync(outside, join(root, 'linked'));
    const spec: SpecInfo = { path: join(root, 'linked', 'team', 'rig.yaml'), root, summary: null };
    expect(await candidatesFor(spec)).toEqual([]);
  });

  it('the mission folder stops at the configured folder: nothing above it is offered', async () => {
    const outer = tmp();
    put(join(outer, 'MISSION.md'), 'above the root\n');
    const root = join(outer, 'specs');
    put(join(root, 'demo', 'rig.yaml'), 'name: demo\n');
    const spec: SpecInfo = { path: join(root, 'demo', 'rig.yaml'), root, summary: null };
    // parent of the spec folder is the root itself (allowed); the root's parent (outer) never is
    expect(await ids(spec)).toEqual(['spec:rig.yaml']);
    const rootLevel: SpecInfo = { path: join(root, 'rig.yaml'), root, summary: null };
    put(join(root, 'rig.yaml'), 'name: top\n');
    expect(await ids(rootLevel)).toEqual(['spec:rig.yaml']); // spec folder == root; its parent is above the root
  });

  it('a directory named like an allowed file, a broken link and a missing spec are skipped quietly', async () => {
    const { root, team, spec } = layout();
    mkdirSync(join(team, 'MISSION.md'));
    symlinkSync(join(root, 'nowhere.md'), join(team, 'CULTURE.md'));
    expect(await ids(spec)).toEqual(['spec:rig.yaml']);
    expect(
      await candidatesFor({ path: join(root, 'gone', 'rig.yaml'), root, summary: null })
    ).toEqual([]);
  });
});

describe('reading', () => {
  it('caps at 256 KB with a truncated flag, redacts, and skips binary', async () => {
    const { team, spec } = layout();
    put(join(team, 'MISSION.md'), `${'z'.repeat(RIG_FILE_MAX_BYTES)}${'y'.repeat(500)}`);
    put(join(team, 'CULTURE.md'), 'token: sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX\nfine\n');
    put(join(team, 'brief.md'), 'bin\u0000ary');
    const files = await readRigFiles(spec);
    const mission = files.find((f) => f.name === 'MISSION.md')!;
    expect(mission.truncated).toBe(true);
    expect(mission.bytes).toBe(RIG_FILE_MAX_BYTES + 500);
    expect(mission.content.length).toBe(RIG_FILE_MAX_BYTES);
    const culture = files.find((f) => f.name === 'CULTURE.md')!;
    expect(culture.content).not.toContain('sk-ant');
    expect(culture.content).toContain('fine');
    expect(files.some((f) => f.name === 'brief.md')).toBe(false);
    expect(files.find((f) => f.name === 'rig.yaml')!.truncated).toBe(false);
  });
});

describe('chunking and change detection', () => {
  const file = (n: number): RigFile => ({
    id: `spec:f${n}.md`,
    name: `f${n}.md`,
    scope: 'spec',
    bytes: 1,
    modifiedAt: '2026-10-11T12:00:00.000Z',
    truncated: false,
    content: 'x'.repeat(RIG_FILE_MAX_BYTES),
  });
  it('splits into messages under the chunk size; only the first replaces', () => {
    const pushes = chunkRigFiles(
      'm2',
      'demo',
      [1, 2, 3, 4, 5].map(file),
      '2026-10-11T12:00:00.000Z'
    );
    expect(pushes.length).toBeGreaterThan(1);
    expect(pushes.map((p) => p.replace)).toEqual(pushes.map((_, i) => i === 0));
    for (const p of pushes)
      expect(p.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0)).toBeLessThanOrEqual(
        RIG_FILES_CHUNK_BYTES
      );
    expect(pushes.flatMap((p) => p.files)).toHaveLength(5);
  });

  it('sends a rig once, again only when a file changed, and again after reset()', async () => {
    const { team, spec } = layout();
    let t = 10_000;
    const r = new RigFilesReader('m2', () => new Date(t), 1000);
    const specs = new Map([['demo', spec]]);
    const first = await r.next(specs);
    expect(first?.pushes[0]?.files.map((f) => f.id)).toEqual(['spec:rig.yaml']);
    // not accepted yet: asks again after the ttl
    t += 2000;
    expect(await r.next(specs)).not.toBeNull();
    first!.markSent();
    t += 2000;
    expect(await r.next(specs)).toBeNull();
    // a file changes
    put(join(team, 'MISSION.md'), 'new\n');
    utimesSync(join(team, 'MISSION.md'), new Date(), new Date(Date.now() + 5000));
    t += 2000;
    const changed = await r.next(specs);
    expect(changed?.pushes[0]?.files.map((f) => f.id)).toEqual([
      'spec:MISSION.md',
      'spec:rig.yaml',
    ]);
    changed!.markSent();
    t += 2000;
    expect(await r.next(specs)).toBeNull();
    r.reset();
    expect(await r.next(specs)).not.toBeNull();
  });

  it('does not rescan inside the ttl', async () => {
    const { spec } = layout();
    let t = 100_000;
    const r = new RigFilesReader('m2', () => new Date(t), 60_000);
    expect(await r.next(new Map([['demo', spec]]))).not.toBeNull();
    expect(await r.next(new Map([['demo', spec]]))).toBeNull();
  });
});
