import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MISSION_IMAGE_MAX_BYTES, MISSION_TEXT_MAX_BYTES } from '@appydave/shared';
import {
  allowlistFor,
  checkPath,
  manifestFor,
  MissionFilesReader,
  readMissionFile,
} from './missionfiles.js';
import type { SpecInfo } from './specs.js';

/** The trust root for these tests: every temp folder below sits under it (the real default is ~/dev). */
const ROOTS = [realpathSync(tmpdir())];
const dirs: string[] = [];
const tmp = () => {
  // realpath: macOS tmpdir is under /var -> /private/var, and the rule is "no symlink in the path"
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'appyrig-mf-')));
  dirs.push(d);

  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const put = (path: string, data: string | Buffer = 'x\n') => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, data);
};

/**
 * root/proj/MISSION.md with a jobs table naming specs in another folder, root/proj/team/rig.yaml,
 * plus qa/ and shots/ beside MISSION.md.
 */
function layout() {
  const root = tmp();
  const repos = tmp(); // a different tree: spec sources live in other repos
  const mission = join(root, 'proj');
  const spec1 = join(repos, 'plug', 'CT-1.md');
  const spec1b = join(repos, 'plug', 'CT-1-spec.html');
  put(spec1, '# ticket\n');
  put(spec1b, '<h1>spec</h1>');
  put(
    join(mission, 'MISSION.md'),
    `# m\n\n| Slice | Repo | Worktree | Branch | Spec source |\n|---|---|---|---|---|\n| 1 | A | \`/w\` | \`b\` | \`${spec1}\` + \`CT-1-spec.html\` |\n| 2 | B | \`/w\` | \`b\` | \`${join(repos, 'plug', 'gone.md')}\` |\n`
  );
  put(join(mission, 'team', 'rig.yaml'), 'name: demo\nsummary: s\n');
  put(join(mission, 'qa', 'qa-1.md'), '# qa\n');
  put(join(mission, 'qa', 'notes.txt'), 'not allowed');
  put(join(mission, 'shots', 'a.png'), Buffer.from([137, 80, 78, 71, 1, 2, 3]));
  put(join(mission, 'shots', 'page.html'), '<p>shot</p>');
  put(join(mission, 'shots', 'x.gif'), 'gif');
  const spec: SpecInfo = {
    path: join(mission, 'team', 'rig.yaml'),
    root,
    summary: 's',
    spec: null,
  };

  return { root, repos, mission, spec, spec1, spec1b };
}

