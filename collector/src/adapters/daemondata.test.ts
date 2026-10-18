import { describe, it, expect } from 'vitest';
import { DaemonDataPushSchema, SeatSchema } from '@appydave/shared';
import {
  DaemonDataReader,
  parseLibraryPacks,
  parseLibrarySkills,
  parseLibrarySpecs,
  parseSeatDetail,
} from './index.js';
import { readFixtureJson } from './fixtureSources.js';
import { parseNodes } from './daemon.js';

/** A node record shaped like the live 0.6.6 GET /api/rigs/:id/nodes/:logicalId. */
const node = (over: Record<string, unknown> = {}) => ({
  nodeId: 'N1',
  logicalId: 'dev.build',
  resolvedSpecName: 'implementer',
  resolvedSpecVersion: '1.0',
  resolvedSpecHash: 'abc123',
  profile: 'default',
  resumeToken: 'a0cf4780-db84-44cf-9ec1-97d959480d41',
  resumeCommand: "claude --resume 'a0cf4780-db84-44cf-9ec1-97d959480d41'",
  recoveryGuidance: {
    summary: 'Try native Claude resume first.',
    commands: ["claude --resume 'a0cf4780-db84-44cf-9ec1-97d959480d41'"],
    notes: ['fall back to the picker'],
  },
  startupFiles: [
    {
      kind: 'file',
      path: 'guidance/role.md',
      deliveryHint: 'send_text',
      required: true,
      appliesOn: ['fresh_start', 'restore'],
      absolutePath: '/x/guidance/role.md',
    },
  ],
  startupActions: [{ type: 'send_text', phase: 'after_ready', value: 'dev-build@r\nidentity' }],
  installedResources: [{ id: 'shared:openrig-core', category: 'plugin', targetPath: '' }],
  peers: [{ logicalId: 'dev.qa', canonicalSessionName: 'dev-qa@r', runtime: 'claude-code' }],
  recentEvents: [{ type: 'agent.activity', payload: { big: 'x'.repeat(5000) } }],
  transcript: { path: '/Users/x/.openrig/transcripts/t.log' },
  ...over,
});

describe('v2 · seat detail (step 2)', () => {
  it('reduces the node record to the Agent page fields and drops the token, command, events', () => {
    const d = parseSeatDetail(node());
    expect(d.spec).toEqual({
      name: 'implementer',
      version: '1.0',
      profile: 'default',
      hash: 'abc123',
    });
    expect(d.startupFiles).toEqual([
      {
        path: 'guidance/role.md',
        deliveryHint: 'send_text',
        required: true,
        appliesOn: ['fresh_start', 'restore'],
      },
    ]);
    expect(d.startupActions[0]).toMatchObject({ type: 'send_text', phase: 'after_ready' });
    expect(d.peers).toEqual([{ logicalId: 'dev.qa', session: 'dev-qa@r', runtime: 'claude-code' }]);
    expect(d.recoveryNotes).toEqual(['Try native Claude resume first.', 'fall back to the picker']);
    expect(d.installedResources).toEqual([{ id: 'shared:openrig-core', category: 'plugin' }]);
    const wire = JSON.stringify(d);
    expect(wire).not.toContain('a0cf4780');
    expect(wire).not.toContain('transcripts');
    expect(wire).not.toContain('big');
  });

  it('is lenient: a bad field drops that field or row, never the whole detail', () => {
    const d = parseSeatDetail(
      node({
        startupFiles: [{ path: 7 }, 'junk', { path: 'ok.md', required: 'yes', appliesOn: 'x' }],
        peers: 'nope',
        resolvedSpecName: 12,
        recoveryGuidance: 'weird',
        installedResources: [null, { id: 3 }],
      })
    );
    expect(d.startupFiles).toEqual([
      { path: 'ok.md', deliveryHint: null, required: null, appliesOn: [] },
    ]);
    expect(d.peers).toEqual([]);
    expect(d.spec).toMatchObject({ name: null, version: '1.0', hash: 'abc123' });
    expect(d.recoveryNotes).toEqual([]);
    expect(d.installedResources).toEqual([]);
    expect(() => parseSeatDetail('not an object')).toThrow(/object/);
  });

  const T = { seat: 'dev-build@r', rigId: 'RIG1', logicalId: 'dev.build' };
  const reader = (get: (p: string) => Promise<unknown>, log: (l: string) => void = () => {}) => {
    let t = 1_000_000;
    const r = new DaemonDataReader('m4', get, { now: () => t, log, kinds: ['seatdetail'] });
    return { r, tick: (ms: number) => (t += ms) };
  };

  it('reads each OpenRig seat once, validates the push, and only resends what changed', async () => {
    const paths: string[] = [];
    const { r, tick } = reader(async (p) => {
      paths.push(p);
      return node();
    });
    const first = await r.next([T]);
    expect(paths).toEqual(['/api/rigs/RIG1/nodes/dev.build']);
    expect(first!.pushes).toHaveLength(1);
    expect(DaemonDataPushSchema.safeParse(first!.pushes[0]).success).toBe(true);
    expect(first!.pushes[0]).toMatchObject({
      kind: 'seatdetail',
      key: 'dev-build@r',
      machineId: 'm4',
      status: 'ok',
    });
    // not accepted yet: it is offered again after the interval
    tick(61_000);
    const again = await r.next([T]);
    expect(again!.pushes).toHaveLength(1);
    again!.markSent();
    tick(61_000);
    expect(await r.next([T])).toBeNull(); // unchanged since the hub accepted it
    tick(61_000);
    r.reset(); // a reconnect: the hub may have restarted
    expect(await r.next([T])).not.toBeNull();
  });

  it('a 404 is pushed as unsupported (never as none)', async () => {
    const { r } = reader(async () => {
      throw new Error('GET /api/rigs/RIG1/nodes/dev.build -> HTTP 404');
    });
    const p = await r.next([T]);
    expect(p!.pushes[0]).toMatchObject({ status: 'unsupported', data: null });
  });

  it('a failing endpoint sends nothing for it, logs once, and recovers quietly', async () => {
    const lines: string[] = [];
    let healthy = false;
    const { r, tick } = reader(
      async () => {
        if (!healthy) throw new Error('boom');
        return node();
      },
      (l) => lines.push(l)
    );
    expect(await r.next([T])).toBeNull();
    tick(61_000);
    expect(await r.next([T])).toBeNull();
    tick(61_000);
    expect(await r.next([T])).toBeNull();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/seat detail unreadable/);
    healthy = true;
    tick(61_000);
    expect((await r.next([T]))!.pushes).toHaveLength(1);
    expect(lines).toHaveLength(1);
  });

  it('one bad seat does not stop the others', async () => {
    const { r } = reader(async (p) => {
      if (p.includes('bad')) throw new Error('HTTP 500');
      return node();
    });
    const p = await r.next([
      { seat: 'a@r', rigId: 'R', logicalId: 'a' },
      { seat: 'bad@r', rigId: 'R', logicalId: 'bad' },
      { seat: 'c@r', rigId: 'R', logicalId: 'c' },
    ]);
    expect(p!.pushes.map((x) => x.key)).toEqual(['a@r', 'c@r']);
  });
});

