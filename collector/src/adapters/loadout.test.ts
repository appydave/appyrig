import { afterEach, describe, expect, it } from 'vitest';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SEAT_DOC_MAX_BYTES, SeatLoadoutSchema } from '@appydave/shared';
import {
  classifySkills,
  foldListing,
  ListingTracker,
  newerSet,
  listingOfLine,
  LoadoutReader,
  readSeatDocs,
  skillFolders,
  trackedSkills,
  withSkillCounts,
  type Exec,
  type LoadoutSeat,
} from './loadout.js';
import { parseSpec, type SpecInfo } from './specs.js';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'appyrig-lo-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const put = (path: string, text = 'x\n') => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
};

const listingLine = (names: string[], at = '2026-10-11T11:18:09.715Z', isInitial = true) =>
  JSON.stringify({
    type: 'attachment',
    timestamp: at,
    attachment: {
      type: 'skill_listing',
      content: names.map((n) => `- ${n}: …`).join('\n'),
      skillCount: names.length,
      isInitial,
      names,
    },
  });
const titleLine = (seat: string) => JSON.stringify({ type: 'custom-title', customTitle: seat });
const fileOf = (path: string) => {
  const st = statSync(path);
  return { path, size: st.size, mtimeMs: st.mtimeMs, lastEventMs: null };
};

describe('listingOfLine', () => {
  it('reads a skill_listing attachment', () => {
    expect(listingOfLine(listingLine(['recipe', 'canvas:visual-brief']))).toEqual({
      at: '2026-10-11T11:18:09.715Z',
      skillCount: 2,
      isInitial: true,
      names: ['recipe', 'canvas:visual-brief'],
    });
  });
  it('ignores other lines, other attachments and a prompt that merely mentions skill_listing', () => {
    expect(listingOfLine(titleLine('a@b'))).toBeNull();
    expect(
      listingOfLine(
        JSON.stringify({
          type: 'attachment',
          timestamp: 'x',
          attachment: { type: 'skill_listing' },
        })
      )
    ).toBeNull();
    expect(
      listingOfLine(
        JSON.stringify({
          type: 'user',
          timestamp: '2026-10-11T00:00:00Z',
          message: { content: 'skill_listing' },
        })
      )
    ).toBeNull();
    expect(listingOfLine('{"skill_listing" broken')).toBeNull();
  });
});

describe('foldListing: the initial listing plus later deltas (QA D1)', () => {
  const l = (names: string[], isInitial: boolean, at = '2026-10-09T13:48:12.600Z') => ({
    at,
    skillCount: names.length,
    isInitial,
    names,
  });
  const many = (n: number, p = 's') => Array.from({ length: n }, (_, i) => `${p}${i}`);

  it('the real shape: 307 initial, then deltas of 3 and 1, is 311 shown, not 1', () => {
    let s = foldListing(null, l(many(307), true));
    s = foldListing(
      s,
      l(['agent-browser', 'development-team', 'dogfood'], false, '2026-10-09T13:48:26.880Z')
    );
    s = foldListing(s, l(['review-team'], false, '2026-10-09T13:48:38.367Z'));
    expect(s).toMatchObject({
      skillCount: 311,
      reported: 311,
      isInitial: true,
      deltas: 2,
      at: '2026-10-09T13:48:38.367Z',
    });
    expect(s.names).toHaveLength(311);
    expect(s.names.slice(-1)).toEqual(['review-team']);
  });

  it('a later full listing starts the set again', () => {
    let s = foldListing(null, l(many(5), true));
    s = foldListing(s, l(['extra'], false));
    s = foldListing(s, l(['only', 'these'], true));
    expect(s).toMatchObject({ names: ['only', 'these'], skillCount: 2, deltas: 0 });
  });

  it('a name repeated in a delta is kept once; the summed count then disagrees, which the view flags', () => {
    let s = foldListing(null, l(['a', 'b'], true));
    s = foldListing(s, l(['b'], false));
    expect(s.names).toEqual(['a', 'b']);
    expect(s.skillCount).toBe(2); // the union, per the ruling
    expect(s.reported).toBe(3); // Claude Code's own counts added up
  });

  it('deltas with no full listing before them say so', () => {
    let s = foldListing(null, l(['x'], false));
    s = foldListing(s, l(['y'], false));
    expect(s).toMatchObject({ names: ['x', 'y'], isInitial: false, deltas: 1, skillCount: 2 });
  });
});