describe('the allowlist: which paths may be read (the boundary)', () => {
  it('accepts the specs the MISSION.md names (with the sibling) and qa/ and shots/ files', async () => {
    const { spec, spec1, spec1b, mission } = layout();
    const al = await allowlistFor(spec, ROOTS);
    expect(await checkPath(spec1, al)).toMatchObject({ ok: true });
    expect(await checkPath(spec1b, al)).toMatchObject({ ok: true });
    expect(await checkPath(join(mission, 'qa', 'qa-1.md'), al)).toMatchObject({ ok: true });
    expect(await checkPath(join(mission, 'shots', 'a.png'), al)).toMatchObject({ ok: true });
    expect(await checkPath(join(mission, 'shots', 'page.html'), al)).toMatchObject({ ok: true });
  });

  it('refuses a path the MISSION.md does not name, wherever it is', async () => {
    const { spec, repos, mission, root } = layout();
    put(join(repos, 'plug', 'unlisted.md'), 'secret');
    put(join(root, 'elsewhere.md'), 'secret');
    const al = await allowlistFor(spec, ROOTS);
    for (const p of [
      join(repos, 'plug', 'unlisted.md'),
      join(root, 'elsewhere.md'),
      join(mission, 'MISSION.md'), // a mission file is not a spec source: rig.file serves it
      join(mission, 'team', 'rig.yaml'),
      '/etc/passwd',
    ]) {
      expect(await checkPath(p, al), p).toEqual({ ok: false, why: 'refused' });
    }
  });

  it('refuses ../ however it is spelled, and relative or malformed paths', async () => {
    const { spec, mission, repos } = layout();
    const al = await allowlistFor(spec, ROOTS);
    for (const p of [
      `${mission}/qa/../qa/qa-1.md`,
      `${mission}/qa/../MISSION.md`,
      `${repos}/plug/../plug/CT-1.md`,
      `${mission}/qa//qa-1.md`,
      'qa/qa-1.md',
      '../qa/qa-1.md',
      '',
      `${mission}/qa/qa-1.md\0.png`,
    ]) {
      expect((await checkPath(p, al)).ok, JSON.stringify(p)).toBe(false);
    }
    expect(await checkPath(42, al)).toEqual({ ok: false, why: 'refused' });
  });

  it('refuses a symlink that leaves qa/ or shots/, and a listed spec that is (or sits behind) a symlink', async () => {
    const { spec, mission, repos, root } = layout();
    put(join(root, 'outside.md'), 'secret');
    put(join(root, 'outside.png'), 'secret');
    symlinkSync(join(root, 'outside.md'), join(mission, 'qa', 'link.md'));
    symlinkSync(join(root, 'outside.png'), join(mission, 'shots', 'link.png'));
    // a whole folder linked in: shots2 -> elsewhere, and qa/sub/ -> not a direct child anyway
    mkdirSync(join(root, 'otherdir'));
    put(join(root, 'otherdir', 'z.png'), 'z');
    symlinkSync(join(root, 'otherdir'), join(mission, 'sneaky'));
    // a listed path that is a symlink
    put(join(repos, 'real.md'), 'real');
    symlinkSync(join(repos, 'real.md'), join(repos, 'plug', 'gone.md'));
    const al = await allowlistFor(spec, ROOTS);
    expect(await checkPath(join(mission, 'qa', 'link.md'), al)).toEqual({
      ok: false,
      why: 'refused',
    });
    expect(await checkPath(join(mission, 'shots', 'link.png'), al)).toEqual({
      ok: false,
      why: 'refused',
    });
    expect(await checkPath(join(mission, 'sneaky', 'z.png'), al)).toEqual({
      ok: false,
      why: 'refused',
    });
    expect(await checkPath(join(repos, 'plug', 'gone.md'), al)).toEqual({
      ok: false,
      why: 'refused',
    });
    // and none of them reaches the list pushed to the hub
    const list = await manifestFor(al);
    expect(list.some((p) => /link\.|sneaky|gone\.md/.test(p))).toBe(false);
  });

  it('refuses the wrong extension for the folder and anything outside .md .html .png .jpg', async () => {
    const { spec, mission } = layout();
    put(join(mission, 'qa', 'pic.png'), 'x');
    put(join(mission, 'shots', 'doc.md'), 'x');
    const al = await allowlistFor(spec, ROOTS);
    for (const p of [
      join(mission, 'qa', 'notes.txt'),
      join(mission, 'qa', 'pic.png'),
      join(mission, 'shots', 'doc.md'),
      join(mission, 'shots', 'x.gif'),
      join(mission, 'qa', 'sub', 'deep.md'),
    ]) {
      expect(await checkPath(p, al), p).toEqual({ ok: false, why: 'refused' });
    }
  });

  it('a listed spec that is not on disk is missing, not refused', async () => {
    const { spec, repos } = layout();
    const al = await allowlistFor(spec, ROOTS);
    expect(await checkPath(join(repos, 'plug', 'gone.md'), al)).toEqual({
      ok: false,
      why: 'missing',
    });
  });

  it('a rig with no MISSION.md lists nothing and serves nothing', async () => {
    const root = tmp();
    put(join(root, 'solo', 'rig.yaml'), 'name: solo\n');
    put(join(root, 'solo', 'qa', 'q.md'), 'q');
    const al = await allowlistFor({
      path: join(root, 'solo', 'rig.yaml'),
      root,
      summary: null,
      spec: null,
    });
    expect(al.listed.size).toBe(0);
    expect(await manifestFor(al)).toEqual([]);
    expect(await checkPath(join(root, 'solo', 'qa', 'q.md'), al)).toEqual({
      ok: false,
      why: 'refused',
    });
  });
});

describe('the trust root: a listed spec must sit under an allowed root', () => {
  it('refuses a spec the MISSION.md lists that is outside the root, and keeps it off the manifest', async () => {
    const { spec, root, spec1, repos } = layout();
    // the root is the mission's own folder only: the spec sources in another tree are outside it
    const al = await allowlistFor(spec, [root]);
    expect(await checkPath(spec1, al)).toEqual({ ok: false, why: 'refused' });
    expect(await checkPath(join(repos, 'plug', 'gone.md'), al)).toEqual({
      ok: false,
      why: 'refused',
    });
    expect((await manifestFor(al)).some((p) => p.startsWith(repos))).toBe(false);
    // and the same spec is served once its tree is a root
    expect(await checkPath(spec1, await allowlistFor(spec, [root, repos]))).toMatchObject({
      ok: true,
    });
    // a root that does not exist allows nothing
    expect(await checkPath(spec1, await allowlistFor(spec, ['/nonexistent-root']))).toEqual({
      ok: false,
      why: 'refused',
    });
  });
});