describe('v2 · old hub compatibility', () => {
  it('a seat with no new data validates against the OLD seat shape', () => {
    const raw = readFixtureJson(
      'roamy--api-rig-kernel-01M4B5W1CN575YJD9K6JB3D3NC-nodes.json'
    ) as Record<string, unknown>[];
    const bare = raw.map((n) => ({ ...n, tmuxAttachCommand: null, resumeCommand: null }));
    const OldSeat = SeatSchema.omit({ tmuxAttachCommand: true, resumeCommand: true });
    for (const s of parseNodes(bare)) expect(OldSeat.safeParse(s).success).toBe(true);
  });
});

// ── step 3: library ─────────────────────────────────────────────────────────────────────────────

const specRows = [
  {
    id: 'e9aebbf1794477cc',
    kind: 'agent',
    name: 'vault-specialist',
    version: '1.0',
    sourceType: 'builtin',
    sourcePath: '/opt/openrig/agents/apps/vault-specialist/agent.yaml',
    relativePath: 'agents/apps/vault-specialist/agent.yaml',
    updatedAt: '2026-10-11T11:19:10.586Z',
    summary: 'Vault specialist agent',
  },
  {
    id: 'workflow:basic-loop:1',
    kind: 'workflow',
    name: 'basic-loop',
    version: '1',
    sourceType: 'builtin',
    rolesCount: 3,
    stepsCount: 4,
    terminalTurnRule: 'hot_potato',
    targetRig: 'conveyor',
    isBuiltIn: true,
    status: 'valid',
  },
];
const skillRows = [
  {
    id: 'openrig-managed:process/agent-browser',
    name: 'agent-browser',
    source: 'openrig-managed',
    files: [
      { name: 'SKILL.md', path: 'SKILL.md', size: 16560 },
      { name: 'OPENRIG.md', path: 'OPENRIG.md', size: 2454 },
    ],
    absolutePath: '/opt/openrig/skills/process/agent-browser',
  },
];
const packRows = [
  {
    id: 'context-pack:skills/process/agent-browser',
    kind: 'context-pack',
    name: 'agent-browser',
    version: '0.6.6',
    purpose: 'Browser automation CLI',
    taxonomy: 'skills',
    sourceType: 'builtin',
    sourcePath: '/opt/openrig/context-packs/agent-browser',
    manifestEstimatedTokens: 1200,
    derivedEstimatedTokens: 900,
    files: [],
  },
];