describe('ListingTracker: the latest listing, read incrementally', () => {
  it('finds the latest listing and counts them, reading only appended bytes', async () => {
    const path = join(tmp(), 't.jsonl');
    writeFileSync(path, `${titleLine('a@b')}\n${listingLine(['one'], '2026-10-11T01:00:00Z')}\n`);
    const tracker = new ListingTracker();
    let r = await tracker.latest(fileOf(path));
    expect(r?.listing.names).toEqual(['one']);
    expect(r?.count).toBe(1);

    appendFileSync(path, `${listingLine(['two'], '2026-10-11T02:00:00Z', false)}\n`);
    r = await tracker.latest(fileOf(path));
    expect(r?.listing).toMatchObject({ names: ['one', 'two'], isInitial: true, deltas: 1 });
    expect(r?.count).toBe(2);
  });

  it('leaves a line still being written for the next scan', async () => {
    const path = join(tmp(), 't.jsonl');
    const line = listingLine(['late']);
    writeFileSync(path, `${titleLine('a@b')}\n${line.slice(0, 40)}`);
    const tracker = new ListingTracker();
    expect(await tracker.latest(fileOf(path))).toBeNull();
    appendFileSync(path, `${line.slice(40)}\n`);
    expect((await tracker.latest(fileOf(path)))?.listing.names).toEqual(['late']);
  });

  it('reads a file again from the start when it shrank', async () => {
    const path = join(tmp(), 't.jsonl');
    writeFileSync(path, `${listingLine(['a', 'b', 'c', 'd'])}\n`);
    const tracker = new ListingTracker();
    await tracker.latest(fileOf(path));
    writeFileSync(path, `${listingLine(['z'])}\n`);
    const r = await tracker.latest(fileOf(path));
    expect(r?.listing.names).toEqual(['z']);
    expect(r?.count).toBe(1);
  });

  it('handles a listing line longer than one read block', async () => {
    const names = Array.from({ length: 40_000 }, (_, i) => `skill-number-${i}`);
    const path = join(tmp(), 't.jsonl');
    writeFileSync(path, `${titleLine('a@b')}\n${listingLine(names)}\n`);
    expect((await new ListingTracker().latest(fileOf(path)))?.listing.names.length).toBe(40_000);
  });
});

describe('classifySkills', () => {
  const places = {
    cwd: new Set(['recipe', 'mochaccino', 'queue-handoff', 'openrig-skills']),
    tracked: new Set(['recipe', 'mochaccino']),
    personal: new Set(['openrig-skills', 'flihub', 'jump']),
  };
  const names = [
    'recipe',
    'queue-handoff',
    'openrig-skills',
    'mochaccino',
    'mochaccino:mochaccino',
    'flihub',
    'flivideo:flihub',
    'jump',
    'loop',
    'skill-creator:skill-creator',
    'anthropic-skills:skill-creator',
  ];
  const by = Object.fromEntries(classifySkills(names, places).map((s) => [s.name, s]));

  it('sorts each name by where it came from', () => {
    expect(by['recipe']?.source).toBe('repo');
    expect(by['queue-handoff']?.source).toBe('role');
    expect(by['jump']?.source).toBe('personal');
    expect(by['loop']?.source).toBe('builtin');
    expect(by['flivideo:flihub']).toMatchObject({ source: 'plugin', plugin: 'flivideo' });
  });

  it('a skill in the cwd wins over a personal copy, and both are flagged', () => {
    expect(by['openrig-skills']).toMatchObject({ source: 'role', alsoIn: ['personal'] });
  });

  it('flags the same name in two places, plugin prefix dropped', () => {
    expect(by['mochaccino']?.alsoIn).toEqual(['plugin']);
    expect(by['mochaccino:mochaccino']?.alsoIn).toEqual(['repo']);
    expect(by['flihub']?.alsoIn).toEqual(['plugin']);
    expect(by['flivideo:flihub']?.alsoIn).toEqual(['personal']);
    expect(by['skill-creator:skill-creator']?.alsoIn).toEqual(['plugin']);
    expect(by['queue-handoff']?.alsoIn).toEqual([]);
    expect(by['loop']?.alsoIn).toEqual([]);
  });

  it('keeps each listed name once', () => {
    expect(
      classifySkills(['a', 'a'], { cwd: new Set(), tracked: new Set(), personal: new Set() })
    ).toHaveLength(1);
  });
});

