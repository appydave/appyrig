import { describe, it, expect } from 'vitest';
import { parseGraphEdges, parseNodes, parsePs, parseQueue } from './daemon.js';
import { QueueItemSchema } from '@appydave/shared';
import { readFixtureJson } from './fixtureSources.js';
import { SeatSchema } from '@appydave/shared';

const KERNEL = 'roamy--api-rig-kernel-01M4B5W1CN575YJD9K6JB3D3NC-nodes.json';
const syn = (name: string) => `synthetic/roamy--api-rig-starter-nodes--${name}.json`;
const byId = (seats: ReturnType<typeof parseNodes>, id: string) => seats.find((s) => s.id === id)!;

describe('adapter: daemon /api/ps', () => {
  it('maps a running machine to rig summaries', () => {
    const rigs = parsePs(readFixtureJson('roamy--api-ps.json'));
    expect(
      rigs.map((r) => [r.name, r.status, r.nodeCount, r.runningCount, r.attentionCount])
    ).toEqual([
      ['kernel', 'running', 4, 4, 3],
      ['starter', 'running', 2, 2, 1],
    ]);
  });

  it('keeps stopped rigs (the M2 has six, none running)', () => {
    const rigs = parsePs(readFixtureJson('m2--api-ps.json'));
    expect(rigs).toHaveLength(6);
    expect(rigs.every((r) => r.status === 'stopped' && r.runningCount === 0)).toBe(true);
  });

  it('an empty list is an empty machine, not an error', () => {
    expect(parsePs(readFixtureJson('synthetic/roamy--api-ps--empty.json'))).toEqual([]);
  });

  it('throws naming the field when a key we read is gone', () => {
    const raw = readFixtureJson('roamy--api-ps.json') as Record<string, unknown>[];
    const renamed: Record<string, unknown> = { ...raw[0]!, nameX: 'kernel' };
    delete renamed.name;
    expect(() => parsePs([renamed])).toThrow(/name/);
  });

  it('rejects a non-array', () => {
    expect(() => parsePs({ error: 'nope' })).toThrow(/array/);
  });
});

