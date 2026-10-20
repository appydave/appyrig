import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MachineSnapshotSchema,
  SeatSchema,
  TAIL_MAX_LINES,
  type MachineSnapshot,
} from '@appydave/shared';
import { blockedDetailOf, buildSnapshot, mergeViewer } from './builder.js';
import {
  FIXTURES,
  fixtureSources,
  readFixtureJson,
  recordedDaemon,
  ROAMY_PANES,
} from './adapters/fixtureSources.js';
import { parseNodes } from './adapters/daemon.js';
import { M2, NOW, ROAMY, SNAPSHOT_CASES } from './snapshotCases.js';
import type { Seat } from '@appydave/shared';

const seat = (s: MachineSnapshot, id: string) => s.seats.find((x) => x.id === id)!;

describe('snapshot builder', () => {
  it('builds a valid snapshot of a running machine (Roamy)', async () => {
    const snap = await buildSnapshot(fixtureSources({ machine: 'roamy' }), ROAMY, NOW);
    expect(MachineSnapshotSchema.safeParse(snap).success).toBe(true);
    expect(snap.rigs.map((r) => r.name)).toEqual(['kernel', 'starter']);
    expect(snap.sources).toEqual({
      daemon: { ok: true, error: null, version: '0.6.6' },
      tmux: { ok: true, error: null, version: null },
      viewer: { ok: true, error: null, version: null },
    });
    expect(snap.seats).toHaveLength(7);
    expect(seat(snap, 'operator-human@kernel').status).toBe('working');
    expect(seat(snap, 'dev-build@starter').status).toBe('idle');
    // a plain tmux session outside OpenRig is still a seat
    expect(seat(snap, 'openrig-orch')).toMatchObject({
      source: 'tmux',
      runtime: 'claude-code',
      status: 'unknown',
    });
    expect(snap.queue.length).toBeGreaterThan(0);
  });

  it('every tail is ANSI text bounded to TAIL_MAX_LINES (AC 7, snapshot half)', async () => {
    const big = Array.from({ length: 900 }, (_, i) => `row ${i}`).join('\n');
    const snap = await buildSnapshot(
      fixtureSources({
        machine: 'roamy',
        captureText: (s) => (s === 'dev-build@starter' ? big : undefined),
      }),
      ROAMY,
      NOW
    );
    for (const s of snap.seats) {
      expect(s.tail, s.id).not.toBeNull();
      expect(s.tail!.lines.length).toBeLessThanOrEqual(TAIL_MAX_LINES);
      expect(s.tail!.ansi).toBe(true);
    }
    expect(seat(snap, 'dev-build@starter').tail!.lines).toHaveLength(TAIL_MAX_LINES);
    expect(seat(snap, 'dev-build@starter').tail!.lines.at(-1)).toBe('row 899');
  });

  it('a stopped machine (M2: no tmux, no viewer) is 18 stopped seats, not an error', async () => {
    const snap = await buildSnapshot(fixtureSources({ machine: 'm2' }), M2, NOW);
    expect(snap.seats).toHaveLength(recordedDaemon('m2').seats.length);
    expect(snap.seats.every((s) => s.status === 'stopped' && s.tail === null)).toBe(true);
    expect(snap.sources.tmux.ok).toBe(true);
    expect(snap.sources.viewer.ok).toBe(false);
    expect(snap.sources.viewer.error).toMatch(/server_not_running/);
  });

  it('daemon down: tmux-only seats, daemon source says why (never an empty "ok")', async () => {
    const snap = await buildSnapshot(
      fixtureSources({
        machine: 'roamy',
        daemon: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:7433')),
      }),
      ROAMY,
      NOW
    );
    expect(snap.sources.daemon).toEqual({
      ok: false,
      error: expect.stringContaining('ECONNREFUSED'),
      version: null,
    });
    expect(snap.rigs).toEqual([]);
    expect(snap.seats).toHaveLength(Object.keys(ROAMY_PANES).length);
    expect(snap.seats.every((s) => s.source === 'tmux' && s.tail !== null)).toBe(true);
  });

  it('tmux down: openrig seats keep their daemon state with no tails', async () => {
    const base = fixtureSources({ machine: 'roamy' });
    const snap = await buildSnapshot(
      { ...base, tmuxPanes: () => Promise.reject(new Error('tmux not found')) },
      ROAMY,
      NOW
    );
    expect(snap.sources.tmux.ok).toBe(false);
    expect(snap.seats).toHaveLength(6);
    expect(snap.seats.every((s) => s.tail === null)).toBe(true);
    expect(seat(snap, 'operator-human@kernel').status).toBe('working');
  });

  it('one failed capture loses only that tail and is noted', async () => {
    const base = fixtureSources({ machine: 'roamy' });
    const snap = await buildSnapshot(
      {
        ...base,
        capture: (id) => (id === '%3' ? Promise.reject(new Error('gone')) : base.capture(id)),
      },
      ROAMY,
      NOW
    );
    expect(snap.seats.filter((s) => s.tail === null)).toHaveLength(1);
    expect(snap.sources.tmux.ok).toBe(true);
    expect(snap.sources.tmux.error).toMatch(/capture failed for operator-human@kernel/);
  });

  it('a partly unreadable daemon keeps what it read and says what it could not', async () => {
    const snap = await buildSnapshot(
      fixtureSources({
        machine: 'roamy',
        daemon: async () => ({
          ...recordedDaemon('roamy'),
          queue: [],
          warnings: ['nodes unreadable for starter: boom', 'queue unreadable: rig exited 1'],
        }),
      }),
      ROAMY,
      NOW
    );
    expect(snap.sources.daemon).toEqual({
      ok: false,
      error: 'nodes unreadable for starter: boom | queue unreadable: rig exited 1',
      version: '0.6.6',
    });
    expect(snap.seats).toHaveLength(7);
    expect(snap.queue).toEqual([]);
  });

  it('viewer down does not take the snapshot down', async () => {
    const snap = await buildSnapshot(
      fixtureSources({
        machine: 'roamy',
        viewer: () => Promise.reject(new Error('not installed')),
      }),
      ROAMY,
      NOW
    );
    expect(snap.sources.viewer).toMatchObject({ ok: false, error: 'not installed' });
    expect(snap.seats).toHaveLength(7);
  });

  it('a synthetic permission prompt (daemon + pane) reads as blocked', async () => {
    const nodes = parseNodes(
      readFixtureJson('synthetic/roamy--api-rig-starter-nodes--blocked-permission.json')
    );
    const snap = await buildSnapshot(
      fixtureSources({
        machine: 'roamy',
        daemon: async () => ({ ...recordedDaemon('roamy'), seats: nodes }),
        panes: {
          'dev-build@starter':
            'synthetic/roamy--tmux-starter-dev-build--blocked-permission-prompt.ans',
        },
      }),
      ROAMY,
      NOW
    );
    expect(seat(snap, 'dev-build@starter')).toMatchObject({
      status: 'blocked',
      blockedReason: 'permission prompt',
    });
  });

  describe('redaction reaches every field (AC 19)', () => {
    it('tails, cwd, summaries, guidance and blocked reasons carry no secrets', async () => {
      const gho = 'gho_16C7e42F292c6912E7710c838347Ae178B4a';
      const sk = 'sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX';
      const hex = 'a3f5c9d1e7b24680a3f5c9d1e7b24680a3f5c9d1e7b24680';
      const resume = '3f2a9c1e-5b7d-4e21-9a0c-8d6f1b2c3e4f';
      const daemon = recordedDaemon('roamy');
      daemon.seats[0] = {
        ...daemon.seats[0]!,
        cwd: `/work/${gho}`,
        recoveryGuidance: `run with ${sk}`,
        blockedReason: `Bearer abcdefgh12345678`,
      };
      daemon.queue[0] = { ...daemon.queue[0]!, summary: `token ${hex}` };
      const snap = await buildSnapshot(
        fixtureSources({
          machine: 'roamy',
          daemon: async () => daemon,
          captureText: (s) =>
            s === 'openrig-orch'
              ? `\u001b[32mexport T=${gho}\u001b[0m\nclaude --resume '${resume}'\nsha ${hex}\n${sk}\nAuthorization: Bearer abc123def456ghi789`
              : undefined,
        }),
        ROAMY,
        NOW
      );
      const json = JSON.stringify(snap);
      for (const secret of [gho, sk, hex, resume, 'abcdefgh12345678', 'abc123def456ghi789']) {
        expect(json, secret).not.toContain(secret);
      }
      expect(seat(snap, 'openrig-orch').tail!.lines).toHaveLength(5);
      expect(json).toContain('<REDACTED>');
    });
  });
});

