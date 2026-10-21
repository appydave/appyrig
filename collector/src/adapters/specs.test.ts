import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSpecIndex, parseSpec, scanSpecs } from './specs.js';
import { enrichRigs } from '../builder.js';
import { specFoldersOf } from '../config.js';
import {
  DEFAULT_SPEC_FOLDERS,
  RigSummarySchema,
  type QueueItem,
  type RigSummary,
  type Seat,
} from '@appydave/shared';

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
      spec: null,
    });
  });
  it("carries the whole file as OpenRig's RigSpec when it validates, and null when OpenRig would refuse it", () => {
    const yaml = [
      'version: "0.2"',
      'name: demo',
      'culture_file: CULTURE.md',
      'pods:',
      '  - id: dev',
      '    label: Development',
      '    members:',
      '      - { id: build, agent_ref: "local:agents/impl", profile: default, runtime: claude-code, cwd: . }',
      '      - { id: qa, agent_ref: "local:agents/qa", profile: default, runtime: claude-code, cwd: . }',
      '    edges:',
      '      - { kind: delegates_to, from: build, to: qa }',
      '',
    ].join('\n');
    const ok = parseSpec(yaml)!;

    expect(ok.spec?.culture_file).toBe('CULTURE.md');
    expect(ok.spec?.pods[0]).toMatchObject({ id: 'dev', label: 'Development' });
    expect(ok.spec?.pods[0]?.edges).toEqual([{ kind: 'delegates_to', from: 'build', to: 'qa' }]);

    // an unknown top-level key: OpenRig refuses the spec, so nothing in it is trusted; still matched by name
    const bad = parseSpec(`${yaml}mission_board: yes\n`)!;

    expect(bad).toMatchObject({ name: 'demo', spec: null });
  });
  it('has no summary when none is written, and is null for non-specs', () => {
    expect(parseSpec('name: demo\n')).toEqual({ name: 'demo', summary: null, spec: null });
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
  it('run card R3: finds a variant rig-<v>.yaml by its name:, beside the base rig.yaml', async () => {
    const a = tmp();

    write(join(a, 'ylo-thumbs', 'rig.yaml'), 'name: ylo-thumbs\n');
    write(join(a, 'ylo-thumbs', 'rig-d10.yaml'), 'name: ylo-d10\nsummary: D10 launch\n');
    write(join(a, 'ylo-thumbs', 'rig-notes.txt'), 'name: nope\n');
    write(join(a, 'ylo-thumbs', 'prig.yaml'), 'name: nope2\n');

    const found = await scanSpecs([a]);

    expect([...found.keys()].sort()).toEqual(['ylo-d10', 'ylo-thumbs']);
    expect(found.get('ylo-d10')).toMatchObject({
      path: join(a, 'ylo-thumbs', 'rig-d10.yaml'),
      summary: 'D10 launch',
    });
  });

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
      root: a,
      summary: 'from a',
      spec: null,
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
    const specs = new Map([
      ['a', { path: '/p/rig.yaml', root: '/p', summary: 'about a', spec: null }],
    ]);
    const [a, b] = enrichRigs([rig('a'), rig('b')], [], [], specs);

    expect(a).toMatchObject({ specStatus: 'found', specPath: '/p/rig.yaml', summary: 'about a' });
    expect(b).toMatchObject({ specStatus: 'not-found', specPath: null, summary: null });
  });

  it("a valid rig.yaml's pods (label, summary, startup, continuity, pod-local edges) and cross-pod edges are carried, OpenRig-shaped", () => {
    const yaml = [
      'version: "0.2"',
      'name: a',
      'pods:',
      '  - id: dev',
      '    label: Development',
      '    summary: >',
      '      builds   it',
      '    continuity_policy: { enabled: true, sync_triggers: [manual] }',
      '    startup:',
      '      files: [{ path: guidance/pod.md, required: false }]',
      '    members:',
      '      - { id: build, agent_ref: "local:a/impl", profile: default, runtime: claude-code, cwd: . }',
      '      - { id: qa, agent_ref: "local:a/qa", profile: default, runtime: claude-code, cwd: . }',
      '    edges: [{ kind: delegates_to, from: build, to: qa }]',
      '  - id: review',
      '    label: Review',
      '    members:',
      '      - { id: lead, agent_ref: "local:a/rev", profile: default, runtime: claude-code, cwd: . }',
      'edges: [{ kind: escalates_to, from: dev.qa, to: review.lead }]',
      '',
    ].join('\n');
    const specs = new Map([
      ['a', { path: '/p/rig.yaml', root: '/p', summary: null, spec: parseSpec(yaml)!.spec }],
    ]);
    const [a] = enrichRigs([rig('a')], [], [], specs);

    expect(RigSummarySchema.parse(a)).toEqual(a);
    expect(a).toMatchObject({ specValid: true });
    expect(a!.pods).toEqual([
      {
        id: 'dev',
        label: 'Development',
        summary: 'builds it',
        members: ['build', 'qa'],
        continuity_policy: { enabled: true, sync_triggers: ['manual'] },
        startup: { files: [{ path: 'guidance/pod.md', required: false }] },
        edges: [{ kind: 'delegates_to', from: 'build', to: 'qa' }],
      },
      { id: 'review', label: 'Review', members: ['lead'] },
    ]);
    expect(a!.specEdges).toEqual([{ kind: 'escalates_to', from: 'dev.qa', to: 'review.lead' }]);
  });

  it('the rig-level spec (culture_file, docs, workspace, services, startup) is carried; env travels as names only', () => {
    const yaml = [
      'version: "0.2"',
      'name: a',
      'culture_file: CULTURE.md',
      'permission_policy: builtin:auto',
      'managed_blocks: { claude-code: CLAUDE.local.md }',
      'env: { REPO_TOKEN_HINT: "value-that-must-not-travel", LOG_LEVEL: debug }',
      'docs: [{ path: docs/overview.md }]',
      'workspace: { workspace_root: ~/dev, repos: [{ name: app, path: app, kind: project }], default_repo: app }',
      'services: { kind: compose, compose_file: compose.yaml, wait_for: [{ url: "http://localhost:1/health" }] }',
      'startup:',
      '  files: [{ path: guidance/rig-start.md, delivery_hint: send_text }]',
      '  actions: [{ type: send_text, value: "read your role", idempotent: true }]',
      'pods:',
      '  - id: dev',
      '    label: Dev',
      '    members: [{ id: b, agent_ref: "local:x", profile: default, runtime: claude-code, cwd: . }]',
      '',
    ].join('\n');
    const specs = new Map([
      ['a', { path: '/p/rig.yaml', root: '/p', summary: null, spec: parseSpec(yaml)!.spec }],
    ]);
    const [a] = enrichRigs([rig('a')], [], [], specs);

    expect(RigSummarySchema.parse(a)).toEqual(a);
    expect(a!.rigSpec).toEqual({
      version: '0.2',
      culture_file: 'CULTURE.md',
      permission_policy: 'builtin:auto',
      managed_blocks: { 'claude-code': 'CLAUDE.local.md' },
      docs: [{ path: 'docs/overview.md' }],
      workspace: {
        workspace_root: '~/dev',
        repos: [{ name: 'app', path: 'app', kind: 'project' }],
        default_repo: 'app',
      },
      services: {
        kind: 'compose',
        compose_file: 'compose.yaml',
        wait_for: [{ url: 'http://localhost:1/health' }],
      },
      startup: {
        files: [{ path: 'guidance/rig-start.md', delivery_hint: 'send_text' }],
        actions: [{ type: 'send_text', value: 'read your role', idempotent: true }],
      },
      envNames: ['REPO_TOKEN_HINT', 'LOG_LEVEL'],
    });
    expect(JSON.stringify(a)).not.toContain('value-that-must-not-travel');
  });

  it('a rig.yaml OpenRig would refuse: specValid false, and no pods or spec edges read from it', () => {
    const specs = new Map([['a', { path: '/p/rig.yaml', root: '/p', summary: null, spec: null }]]);
    const [a] = enrichRigs([rig('a')], [], [], specs);

    expect(a).toMatchObject({ specStatus: 'found', specValid: false });
    expect(a).not.toHaveProperty('pods');
    expect(a).not.toHaveProperty('specEdges');
    expect(a).not.toHaveProperty('rigSpec');
  });
});