describe('v2 · library (step 3)', () => {
  it('maps specs, skills and packs to rows; facts are primitives only; file text is never read', () => {
    const specs = parseLibrarySpecs(specRows);
    expect(specs[1]).toMatchObject({
      id: 'workflow:basic-loop:1',
      kind: 'workflow',
      facts: {
        rolesCount: 3,
        stepsCount: 4,
        terminalTurnRule: 'hot_potato',
        targetRig: 'conveyor',
        isBuiltIn: true,
      },
    });
    expect(specs[0]).toMatchObject({
      path: '/opt/openrig/agents/apps/vault-specialist/agent.yaml',
      facts: {},
    });
    const skills = parseLibrarySkills(skillRows);
    expect(skills[0]).toMatchObject({
      kind: 'skill',
      sourceType: 'openrig-managed',
      facts: { fileCount: 2, totalBytes: 19014 },
      files: [
        { name: 'SKILL.md', size: 16560 },
        { name: 'OPENRIG.md', size: 2454 },
      ],
    });
    expect(parseLibraryPacks(packRows)[0]).toMatchObject({
      summary: 'Browser automation CLI',
      facts: { taxonomy: 'skills', tokens: 1200 },
    });
  });

  it('is lenient: rows without an id or name, or of the wrong type, are skipped; an envelope works', () => {
    expect(
      parseLibrarySpecs([{ id: 1, name: 'x' }, 'junk', null, { id: 'a', name: 'b' }])
    ).toHaveLength(1);
    expect(parseLibrarySpecs({ specs: specRows })).toHaveLength(2);
    expect(() => parseLibrarySpecs('nope')).toThrow(/array/);
    const many = Array.from({ length: 500 }, (_, i) => ({ id: `i${i}`, name: `n${i}` }));
    expect(parseLibrarySpecs(many)).toHaveLength(300);
  });

  const libraryReader = (routes: Record<string, unknown>, log: (l: string) => void = () => {}) => {
    const seen: string[] = [];
    const r = new DaemonDataReader(
      'm4',
      async (p) => {
        seen.push(p);
        const v = routes[p];
        if (v instanceof Error) throw v;
        if (v === undefined) throw new Error(`GET ${p} -> HTTP 404`);
        return v;
      },
      { now: () => 5_000_000, log, kinds: ['library'] }
    );
    return { r, seen };
  };
  const only = (p: Awaited<ReturnType<DaemonDataReader['next']>>, kind: string) =>
    p?.pushes.find((x) => x.kind === kind);

  it('pushes the three lists with the OpenRig version, reading GET routes only', async () => {
    const { r, seen } = libraryReader({
      '/api/specs/library': specRows,
      '/api/skills/library': skillRows,
      '/api/context-packs/library': packRows,
      '/healthz': { semver: '0.6.6' },
    });
    const push = only(await r.next([]), 'library');
    expect(DaemonDataPushSchema.safeParse(push).success).toBe(true);
    expect(push).toMatchObject({ status: 'ok', key: '', data: { openrigVersion: '0.6.6' } });
    expect(seen.sort()).toEqual([
      '/api/context-packs/library',
      '/api/skills/library',
      '/api/specs/library',
      '/healthz',
    ]);
    for (const p of seen) expect(p).toMatch(/^\/(api\/|healthz)/);
  });

  it('a list that cannot be read is null (not empty) and the others still go; logged once', async () => {
    const lines: string[] = [];
    const { r } = libraryReader(
      {
        '/api/specs/library': specRows,
        '/api/skills/library': new Error('boom'),
        '/api/context-packs/library': { not: 'a list' },
      },
      (l) => lines.push(l)
    );
    const push = only(await r.next([]), 'library') as {
      data: { specs: unknown[]; skills: unknown; contextPacks: unknown };
    };
    expect(push.data.specs).toHaveLength(2);
    expect(push.data.skills).toBeNull();
    expect(push.data.contextPacks).toBeNull();
    expect(lines).toHaveLength(2);
  });

  it('all routes 404 = unsupported; all failing otherwise = nothing sent, logged once', async () => {
    const a = libraryReader({});
    expect(only(await a.r.next([]), 'library')).toMatchObject({
      status: 'unsupported',
      data: null,
    });
    const lines: string[] = [];
    const b = libraryReader(
      {
        '/api/specs/library': new Error('HTTP 500'),
        '/api/skills/library': new Error('HTTP 500'),
        '/api/context-packs/library': new Error('HTTP 500'),
      },
      (l) => lines.push(l)
    );
    expect(await b.r.next([])).toBeNull();
    expect(lines).toEqual([expect.stringMatching(/library unreadable/)]);
  });
});
