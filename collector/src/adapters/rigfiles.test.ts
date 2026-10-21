import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RIG_FILES_CHUNK_BYTES,
  RIG_FILE_MAX_BYTES,
  RigFilesPushSchema,
  type RigFile,
} from '@appydave/shared';
import {
  candidatesFor,
  chunkRigFiles,
  readRigFiles,
  RigFilesReader,
  RIG_FILES_TICK_BYTES,
  specCandidatesFor,
  specNamedPaths,
} from './rigfiles.js';
import { parseSpec, type SpecInfo } from './specs.js';

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
  const spec: SpecInfo = { path: join(team, 'rig.yaml'), root, summary: 's', spec: null };

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
    ]) {
      put(join(team, n));
    }
    for (const n of [
      'brief.md',
      'REPORT.md',
      'DEBRIEF.md',
      'MISSION.md',
      'rig.yaml',
      'other.yaml',
      'package.json',
    ]) {
      put(join(mission, n));
    }
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
    const spec: SpecInfo = {
      path: join(root, 'linked', 'team', 'rig.yaml'),
      root,
      summary: null,
      spec: null,
    };
    expect(await candidatesFor(spec)).toEqual([]);
  });

  it('the mission folder stops at the configured folder: nothing above it is offered', async () => {
    const outer = tmp();
    put(join(outer, 'MISSION.md'), 'above the root\n');
    const root = join(outer, 'specs');
    put(join(root, 'demo', 'rig.yaml'), 'name: demo\n');
    const spec: SpecInfo = {
      path: join(root, 'demo', 'rig.yaml'),
      root,
      summary: null,
      spec: null,
    };
    // parent of the spec folder is the root itself (allowed); the root's parent (outer) never is
    expect(await ids(spec)).toEqual(['spec:rig.yaml']);
    const rootLevel: SpecInfo = { path: join(root, 'rig.yaml'), root, summary: null, spec: null };
    put(join(root, 'rig.yaml'), 'name: top\n');
    expect(await ids(rootLevel)).toEqual(['spec:rig.yaml']); // spec folder == root; its parent is above the root
  });

  it('a directory named like an allowed file, a broken link and a missing spec are skipped quietly', async () => {
    const { root, team, spec } = layout();
    mkdirSync(join(team, 'MISSION.md'));
    symlinkSync(join(root, 'nowhere.md'), join(team, 'CULTURE.md'));
    expect(await ids(spec)).toEqual(['spec:rig.yaml']);
    expect(
      await candidatesFor({ path: join(root, 'gone', 'rig.yaml'), root, summary: null, spec: null })
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
      { machineId: 'm2', rig: 'demo' },
      [1, 2, 3, 4, 5].map(file),
      '2026-10-11T12:00:00.000Z'
    );
    expect(pushes.length).toBeGreaterThan(1);
    expect(pushes.map((p) => p.replace)).toEqual(pushes.map((_, i) => i === 0));
    for (const p of pushes) {
      expect(p.files.reduce((n, f) => n + Buffer.byteLength(f.content), 0)).toBeLessThanOrEqual(
        RIG_FILES_CHUNK_BYTES
      );
    }
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

  it('QA D1: every changed rig goes out in ONE scan, not one per interval (a reconnect fills the viewer at once)', async () => {
    const root = tmp();
    const specs = new Map<string, SpecInfo>();
    for (let i = 0; i < 9; i++) {
      put(join(root, `rig${i}`, 'rig.yaml'), `name: rig${i}\n`);
      put(join(root, `rig${i}`, 'CULTURE.md'), `culture ${i}\n`);
      specs.set(`rig${i}`, {
        path: join(root, `rig${i}`, 'rig.yaml'),
        root,
        summary: null,
        spec: null,
      });
    }
    let t = 100_000;
    const r = new RigFilesReader('m2', () => new Date(t), 30_000);
    const first = await r.next(specs);
    expect(new Set(first!.pushes.map((p) => p.rig)).size).toBe(9);
    expect(first!.pushes.filter((p) => p.replace)).toHaveLength(9); // each rig starts with a replace
    first!.markSent();
    t += 31_000;
    expect(await r.next(specs)).toBeNull(); // all sent; nothing left
    // a reconnect asks again at once, for all 9
    r.reset();
    expect(new Set((await r.next(specs))!.pushes.map((p) => p.rig)).size).toBe(9);
  });

  it('QA D1: a tick is bounded by bytes; the rest follows on the next call WITHOUT waiting the rescan interval', async () => {
    const root = tmp();
    const specs = new Map<string, SpecInfo>();
    for (let i = 0; i < 20; i++) {
      put(join(root, `big${i}`, 'rig.yaml'), `name: big${i}\n`);
      put(join(root, `big${i}`, 'MISSION.md'), 'x'.repeat(RIG_FILE_MAX_BYTES - 100));
      specs.set(`big${i}`, {
        path: join(root, `big${i}`, 'rig.yaml'),
        root,
        summary: null,
        spec: null,
      });
    }
    const t = 100_000;
    const r = new RigFilesReader('m2', () => new Date(t), 30_000); // the clock never moves
    const sentRigs = new Set<string>();
    let ticks = 0;
    for (; ticks < 10; ticks++) {
      const p = await r.next(specs);
      if (!p) {
        break;
      }
      const bytes = p.pushes.reduce(
        (n, x) => n + x.files.reduce((m, f) => m + Buffer.byteLength(f.content), 0),
        0
      );
      expect(bytes).toBeLessThanOrEqual(RIG_FILES_TICK_BYTES + RIG_FILE_MAX_BYTES + 1000);
      p.pushes.filter((x) => x.replace).forEach((x) => sentRigs.add(x.rig));
      p.markSent();
    }
    expect(sentRigs.size).toBe(20); // all of them…
    expect(ticks).toBeGreaterThan(1); // …over more than one tick…
    expect(ticks).toBeLessThan(10); // …and not one rig per tick
  });

  it('does not rescan inside the ttl', async () => {
    const { spec } = layout();
    let t = 100_000;
    const r = new RigFilesReader('m2', () => new Date(t), 60_000);
    expect(await r.next(new Map([['demo', spec]]))).not.toBeNull();
    expect(await r.next(new Map([['demo', spec]]))).toBeNull();
  });
});