describe('skill folders on disk', () => {
  it('counts only folders that hold a SKILL.md', async () => {
    const d = tmp();
    put(join(d, 'real', 'SKILL.md'));
    mkdirSync(join(d, 'empty'));
    put(join(d, 'loose.skill'));
    expect([...(await skillFolders(d))]).toEqual(['real']);
    expect((await skillFolders(join(d, 'missing'))).size).toBe(0);
  });

  it('git tracking: names under .claude/skills, and "not a repo" kept apart', async () => {
    const ok: Exec = async (_b, args) => {
      expect(args).toEqual(['-C', '/w', 'ls-files', '-z', '--', '.claude/skills']);
      return {
        stdout:
          '.claude/skills/recipe/SKILL.md\0.claude/skills/recipe/x.md\0.claude/skills/app-idea/SKILL.md\0',
        stderr: '',
        code: 0,
      };
    };
    expect(await trackedSkills(ok, '/w')).toEqual({
      isRepo: true,
      tracked: new Set(['recipe', 'app-idea']),
    });
    const notRepo: Exec = async () => ({
      stdout: '',
      stderr: 'fatal: not a git repository',
      code: 128,
    });
    expect(await trackedSkills(notRepo, '/w')).toEqual({ isRepo: false, tracked: new Set() });
  });
});