describe('blockedDetailOf', () => {
  it('finds the last question through ANSI and box characters', () => {
    const lines = [
      'x',
      '\u001b[1m  Allow this read outside the working directories?\u001b[0m',
      '   1. Yes',
      '   2. No',
    ];
    expect(blockedDetailOf(lines)).toBe('Allow this read outside the working directories?');
    expect(blockedDetailOf(['│ Do you want to proceed?'])).toBe('Do you want to proceed?');
    // a boxed prompt with a right-hand border too
    expect(blockedDetailOf(['│ Do you want to proceed? │'])).toBe('Do you want to proceed?');
  });
  it('redacts before the 200-char cut', () => {
    const q = `Allow ${'x'.repeat(185)} sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX?`;
    expect(blockedDetailOf([q])!.length).toBeLessThanOrEqual(200);
    expect(blockedDetailOf([q])).not.toMatch(/sk-/);
  });
  it('strips OSC 8 hyperlinks (ST and BEL terminated) and keeps the link text', () => {
    const osc = (url: string, text: string, end: string) =>
      `\u001b]8;;${url}${end}${text}\u001b]8;;${end}`;
    const st = `\u001b[1m  Allow ${osc('https://example.com/a?b=c', 'this read', '\u001b\\')} outside the working directories?\u001b[0m`;
    const bel = `│ Do you want to open ${osc('file:///tmp/x', 'the file', '\u0007')}? │`;
    expect(blockedDetailOf([st])).toBe('Allow this read outside the working directories?');
    expect(blockedDetailOf([bel])).toBe('Do you want to open the file?');
    // eslint-disable-next-line no-control-regex
    expect(blockedDetailOf([st, bel])).not.toMatch(/[\u001b\u0007]|https?:/);
    // an unterminated OSC at the end of the line cannot leak either
    expect(blockedDetailOf(['Allow this? \u001b]8;;https://x'])).toBe('Allow this?');
  });

  it('SeatSchema bounds blockedDetail to the collector cap', () => {
    const base = {
      id: 'a',
      source: 'tmux' as const,
      rig: null,
      pod: null,
      logicalId: null,
      runtime: null,
      model: null,
      status: 'blocked' as const,
      blockedReason: null,
      lifecycleState: null,
      sessionStatus: null,
      viewerStatus: null,
      lastActivityAt: null,
      contextUsedPct: null,
      work: { pending: 0, inProgress: 0, blocked: 0 },
      cwd: null,
      recoveryGuidance: null,
      tail: null,
    };
    expect(SeatSchema.safeParse({ ...base, blockedDetail: 'x'.repeat(200) }).success).toBe(true);
    expect(SeatSchema.safeParse({ ...base, blockedDetail: 'x'.repeat(201) }).success).toBe(false);
  });

  it('is null when nothing asks', () => {
    expect(blockedDetailOf(['all done', 'Allowed by auto mode classifier'])).toBeNull();
    expect(blockedDetailOf([])).toBeNull();
  });
});