describe('run card R3: variant specs, batch briefs, and the cap', () => {
  /** The ylo-thumbs shape: one folder, the base rig's rig.yaml and the D10 run's rig-d10.yaml. */
  function thumbs() {
    const root = tmp();
    const dir = join(root, 'rigs', 'ylo-thumbs');
    put(join(dir, 'rig.yaml'), 'name: ylo-thumbs\n');
    put(join(dir, 'rig-d10.yaml'), 'name: ylo-d10\n');
    for (const n of [
      'MISSION.md',
      'MISSION-d08.md',
      'MISSION-d10.md',
      'MISSION-d10-change-01-openrig-focus.md',
      'REPORT-d10.md',
      'CULTURE.md',
      'LEARNED-lead.md',
      'secrets.md',
    ]) {
      put(join(dir, n));
    }

    return {
      d10: { path: join(dir, 'rig-d10.yaml'), root, summary: null, spec: null } as SpecInfo,
      base: { path: join(dir, 'rig.yaml'), root, summary: null, spec: null } as SpecInfo,
    };
  }

  it("a variant spec gets its own yaml and its own MISSION-/REPORT- files, never the base run's", async () => {
    expect(await ids(thumbs().d10)).toEqual([
      'spec:CULTURE.md',
      'spec:LEARNED-lead.md',
      'spec:MISSION-d10-change-01-openrig-focus.md',
      'spec:MISSION-d10.md',
      'spec:REPORT-d10.md',
      'spec:rig-d10.yaml',
    ]);
  });

  it("the base spec keeps its own docs and leaves out a sibling variant's", async () => {
    expect(await ids(thumbs().base)).toEqual([
      'spec:CULTURE.md',
      'spec:LEARNED-lead.md',
      'spec:MISSION-d08.md',
      'spec:MISSION.md',
      'spec:rig.yaml',
    ]);
  });

  it('batch briefs are offered in both folders; other .md names still are not', async () => {
    const { mission, team, spec } = layout();
    put(join(mission, 'views-brief.md'));
    put(join(mission, 'run-card-brief.md'));
    put(join(team, 'fix-first-brief.md'));
    put(join(mission, 'qa-verdict-x.md'));
    put(join(mission, 'brief-notes.md'));
    expect(await ids(spec)).toEqual([
      'spec:fix-first-brief.md',
      'spec:rig.yaml',
      'mission:run-card-brief.md',
      'mission:views-brief.md',
    ]);
  });

  it("over the cap, LEARNED files drop first; the run card's sources stay, in listed order", async () => {
    const { mission, team, spec } = layout();
    for (let i = 0; i < 14; i++) {
      put(join(team, `LEARNED-${String(i).padStart(2, '0')}.md`));
    }
    put(join(team, 'MISSION.md'));
    put(join(mission, 'views-brief.md'));
    put(join(mission, 'REPORT.md'));
    const got = await ids(spec);
    expect(got).toHaveLength(16);
    expect(got).toEqual(
      expect.arrayContaining([
        'spec:MISSION.md',
        'spec:rig.yaml',
        'mission:REPORT.md',
        'mission:views-brief.md',
      ])
    );
    expect(got.filter((x) => x.startsWith('spec:LEARNED'))).toHaveLength(12);
    expect(got.indexOf('spec:rig.yaml')).toBeLessThan(got.indexOf('mission:REPORT.md'));
  });
});