describe('the manifest and the reading', () => {
  it('lists listed specs first, then qa/*.md, then shots/*, and nothing else', async () => {
    const { spec, spec1, spec1b, mission, repos } = layout();
    const list = await manifestFor(await allowlistFor(spec, ROOTS));
    expect(list).toEqual([
      spec1b, // sorted: CT-1-spec.html sorts before CT-1.md
      spec1,
      join(repos, 'plug', 'gone.md'),
      join(mission, 'qa', 'qa-1.md'),
      join(mission, 'shots', 'a.png'),
      join(mission, 'shots', 'page.html'),
    ]);
  });

  it('caps: text over 256 KB and an image over 2 MB are too_large with no bytes; at the cap they are read', async () => {
    const { spec, mission } = layout();
    put(
      join(mission, 'qa', 'big.md'),
      'ab '.repeat(MISSION_TEXT_MAX_BYTES).slice(0, MISSION_TEXT_MAX_BYTES + 1)
    );
    put(
      join(mission, 'qa', 'edge.md'),
      'ab '.repeat(MISSION_TEXT_MAX_BYTES).slice(0, MISSION_TEXT_MAX_BYTES)
    );
    put(join(mission, 'shots', 'big.png'), Buffer.alloc(MISSION_IMAGE_MAX_BYTES + 1, 1));
    put(join(mission, 'shots', 'edge.png'), Buffer.alloc(MISSION_IMAGE_MAX_BYTES, 2));
    const al = await allowlistFor(spec, ROOTS);
    const read = (p: string) => readMissionFile('m2', 'demo', p, al, '2026-10-19T00:00:00.000Z');
    const bigText = await read(join(mission, 'qa', 'big.md'));
    expect(bigText).toHaveLength(1);
    expect(bigText[0]).toMatchObject({ status: 'too_large', bytes: MISSION_TEXT_MAX_BYTES + 1 });
    expect(bigText[0]!.text).toBeUndefined();
    const bigImg = await read(join(mission, 'shots', 'big.png'));
    expect(bigImg[0]).toMatchObject({ status: 'too_large' });
    expect(bigImg[0]!.base64).toBeUndefined();
    const edgeText = await read(join(mission, 'qa', 'edge.md'));
    expect(edgeText[0]).toMatchObject({ status: 'ok', mime: 'text/markdown' });
    expect(edgeText[0]!.text).toHaveLength(MISSION_TEXT_MAX_BYTES);
    // a 2 MB image travels in parts, each well under the channel guard; together they are the file
    const edgeImg = await read(join(mission, 'shots', 'edge.png'));
    expect(edgeImg.length).toBeGreaterThan(1);
    for (const [i, p] of edgeImg.entries()) {
      expect(p).toMatchObject({ part: i, parts: edgeImg.length, mime: 'image/png' });
      expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(800 * 1024);
    }
    const joined = Buffer.concat(
      edgeImg.map((p) => Buffer.from((p as { base64: string }).base64, 'base64'))
    );
    expect(joined.length).toBe(MISSION_IMAGE_MAX_BYTES);
    expect(joined.equals(Buffer.alloc(MISSION_IMAGE_MAX_BYTES, 2))).toBe(true);
  });

  it('text is redacted; a refused path read directly yields only a missing marker, never bytes', async () => {
    const { spec, mission, root } = layout();
    put(join(mission, 'qa', 'key.md'), 'token sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA end');
    put(join(root, 'secret.md'), 'TOP SECRET');
    const al = await allowlistFor(spec, ROOTS);
    const [k] = await readMissionFile('m2', 'demo', join(mission, 'qa', 'key.md'), al, 'x');
    expect(k!.text).not.toContain('sk-ant-api03-AAAA');
    const out = await readMissionFile('m2', 'demo', join(root, 'secret.md'), al, 'x');
    expect(JSON.stringify(out)).not.toContain('TOP SECRET');
    expect(out[0]).toMatchObject({ status: 'missing' });
  });
});

describe('MissionFilesReader', () => {
  it('sends the manifest then the files once, nothing while unchanged, and again after a change or reset', async () => {
    const { spec, mission } = layout();
    let t = 0;
    const r = new MissionFilesReader(
      'm2',
      () => new Date(Date.UTC(2026, 9, 19, 0, 0, t)),
      10,
      ROOTS
    );
    const specs = new Map([['demo', spec]]);
    const first = await r.next(specs);
    expect(first!.pushes[0]).toMatchObject({ kind: 'manifest', rig: 'demo' });
    expect(first!.pushes.filter((p) => p.kind === 'file')).toHaveLength(6);
    // not marked sent yet: asked again, it offers the same
    t = 100;
    expect(await r.next(specs)).not.toBeNull();
    first!.markSent();
    t = 200;
    expect(await r.next(specs)).toBeNull();
    put(join(mission, 'qa', 'new.md'), 'new');
    t = 300;
    const again = await r.next(specs);
    expect(again!.pushes[0]).toMatchObject({ kind: 'manifest' });
    expect((again!.pushes[0] as { paths: string[] }).paths).toContain(
      join(mission, 'qa', 'new.md')
    );
    again!.markSent();
    t = 400;
    expect(await r.next(specs)).toBeNull();
    r.reset();
    expect(await r.next(specs)).not.toBeNull();
  });

  it('one rig whose files cannot be listed does not stop another', async () => {
    const { spec } = layout();
    const bad: SpecInfo = {
      path: '/nonexistent/x/rig.yaml',
      root: '/nonexistent',
      summary: null,
      spec: null,
    };
    const r = new MissionFilesReader('m2', () => new Date(), 0, ROOTS);
    const got = await r.next(
      new Map([
        ['bad', bad],
        ['demo', spec],
      ])
    );
    expect(got!.pushes.every((p) => p.rig === 'demo')).toBe(true);
  });
});