describe('seat documents', () => {
  function world() {
    const root = tmp();
    const team = join(root, 'proj', 'team');
    const rigYaml = [
      'version: "0.2"',
      'name: demo',
      'culture_file: TEAM-CULTURE.md',
      'pods:',
      '  - id: orch',
      '    label: Orchestration',
      '    members:',
      '      - { id: lead, agent_ref: "local:agent", profile: default, runtime: claude-code, cwd: . }',
      '',
    ].join('\n');
    put(join(team, 'rig.yaml'), rigYaml);
    put(join(team, 'TEAM-CULTURE.md'), '# culture\n');
    put(join(team, 'LEARNED-orch-lead.md'), '# learned\n');
    const spec: SpecInfo = {
      path: join(team, 'rig.yaml'),
      root,
      summary: null,
      spec: parseSpec(rigYaml)!.spec,
    };
    const cwd = tmp();
    put(join(cwd, 'CLAUDE.md'), '# claude\n');
    put(join(cwd, 'CLAUDE.local.md'), 'token: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n');
    const agent = tmp();
    put(
      join(agent, 'agent.yaml'),
      'name: orch\nversion: "1.0"\nstartup:\n  files:\n    - path: guidance/role.md\n'
    );
    put(join(agent, 'guidance', 'role.md'), '# Role: Orchestrator\n');
    const seat: LoadoutSeat = { id: 'orch-lead@demo', rig: 'demo', runtime: 'claude-code', cwd };
    return { root, team, spec, cwd, agent, seat };
  }

  it('finds each layer in its fixed place, in order, and says where it looked for an absent one', async () => {
    const w = world();
    const layers = await readSeatDocs(w.seat, w.spec, w.agent);
    expect(layers.map((l) => [l.id, l.name, l.present])).toEqual([
      ['culture', 'TEAM-CULTURE.md', true],
      ['role', 'role.md', true],
      ['claude-md', 'CLAUDE.md', true],
      ['claude-local', 'CLAUDE.local.md', true],
      ['recap', 'RECAP.md', false],
      ['learned', 'LEARNED-orch-lead.md', true],
    ]);
    expect(layers[4]?.looked).toEqual([join(w.cwd, 'RECAP.md'), join(w.team, 'RECAP.md')]);
    expect(layers[1]?.content).toBe('# Role: Orchestrator\n');
  });

  it('redacts file text', async () => {
    const w = world();
    const local = (await readSeatDocs(w.seat, w.spec, w.agent)).find(
      (l) => l.id === 'claude-local'
    );
    expect(local?.content).not.toContain('sk-ant-api03');
  });

  it('caps a large file and says so', async () => {
    const w = world();
    // plain words: a long unbroken run would be redacted as if it were a token
    const text = 'some words. '.repeat(Math.ceil(SEAT_DOC_MAX_BYTES / 12) + 10);
    put(join(w.cwd, 'CLAUDE.md'), text);
    const md = (await readSeatDocs(w.seat, w.spec, w.agent)).find((l) => l.id === 'claude-md');
    expect(md).toMatchObject({ truncated: true, bytes: text.length });
    expect(md?.content?.length).toBe(SEAT_DOC_MAX_BYTES);
  });

  it('never follows a link out of its folder, nor a culture_file with a path in it', async () => {
    const w = world();
    const outside = tmp();
    put(join(outside, 'secret.md'), 'secret\n');
    rmSync(join(w.cwd, 'CLAUDE.md'));
    symlinkSync(join(outside, 'secret.md'), join(w.cwd, 'CLAUDE.md'));
    const yaml = readFileSync(join(w.team, 'rig.yaml'), 'utf8').replace(
      'TEAM-CULTURE.md',
      '../../../etc/passwd'
    );
    const spec = { ...w.spec, spec: parseSpec(yaml)!.spec };
    expect(spec.spec?.culture_file).toBe('../../../etc/passwd');
    const layers = await readSeatDocs(w.seat, spec, w.agent);
    expect(layers.find((l) => l.id === 'claude-md')?.present).toBe(false);
    // the bad culture_file falls back to the default name, which is absent here
    expect(layers.find((l) => l.id === 'culture')).toMatchObject({
      name: 'CULTURE.md',
      present: false,
    });
  });

  it('takes culture_file only from a rig.yaml OpenRig would accept (a refused spec gets the default name)', async () => {
    const w = world();
    const refused = { ...w.spec, spec: null };
    expect((await readSeatDocs(w.seat, refused, w.agent))[0]).toMatchObject({
      name: 'CULTURE.md',
      present: false,
    });
  });

  it("finds the role file by OpenRig's `orientation: role` marker, whatever it is called", async () => {
    const w = world();
    put(
      join(w.agent, 'agent.yaml'),
      [
        'name: orch',
        'version: "1.0"',
        'startup:',
        '  files:',
        '    - path: guidance/role.md',
        '    - path: guidance/orchestrator.md',
        '      orientation: role',
        '',
      ].join('\n')
    );
    put(join(w.agent, 'guidance', 'orchestrator.md'), '# Role: the real one\n');
    const role = (await readSeatDocs(w.seat, w.spec, w.agent)).find((l) => l.id === 'role');
    expect(role?.content).toBe('# Role: the real one\n');
  });

  it('with no spec, cwd or agent folder: absent, saying why', async () => {
    const layers = await readSeatDocs(
      { id: 'x@y', rig: 'y', runtime: 'claude-code', cwd: null },
      undefined,
      undefined
    );
    expect(layers.every((l) => !l.present)).toBe(true);
    expect(layers[0]?.looked.join(' ')).toMatch(/no rig.yaml/);
    expect(layers[1]?.looked.join(' ')).toMatch(/no agent spec folder/);
    expect(layers[2]?.looked.join(' ')).toMatch(/no folder/);
  });
});