describe('snapshot builder: viewer pairing', () => {
  const mk = (id: string, runtime: string, cwd: string, status: Seat['status'] = 'idle'): Seat => ({
    id,
    source: 'openrig',
    rig: null,
    pod: null,
    logicalId: null,
    runtime,
    model: null,
    status,
    blockedReason: null,
    lifecycleState: null,
    sessionStatus: 'running',
    viewerStatus: null,
    lastActivityAt: null,
    contextUsedPct: null,
    work: { pending: 0, inProgress: 0, blocked: 0 },
    cwd,
    recoveryGuidance: null,
    tail: null,
  });
  const agent = (status: 'blocked' | 'working', cwd: string, kind = 'claude') => ({
    paneId: 'p',
    agent: kind,
    status,
    cwd,
  });

  it('an unambiguous viewer-blocked agent blocks its seat', () => {
    const seats = [mk('a', 'claude-code', '/x'), mk('b', 'codex', '/x')];
    mergeViewer(seats, [agent('blocked', '/x')]);
    expect(seats[0]).toMatchObject({ status: 'blocked', viewerStatus: 'blocked' });
    expect(seats[0]!.blockedReason).toMatch(/approval/);
    expect(seats[1]).toMatchObject({ status: 'idle', viewerStatus: null });
  });

  it('two seats sharing agent kind + cwd are not paired', () => {
    const seats = [mk('a', 'claude-code', '/x'), mk('b', 'claude-code', '/x')];
    mergeViewer(seats, [agent('blocked', '/x')]);
    expect(seats.map((s) => s.status)).toEqual(['idle', 'idle']);
  });

  it('two agents in one cwd are not paired', () => {
    const seats = [mk('a', 'claude-code', '/x')];
    mergeViewer(seats, [agent('blocked', '/x'), agent('working', '/x')]);
    expect(seats[0]!.status).toBe('idle');
    expect(seats[0]!.viewerStatus).toBeNull();
  });

  it('never revives a stopped seat', () => {
    const seats = [mk('a', 'claude-code', '/x', 'stopped')];
    mergeViewer(seats, [agent('working', '/x')]);
    expect(seats[0]).toMatchObject({ status: 'stopped', viewerStatus: null });
  });
});