describe('QA R3 LOW-2: the configured folder is no mission folder', () => {
  it('openrig/rigs/<rig>/rig.yaml does not get openrig/rigs/MISSION-TEMPLATE.md', async () => {
    const root = tmp();
    put(join(root, 'MISSION-TEMPLATE.md'));
    put(join(root, 'README.md'));
    put(join(root, 'flicut-ab', 'rig.yaml'), 'name: flicut-ab\n');
    put(join(root, 'flicut-ab', 'MISSION.md'));
    expect(
      await ids({ path: join(root, 'flicut-ab', 'rig.yaml'), root, summary: null, spec: null })
    ).toEqual(['spec:MISSION.md', 'spec:rig.yaml']);
  });
});

describe('scope rig: the files the validated rig.yaml names (OpenRig resolves them against the rig root)', () => {
  const RIG_YAML = [
    'version: "0.2"',
    'name: demo',
    'culture_file: CULTURE.md',
    'docs: [{ path: docs/overview.md }, { path: ../outside.md }, { path: tools/run.sh }]',
    'startup:',
    '  files: [{ path: guidance/rig-start.md }, { path: ./guidance/rig-start.md }]',
    'pods:',
    '  - id: dev',
    '    label: Development',
    '    startup: { files: [{ path: guidance/pod.md }, { path: /etc/hosts }] }',
    '    members:',
    '      - id: build',
    '        agent_ref: "local:agents/impl"',
    '        profile: default',
    '        runtime: claude-code',
    '        cwd: .',
    '        startup: { files: [{ path: guidance/build-first-move.md }, { path: guidance/gone.md }] }',
    '',
  ].join('\n');

  function specWorld() {
    const root = tmp();
    const team = join(root, 'proj', 'team');
    put(join(team, 'rig.yaml'), RIG_YAML);
    for (const f of [
      'CULTURE.md',
      'docs/overview.md',
      'tools/run.sh',
      'guidance/rig-start.md',
      'guidance/pod.md',
      'guidance/build-first-move.md',
    ]) {
      put(join(team, f), `# ${f}\n`);
    }
    put(join(root, 'proj', 'outside.md'), 'not the rig root\n');
    const spec: SpecInfo = {
      path: join(team, 'rig.yaml'),
      root,
      summary: null,
      spec: parseSpec(RIG_YAML)!.spec,
    };

    return { root, team, spec };
  }

  it('names come from the spec, in layer order, once each; unsafe, absent and non-text paths are left out', async () => {
    const { spec } = specWorld();
    expect(spec.spec).not.toBeNull();
    expect(specNamedPaths(spec)).toContain('../outside.md'); // named, but refused below
    expect((await specCandidatesFor(spec)).map((c) => c.id)).toEqual([
      'rig:CULTURE.md',
      'rig:docs/overview.md',
      'rig:guidance/rig-start.md',
      'rig:guidance/pod.md',
      'rig:guidance/build-first-move.md',
    ]);
  });

  it('a link out of the rig root is refused, even when it stays inside the configured folder', async () => {
    const { root, team, spec } = specWorld();
    put(join(root, 'elsewhere', 'secret.md'), 'secret\n');
    rmSync(join(team, 'guidance', 'pod.md'));
    symlinkSync(join(root, 'elsewhere', 'secret.md'), join(team, 'guidance', 'pod.md'));
    expect((await specCandidatesFor(spec)).map((c) => c.id)).not.toContain('rig:guidance/pod.md');
  });

  it('a rig.yaml OpenRig would refuse names nothing', async () => {
    const { spec } = specWorld();
    expect(await specCandidatesFor({ ...spec, spec: null })).toEqual([]);
  });

  it('read and redacted like the others; the allowlisted files are unchanged', async () => {
    const { team, spec } = specWorld();
    put(
      join(team, 'guidance', 'build-first-move.md'),
      'key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n'
    );
    const plain = await readRigFiles(spec);
    expect(plain.some((f) => f.scope === 'rig')).toBe(false);
    const all = await readRigFiles(spec, true);
    expect(all.filter((f) => f.scope !== 'rig')).toEqual(plain);
    const move = all.find((f) => f.id === 'rig:guidance/build-first-move.md')!;
    expect(move).toMatchObject({ scope: 'rig', name: 'guidance/build-first-move.md' });
    expect(move.content).not.toContain('sk-ant-api03');
  });

  it('the reader sends rig files only when asked (hub has spec-files), and resends when that flips', async () => {
    const { spec } = specWorld();
    const reader = new RigFilesReader('m4', () => new Date(), 0);
    const specs = new Map([['demo', spec]]);
    const first = await reader.next(specs, false);
    expect(first!.pushes.flatMap((p) => p.files).some((f) => f.scope === 'rig')).toBe(false);
    first!.markSent();
    expect(await reader.next(specs, false)).toBeNull();
    const second = await reader.next(specs, true);
    expect(second!.pushes.flatMap((p) => p.files).filter((f) => f.scope === 'rig')).toHaveLength(5);
    expect(second!.pushes.every((p) => RigFilesPushSchema.safeParse(p).success)).toBe(true);
  });
});