describe('LoadoutReader', () => {
  function setup() {
    const projects = tmp();
    const home = tmp();
    put(join(home, '.claude', 'skills', 'jump', 'SKILL.md'));
    const cwd = tmp();
    put(join(cwd, '.claude', 'skills', 'recipe', 'SKILL.md'));
    put(join(cwd, '.claude', 'skills', 'queue-handoff', 'SKILL.md'));
    const transcript = join(projects, '-w', 's1.jsonl');
    put(
      transcript,
      `${titleLine('dev-build@demo')}\n${listingLine(['recipe', 'queue-handoff', 'jump', 'loop', 'canvas:x'])}\n`
    );
    put(
      join(projects, '-w', 'other.jsonl'),
      `${titleLine('someone-else@x')}\n${listingLine(['secret'])}\n`
    );
    const exec: Exec = async () => ({
      stdout: '.claude/skills/recipe/SKILL.md\0',
      stderr: '',
      code: 0,
    });
    let t = Date.parse('2026-10-12T00:00:00Z');
    const clock = { now: () => new Date(t), tick: (ms: number) => (t += ms) };
    const reader = new LoadoutReader('m2', {
      projectsDir: projects,
      home,
      exec,
      now: clock.now,
      ttlMs: 30_000,
    });
    const seats: LoadoutSeat[] = [
      { id: 'dev-build@demo', rig: 'demo', runtime: 'claude-code', cwd },
      { id: 'dev-cx@demo', rig: 'demo', runtime: 'codex', cwd },
    ];
    return { reader, seats, clock, transcript };
  }

  it('builds a valid loadout per seat, sorted by source; a Codex seat is "not-claude", never empty skills pretending', async () => {
    const { reader, seats } = setup();
    const p = await reader.next(seats, new Map(), new Map());
    expect(p?.loadouts).toHaveLength(2);
    for (const l of p!.loadouts) expect(SeatLoadoutSchema.safeParse(l).success).toBe(true);
    const [claude, codex] = p!.loadouts;
    expect(claude).toMatchObject({ status: 'ok', cwdIsGitRepo: true });
    expect(claude?.listing).toMatchObject({ skillCount: 5, isInitial: true, listings: 1 });
    expect(Object.fromEntries(claude!.skills.map((s) => [s.name, s.source]))).toEqual({
      recipe: 'repo',
      'queue-handoff': 'role',
      jump: 'personal',
      loop: 'builtin',
      'canvas:x': 'plugin',
    });
    expect(codex).toMatchObject({ status: 'not-claude', skills: [], layers: [] });
  });

  it('only reads transcripts titled as a known seat', async () => {
    const { reader, seats } = setup();
    const p = await reader.next(seats, new Map(), new Map());
    expect(JSON.stringify(p)).not.toContain('secret');
  });

  it('a Claude seat with no listing says so', async () => {
    const { reader } = setup();
    const p = await reader.next(
      [{ id: 'nobody@demo', rig: 'demo', runtime: 'claude-code', cwd: null }],
      new Map(),
      new Map()
    );
    expect(p?.loadouts[0]).toMatchObject({ status: 'no-listing', listing: null, skills: [] });
  });

  it('waits for its interval, sends only what changed once accepted, and resends after reset', async () => {
    const { reader, seats, clock, transcript } = setup();
    const first = await reader.next(seats, new Map(), new Map());
    expect(await reader.next(seats, new Map(), new Map())).toBeNull(); // within the interval
    clock.tick(30_000);
    // not marked sent: everything goes again
    expect((await reader.next(seats, new Map(), new Map()))?.loadouts).toHaveLength(2);
    first!.markSent();
    clock.tick(30_000);
    const again = await reader.next(seats, new Map(), new Map());
    again?.markSent();
    clock.tick(30_000);
    expect(await reader.next(seats, new Map(), new Map())).toBeNull(); // nothing changed
    appendFileSync(transcript, `${listingLine(['recipe'], '2026-10-12T01:00:00Z', false)}\n`);
    clock.tick(30_000);
    const changed = await reader.next(seats, new Map(), new Map());
    expect(changed?.loadouts.map((l) => l.seat)).toEqual(['dev-build@demo']);
    // a later non-initial listing is a delta: it adds to the set, it does not replace it (QA D1)
    expect(changed?.loadouts[0]?.listing).toMatchObject({
      skillCount: 5, // recipe was already listed: the union does not grow
      reported: 6,
      isInitial: true,
      deltas: 1,
      listings: 2,
    });
    expect(changed?.loadouts[0]?.skills).toHaveLength(5);
    changed!.markSent();
    reader.reset();
    expect((await reader.next(seats, new Map(), new Map()))?.loadouts).toHaveLength(2);
  });
});

describe('the skill-count pill', () => {
  it('the reader keeps the latest skillCount per scanned seat: a number, or null for Codex / no listing', async () => {
    const projects = tmp();
    put(
      join(projects, '-w', 's.jsonl'),
      `${titleLine('a@demo')}\n${listingLine(['x', 'y', 'z'])}\n`
    );
    const exec: Exec = async () => ({ stdout: '', stderr: '', code: 128 });
    const reader = new LoadoutReader('m2', { projectsDir: projects, home: tmp(), exec });
    expect(reader.skillCounts().size).toBe(0);
    await reader.next(
      [
        { id: 'a@demo', rig: 'demo', runtime: 'claude-code', cwd: null },
        { id: 'b@demo', rig: 'demo', runtime: 'claude-code', cwd: null },
        { id: 'c@demo', rig: 'demo', runtime: 'codex', cwd: null },
      ],
      new Map(),
      new Map()
    );
    expect([...reader.skillCounts()]).toEqual([
      ['a@demo', 3],
      ['b@demo', null],
      ['c@demo', null],
    ]);
  });

  it('withSkillCounts adds the field only to scanned seats (absent = not reported, never 0)', () => {
    const out = withSkillCounts(
      [{ id: 'a' }, { id: 'b' }, { id: 'tmux-only' }],
      new Map<string, number | null>([
        ['a', 313],
        ['b', null],
      ])
    );
    expect(out).toEqual([
      { id: 'a', skillCount: 313 },
      { id: 'b', skillCount: null },
      { id: 'tmux-only' },
    ]);
    expect('skillCount' in out[2]!).toBe(false);
  });
});