describe('snapshot fixtures (test/fixtures/snapshots)', () => {
  it.each(SNAPSHOT_CASES)(
    '%s is what the builder produces from the recorded captures',
    async (name, build) => {
      const file = join(FIXTURES, 'snapshots', `${name}.json`);
      const snap = await build();
      expect(MachineSnapshotSchema.safeParse(snap).success).toBe(true);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(JSON.stringify(snap)));
    }
  );
});

describe('F3 (truth #6): agent activity comes from the transcript, not the terminal', () => {
  // orch-boss's case: a transcript last written a day ago, while the probe sweep keeps the pane's
  // lastActivityAt minutes old.
  const DAY_AGO = NOW.getTime() - 24 * 3600_000;
  const build = (agentActivity?: () => Map<string, number> | null) =>
    buildSnapshot(
      {
        ...fixtureSources({ machine: 'roamy' }),
        specs: async () => new Map(),
        ...(agentActivity ? { agentActivity } : {}),
      },
      ROAMY,
      NOW
    );

  it('a seat with a transcript gets its last write; one without gets null; plain tmux nothing', async () => {
    const snap = await build(() => new Map([['advisor-lead@kernel', DAY_AGO]]));
    expect(seat(snap, 'advisor-lead@kernel').agentActivityAt).toBe(new Date(DAY_AGO).toISOString());
    for (const s of snap.seats) {
      if (s.id === 'advisor-lead@kernel') continue;
      expect(s.agentActivityAt).toBe(s.rig === null ? undefined : null);
    }
  });

  it("the rig's recentAt follows agent activity and queue moves, not the terminal sweep", async () => {
    const snap = await build(() => new Map([['advisor-lead@kernel', DAY_AGO]]));
    const kernel = snap.rigs.find((r) => r.name === 'kernel')!;
    const mine = new Set(snap.seats.filter((s) => s.rig === 'kernel').map((s) => s.id));
    const queueLatest = snap.queue
      .filter((q) => mine.has(q.source ?? '') || mine.has(q.destination ?? ''))
      .map((q) => Date.parse(q.updatedAt));
    const expected = Math.max(DAY_AGO, ...queueLatest);
    expect(Date.parse(kernel.recentAt!)).toBe(expected);
    const terminal = Math.max(
      ...snap.seats.filter((s) => mine.has(s.id)).map((s) => Date.parse(s.lastActivityAt ?? '0'))
    );
    expect(terminal).toBeGreaterThan(expected); // the old rule would have reported this one
  });

  it('before the first transcript scan (or an older path) the field is left out, not null', async () => {
    const snap = await build(() => null);
    expect(snap.seats.every((s) => s.agentActivityAt === undefined)).toBe(true);
  });
});