describe('adapter: daemon nodes -> seats', () => {
  const seats = parseNodes(readFixtureJson(KERNEL));

  it('derives working / idle from the oracle', () => {
    expect(byId(seats, 'operator-human@kernel').status).toBe('working');
    expect(byId(seats, 'advisor-lead@kernel').status).toBe('idle');
    expect(byId(seats, 'queue-worker@kernel').status).toBe('idle');
  });

  it('carries the lifecycle fact separately from the pip', () => {
    const s = byId(seats, 'advisor-lead@kernel');
    expect(s.status).toBe('idle');
    expect(s.lifecycleState).toBe('attention_required');
    expect(s).toMatchObject({
      source: 'openrig',
      rig: 'kernel',
      pod: 'advisor',
      contextUsedPct: 7,
    });
    expect(s.tail).toBeNull();
    expect(s.viewerStatus).toBeNull();
  });

  it('blocked when needsInput.count > 0, with the reason', () => {
    const s = byId(parseNodes(readFixtureJson(syn('blocked-permission'))), 'dev-build@starter');
    expect(s.status).toBe('blocked');
    expect(s.blockedReason).toBe('permission prompt');
    expect(s.activity?.needsInputCount).toBe(1);
  });

  it('usage limit is blocked too', () => {
    const s = byId(
      parseNodes(readFixtureJson(syn('needs-input-usage-limit'))),
      'dev-review@starter'
    );
    expect(s.status).toBe('blocked');
    expect(s.blockedReason).toBe('usage limit');
  });

  it('working mid tool call', () => {
    const s = byId(parseNodes(readFixtureJson(syn('working-mid-tool-call'))), 'dev-build@starter');
    expect(s.status).toBe('working');
  });

  it('flattens recovery guidance to one line', () => {
    const s = byId(
      parseNodes(readFixtureJson(syn('attention-required-with-guidance'))),
      'dev-review@starter'
    );
    expect(s.lifecycleState).toBe('attention_required');
    expect(typeof s.recoveryGuidance).toBe('string');
    expect(s.recoveryGuidance!.length).toBeGreaterThan(0);
  });

  it('a stopped seat is stopped and carries no activity', () => {
    const files = [
      'm2--api-rig-kernel-01M4DZNH353R95ADJ00CFZQZXC-nodes.json',
      'm2--api-rig-fliedit-team-01M4G3N3DZG0PKJ1PPF401NH0A-nodes.json',
    ];
    for (const f of files) {
      const stopped = parseNodes(readFixtureJson(f));
      expect(stopped.length).toBeGreaterThan(0);
      for (const s of stopped) {
        expect(s.status).toBe('stopped');
        expect('activity' in s).toBe(false);
        expect(s.blockedReason).toBeNull();
      }
    }
  });

  it('contextTokens: carried when the daemon has a number, omitted (not null) otherwise', () => {
    const raw = readFixtureJson(KERNEL) as Record<string, unknown>[];
    const withTokens = raw.map((n) => ({
      ...n,
      contextUsage: { usedPercentage: 7, totalInputTokens: 119_400 },
    }));
    expect(parseNodes(withTokens)[0]!.contextTokens).toBe(119_400);
    const odd = raw.map((n) => ({
      ...n,
      contextUsage: { usedPercentage: 7, totalInputTokens: 'lots' },
    }));
    const seatsOdd = parseNodes(odd); // a bad field does not blank the rig
    expect(seatsOdd.length).toBe(raw.length);
    for (const s of seatsOdd) expect('contextTokens' in s).toBe(false);
  });

  it('a new collector seat still validates against an older hub (no contextTokens key)', () => {
    const oldSeat = SeatSchema.omit({ contextTokens: true });
    const noTokens = parseNodes(
      (readFixtureJson(KERNEL) as Record<string, unknown>[]).map((n) => ({
        ...n,
        contextUsage: { usedPercentage: 7, totalInputTokens: null },
      }))
    );
    for (const s of noTokens) expect(oldSeat.safeParse(s).success).toBe(true);
    const withTokens = parseNodes(
      (readFixtureJson(KERNEL) as Record<string, unknown>[]).map((n) => ({
        ...n,
        contextUsage: { usedPercentage: 7, totalInputTokens: 5 },
      }))
    );
    expect(oldSeat.safeParse(withTokens[0]).success).toBe(false); // only a seat WITH the key is refused
  });

  it('a missing activityState key (not just null) does not crash', () => {
    const raw = (readFixtureJson(KERNEL) as Record<string, unknown>[]).map((n) => {
      const rest = { ...n };
      delete rest.activityState;
      return rest;
    });
    const seats2 = parseNodes(raw);
    expect(seats2.every((s) => s.status === 'unknown')).toBe(true);
  });

  it('throws naming the field when canonicalSessionName is renamed', () => {
    const raw = (readFixtureJson(KERNEL) as Record<string, unknown>[]).map((n) => {
      const { canonicalSessionName, ...rest } = n;
      return { ...rest, sessionName: canonicalSessionName };
    });
    expect(() => parseNodes(raw)).toThrow(/canonicalSessionName/);
  });
});

describe('adapter: daemon queue', () => {
  it('returns body-free rows, newest first', () => {
    const q = parseQueue(readFixtureJson('m2--cli-queue-list-all.json'));
    expect(q.length).toBe(113);
    const base = [
      'createdAt',
      'destination',
      'id',
      'priority',
      'source',
      'state',
      'summary',
      'tags',
      'updatedAt',
    ];
    // v2 note fields are optional: only these may appear beyond the original keys.
    const extra = ['closureReason', 'closureTarget', 'blockedOn', 'humanIntent', 'tier'];
    for (const row of q) {
      const keys = Object.keys(row);
      for (const b of base) expect(keys).toContain(b);
      for (const k of keys) expect([...base, ...extra]).toContain(k);
    }
    for (let i = 1; i < q.length; i++) expect(q[i - 1]!.updatedAt >= q[i]!.updatedAt).toBe(true);
  });

  it('falls back to the first body line when summary is null, bounded to 160 chars', () => {
    const raw = readFixtureJson('roamy--cli-queue-list.json') as Record<string, unknown>[];
    const row = { ...raw[0]!, summary: null, body: `\n\n${'x'.repeat(400)}\nsecond line` };
    const [q] = parseQueue([row]);
    expect(q!.summary).toBe('x'.repeat(160));
  });

  it('caps at 500 rows', () => {
    const raw = readFixtureJson('roamy--cli-queue-list.json') as Record<string, unknown>[];
    const many = Array.from({ length: 600 }, (_, i) => ({ ...raw[0]!, qitemId: `q-${i}` }));
    expect(parseQueue(many)).toHaveLength(500);
  });
});