describe('a seat with several transcripts (ruling: one transcript, never mixed)', () => {
  it('takes the file whose set starts from the newest full listing; its deltas only', async () => {
    const projects = tmp();
    // older session: a full listing, then a delta written AFTER the newer session started
    put(
      join(projects, '-w', 'old.jsonl'),
      `${titleLine('s@demo')}\n${listingLine(['a', 'b'], '2026-10-01T00:00:00Z')}\n${listingLine(['late-delta'], '2026-10-03T00:00:00Z', false)}\n`
    );
    put(
      join(projects, '-w', 'new.jsonl'),
      `${titleLine('s@demo')}\n${listingLine(['x', 'y', 'z'], '2026-10-02T00:00:00Z')}\n${listingLine(['w'], '2026-10-02T01:00:00Z', false)}\n`
    );
    const exec: Exec = async () => ({ stdout: '', stderr: '', code: 128 });
    const reader = new LoadoutReader('m2', { projectsDir: projects, home: tmp(), exec });
    const p = await reader.next(
      [{ id: 's@demo', rig: 'demo', runtime: 'claude-code', cwd: null }],
      new Map(),
      new Map()
    );
    const l = p!.loadouts[0]!;
    expect(l.skills.map((s) => s.name)).toEqual(['x', 'y', 'z', 'w']);
    expect(l.listing).toMatchObject({ skillCount: 4, deltas: 1, listings: 2 });
    expect(l.listing?.transcript).toMatch(/new\.jsonl$/);
  });

  it('a set from a full listing beats one built only from deltas', () => {
    const full = foldListing(null, {
      at: '2026-10-01T00:00:00Z',
      skillCount: 1,
      isInitial: true,
      names: ['a'],
    });
    const deltasOnly = foldListing(null, {
      at: '2026-10-05T00:00:00Z',
      skillCount: 1,
      isInitial: false,
      names: ['b'],
    });
    expect(newerSet(full, deltasOnly)).toBe(true);
    expect(newerSet(deltasOnly, full)).toBe(false);
  });
});

describe('QA D3: a seat whose folder is gone', () => {
  it('never counts unplaceable names as built-in, and says the folder is gone', async () => {
    const projects = tmp();
    const home = tmp();
    put(join(home, '.claude', 'skills', 'jump', 'SKILL.md'));
    put(
      join(projects, '-w', 's.jsonl'),
      `${titleLine('gone@demo')}\n${listingLine(['recipe', 'jump', 'canvas:x', 'loop'])}\n`
    );
    const exec: Exec = async () => ({ stdout: '', stderr: '', code: 128 });
    const reader = new LoadoutReader('m2', { projectsDir: projects, home, exec });
    const p = await reader.next(
      [{ id: 'gone@demo', rig: 'demo', runtime: 'claude-code', cwd: join(tmp(), 'deleted') }],
      new Map(),
      new Map()
    );
    const l = p!.loadouts[0]!;
    expect(l).toMatchObject({ cwdExists: false, cwdIsGitRepo: null });
    expect(Object.fromEntries(l.skills.map((s) => [s.name, s.source]))).toEqual({
      recipe: 'unplaced',
      jump: 'personal',
      'canvas:x': 'plugin',
      loop: 'unplaced',
    });
    expect(SeatLoadoutSchema.safeParse(l).success).toBe(true);
  });

  it('a folder that exists keeps the usual sorting (cwdExists true)', () => {
    expect(
      classifySkills(['loop'], { cwd: new Set(), tracked: new Set(), personal: new Set() })[0]
        ?.source
    ).toBe('builtin');
  });
});