describe('v2 free fields (step 1)', () => {
  const rawQ = () => readFixtureJson('roamy--cli-queue-list.json') as Record<string, unknown>[];

  it('queue: carries closure / blockedOn / humanIntent / tier when sent as text', () => {
    const [q] = parseQueue([
      {
        ...rawQ()[0]!,
        closureReason: 'no-follow-on',
        closureTarget: 'review.r1@x',
        blockedOn: 'human@kernel',
        humanIntent: 'approve',
        tier: 'fast',
      },
    ]);
    expect(q).toMatchObject({
      closureReason: 'no-follow-on',
      closureTarget: 'review.r1@x',
      blockedOn: 'human@kernel',
      humanIntent: 'approve',
      tier: 'fast',
    });
  });

  it('queue: omits (not null) empty, null or non-text values; a bad field blanks nothing', () => {
    const rows = parseQueue([
      { ...rawQ()[0]!, closureReason: '', closureTarget: null, blockedOn: { x: 1 }, tier: 5 },
    ]);
    expect(rows).toHaveLength(1);
    for (const k of ['closureReason', 'closureTarget', 'blockedOn', 'humanIntent', 'tier'])
      expect(k in rows[0]!).toBe(false);
  });

  it('queue: a new collector row still validates against the OLD row shape when nothing is new', () => {
    const OldRow = QueueItemSchema.omit({
      closureReason: true,
      closureTarget: true,
      blockedOn: true,
      humanIntent: true,
      tier: true,
    });
    const [q] = parseQueue([
      { ...rawQ()[0]!, closureReason: '', closureTarget: null, blockedOn: null, tier: null },
    ]);
    expect(OldRow.safeParse(q).success).toBe(true);
  });

  it('seat: attach and resume commands carried as text, omitted otherwise, valid against the OLD seat', () => {
    const raw = readFixtureJson(KERNEL) as Record<string, unknown>[];
    const withCmd = parseNodes(
      raw.map((n) => ({
        ...n,
        tmuxAttachCommand: 'tmux attach -t x@y',
        resumeCommand: "claude --resume 'abc'",
      }))
    );
    expect(withCmd[0]).toMatchObject({
      tmuxAttachCommand: 'tmux attach -t x@y',
      resumeCommand: "claude --resume 'abc'",
    });
    const bad = parseNodes(raw.map((n) => ({ ...n, tmuxAttachCommand: 12, resumeCommand: null })));
    expect(bad.length).toBe(raw.length);
    const OldSeat = SeatSchema.omit({ tmuxAttachCommand: true, resumeCommand: true });
    for (const s of bad) {
      expect('tmuxAttachCommand' in s || 'resumeCommand' in s).toBe(false);
      expect(OldSeat.safeParse(s).success).toBe(true);
    }
  });
});

describe('parseGraphEdges (D09 W2)', () => {
  it("d09-crew's real graph: three seat-to-seat edges by session name", () => {
    expect(parseGraphEdges(readFixtureJson('m2--api-rig-d09-crew-graph.json'))).toEqual([
      { from: 'dev-build@d09-crew', to: 'dev-qa@d09-crew', kind: 'delegates_to' },
      { from: 'dev-build@d09-crew', to: 'review-r1@d09-crew', kind: 'delegates_to' },
      { from: 'review-r1@d09-crew', to: 'dev-build@d09-crew', kind: 'can_observe' },
    ]);
  });

  it('an edge touching a node with no session (a pod) is left out, not guessed', () => {
    const raw = {
      nodes: [
        { id: 'pod-1', data: { canonicalSessionName: null } },
        { id: 'a', data: { canonicalSessionName: 'a@r' } },
      ],
      edges: [
        { id: 'e1', source: 'pod-1', target: 'a', label: 'delegates_to' },
        { id: 'e2', source: 'a', target: 'a', label: 'can_observe' },
        { id: 'e3', source: 'a', target: 'zz', label: 'delegates_to' },
      ],
    };
    expect(parseGraphEdges(raw)).toEqual([{ from: 'a@r', to: 'a@r', kind: 'can_observe' }]);
  });

  it('a shape it cannot read throws (the caller then leaves edges out)', () => {
    expect(() => parseGraphEdges({ nodes: 'x' })).toThrow(/graph/);
  });
});
