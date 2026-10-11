import { describe, expect, it } from 'vitest';
import { ASLEEP_AFTER_MS, type Seat } from '@appydave/shared';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import {
  ago,
  blockedBecause,
  blockedDetail,
  blockedLine,
  blockedSeats,
  countSeats,
  findSeat,
  freshness,
  contentTail,
  groupSeats,
  groupState,
  collapsedByDefault,
  modelChip,
  pipFor,
  seatName,
  stripAnsi,
  stripOsc,
  visibleTail,
} from './model.js';

const NOW = Date.parse('2026-10-09T14:00:00.000Z');
const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe('pipFor', () => {
  it('shows the seat status on a live machine', () => {
    const fm = fleetMachine(snapshot('roamy--blocked'));
    const blocked = fm.snapshot.seats.find((s) => s.status === 'blocked')!;
    expect(pipFor(blocked, fm)).toBe('blocked');
  });

  it('never shows idle (or any last status) on an asleep machine', () => {
    const fm = fleetMachine(snapshot('roamy'), { liveness: 'asleep' });
    const idle = fm.snapshot.seats.find((s) => s.status === 'idle')!;
    expect(pipFor(idle, fm)).toBe('asleep');
    expect(fm.snapshot.seats.every((s) => pipFor(s, fm) === 'asleep')).toBe(true);
  });
});

describe('freshness', () => {
  it('is live with the age of the last push', () => {
    const fm = fleetMachine(snapshot('roamy'), { lastSeen: at(2_000) });
    expect(freshness(fm, NOW, true)).toEqual({ level: 'live', label: 'live · 2s' });
  });

  it('is asleep with "last seen" when the hub says so', () => {
    const fm = fleetMachine(snapshot('roamy'), { liveness: 'asleep', lastSeen: at(4 * 60_000) });
    expect(freshness(fm, NOW, true)).toEqual({
      level: 'asleep',
      label: 'asleep · last seen 4m ago',
    });
  });

  it('turns stale, not live, when the push is older than the asleep threshold', () => {
    const fm = fleetMachine(snapshot('roamy'), { lastSeen: at(ASLEEP_AFTER_MS + 5_000) });
    expect(freshness(fm, NOW, true).level).toBe('stale');
  });

  it('turns stale when the hub connection is lost, however recent the push', () => {
    const fm = fleetMachine(snapshot('roamy'), { lastSeen: at(1_000) });
    expect(freshness(fm, NOW, false)).toEqual({
      level: 'stale',
      label: 'stale · hub offline · 1s',
    });
  });
});

describe('ago', () => {
  it.each([
    [-500, '0s'],
    [59_000, '59s'],
    [61_000, '1m'],
    [3 * 3600_000, '3h'],
    [72 * 3600_000, '3d'],
  ])('%i ms → %s', (ms, want) => expect(ago(ms)).toBe(want));
});

describe('modelChip', () => {
  const seat = (model: string | null, runtime: string | null) => ({ model, runtime }) as Seat;
  it('shortens Claude model ids', () => {
    expect(modelChip(seat('claude-opus-5-5', 'claude-code'))).toEqual({
      text: 'opus 5.5',
      family: 'opus',
    });
    expect(modelChip(seat('claude-fable-5-1', null))).toEqual({
      text: 'fable 5.1',
      family: 'fable',
    });
  });
  it('puts GPT models in the codex family', () => {
    expect(modelChip(seat('gpt-5.6-terra', 'codex')).family).toBe('codex');
  });
  it('falls back to the runtime, never inventing a model', () => {
    expect(modelChip(seat(null, 'claude-code'))).toEqual({ text: 'claude-code', family: 'other' });
    expect(modelChip(seat(null, null)).text).toBe('unknown');
  });
});

describe('groupSeats', () => {
  const machines = [fleetMachine(snapshot('m2')), fleetMachine(snapshot('roamy'))];

  it('by rig scopes a rig name to its machine', () => {
    const groups = groupSeats(machines, 'rig');
    const kernels = groups.filter((g) => g.name === 'kernel');
    expect(kernels.map((g) => g.where).sort()).toEqual(['M2', 'Roamy'].sort());
    expect(groups.find((g) => g.name === 'tmux sessions')?.tiles.map((t) => t.seat.id)).toEqual([
      'openrig-orch',
    ]);
  });

  it('D53: blocked groups first, then running, then all-stopped, then asleep', () => {
    const fleet = [
      fleetMachine(snapshot('m2')),
      fleetMachine(snapshot('roamy--blocked')),
      {
        ...fleetMachine(snapshot('roamy')),
        machine: { id: 'zz', label: 'ZZ', hostname: null },
        liveness: 'asleep' as const,
      },
    ];
    const ranks = groupSeats(fleet, 'rig').map((g) => `${g.where}:${g.name}`);
    expect(ranks[0]).toBe('Roamy:starter');
    expect(ranks.indexOf('Roamy:kernel')).toBeLessThan(ranks.indexOf('M2:control'));
    expect(ranks.slice(-3).every((r) => r.startsWith('ZZ:'))).toBe(true);
    expect(groupSeats(fleet, 'machine').map((g) => g.key)).toEqual(['roamy', 'm2', 'zz']);
  });

  it('S3: working before idle before stopped; newest activity first inside a rank', () => {
    const fm = fleetMachine(snapshot('m2'));
    const seat = (id: string, status: Seat['status'], rig: string, at: string | null) => ({
      ...fm.snapshot.seats[0]!,
      id,
      rig,
      status,
      lastActivityAt: at,
    });
    const fleet = [
      {
        ...fm,
        snapshot: {
          ...fm.snapshot,
          seats: [
            seat('a', 'stopped', 'old', '2026-10-11T09:00:00Z'),
            seat('b', 'idle', 'quiet', '2026-10-11T10:00:00Z'),
            seat('c', 'working', 'busy', '2026-10-11T08:00:00Z'),
            seat('d', 'idle', 'fresh', '2026-10-11T11:00:00Z'),
            seat('e', 'unknown', 'tmuxy', '2026-10-11T11:30:00Z'),
          ],
        },
      },
    ];
    const groups = groupSeats(fleet, 'rig');
    expect(groups.map((g) => g.name)).toEqual(['busy', 'fresh', 'quiet', 'tmuxy', 'old']);
    expect(groups.map(groupState)).toEqual(['working', 'idle', 'idle', 'unknown', 'stopped']);
    // S3 rework (variant C): idle-only teams start as cards in the idle strip.
    expect(groups.map(collapsedByDefault)).toEqual([false, true, true, false, true]);
  });

  it('S3: a rig group carries its RigSummary, so the Wall can show displayName and summary', () => {
    const fm = fleetMachine(snapshot('m2'));
    const named = {
      ...fm,
      snapshot: {
        ...fm.snapshot,
        rigs: fm.snapshot.rigs.map((r) =>
          r.name === 'fliedit-team' ? { ...r, displayName: 'FliEdit', summary: 'Edits videos.' } : r
        ),
      },
    };
    const g = groupSeats([named], 'rig').find((x) => x.name === 'fliedit-team')!;
    expect(g.rig?.displayName).toBe('FliEdit');
    expect(g.rig?.summary).toBe('Edits videos.');
    expect(g.key).toBe('m2:fliedit-team');
    expect(groupSeats([named], 'rig').find((x) => x.name === 'tmux sessions')?.rig).toBeUndefined();
  });

  it('keeps every seat exactly once, whichever grouping', () => {
    const total = machines.reduce((n, m) => n + m.snapshot.seats.length, 0);
    for (const by of ['rig', 'machine'] as const) {
      const keys = groupSeats(machines, by).flatMap((g) => g.tiles.map((t) => t.key));
      expect(keys).toHaveLength(total);
      expect(new Set(keys).size).toBe(total);
    }
  });
});

describe('counts and blocked', () => {
  it('counts live seats by status and asleep seats as paused', () => {
    const live = fleetMachine(snapshot('roamy--blocked'));
    const asleep = fleetMachine(snapshot('m2'), { liveness: 'asleep' });
    const c = countSeats([live, asleep]);
    expect(c.seats).toBe(25);
    expect(c.paused).toBe(18);
    expect(c.byStatus.blocked).toBe(1);
    expect(c.byStatus.stopped).toBe(0);
  });

  it('lists blocked seats on live machines only, with a plain reason', () => {
    const live = fleetMachine(snapshot('roamy--blocked'));
    const b = blockedSeats([live]);
    expect(b.map((t) => t.key)).toEqual(['roamy/dev-build@starter']);
    expect(blockedBecause(b[0].seat)).toBe('permission prompt');
    expect(blockedSeats([{ ...live, liveness: 'asleep' }])).toEqual([]);
  });

  it('finds a seat by its fleet key', () => {
    const fm = fleetMachine(snapshot('roamy'));
    expect(findSeat({ roamy: fm }, 'roamy/dev-build@starter')?.seat.id).toBe('dev-build@starter');
    expect(findSeat({ roamy: fm }, 'm2/dev-build@starter')).toBeNull();
  });
});

describe('blocked detail (S4)', () => {
  const seat = (blockedDetail: string | null | undefined) =>
    ({ blockedReason: 'permission prompt', blockedDetail }) as Seat;
  it('joins reason and the terminal question', () => {
    const s = seat('Allow this read outside the working directories?');
    expect(blockedDetail(s)).toBe('Allow this read outside the working directories?');
    expect(blockedLine(s)).toBe(
      'permission prompt — Allow this read outside the working directories?'
    );
  });
  it('r1 L2: strips escape sequences and stray control bytes', () => {
    const s = seat('\u001b[33mAllow this read\u001b[0m\u0007 outside\r\n the \u001bworking dirs?');
    expect(blockedDetail(s)).toBe('Allow this read outside the working dirs?');
    const controls = [...blockedDetail(s)!].filter((c) => c.charCodeAt(0) < 32 || c === '\u007f');
    expect(controls).toEqual([]);
  });
  it.each([null, undefined, '   ', '\u001b[0m\u0007'])(
    'reads %j as no detail: reason alone',
    (d) => {
      expect(blockedDetail(seat(d))).toBeNull();
      expect(blockedLine(seat(d))).toBe('permission prompt');
    }
  );
});

describe('text helpers', () => {
  it('seatName drops the rig', () => {
    expect(seatName({ id: 'dev-build@starter' } as Seat)).toBe('dev-build');
    expect(seatName({ id: 'openrig-orch' } as Seat)).toBe('openrig-orch');
  });
  it('stripOsc drops OSC 8 links (keeping text) and OSC 52 clipboard writes', () => {
    expect(stripOsc('a \u001b]8;;https://x\u0007link\u001b]8;;\u001b\\ b')).toBe('a link b');
    expect(stripOsc('x\u001b]52;c;ZXZpbA==\u0007y')).toBe('xy');
    expect(stripOsc('\u001b]0;title\u0007\u001b[1mbold\u001b[0m')).toBe('\u001b[1mbold\u001b[0m');
  });
  it('stripAnsi removes SGR and OSC sequences', () => {
    expect(stripAnsi('\u001b[1;38;2;255;222;89m❯ 1. Yes\u001b[0m')).toBe('❯ 1. Yes');
    expect(stripAnsi('\u001b]8;;http://x\u0007link\u001b]8;;\u0007')).toBe('link');
  });
  it('visibleTail drops trailing blank padding before taking the last n', () => {
    expect(visibleTail(['a', 'b', 'c', '', '\u001b[0m  ', ''], 2)).toEqual(['b', 'c']);
    expect(visibleTail(['', ''], 5)).toEqual([]);
  });
});

describe('contentTail (S3)', () => {
  it('drops the input box and footer under a turn, keeping the work above it', () => {
    const lines = [
      '⏺ Ran the tests: 147 passed.',
      '✻ Percolating… (7m 36s · ↓ 34.5k tokens)',
      '  └ Tip: Use /btw to ask a quick side question',
      '──────────────────────────────── dev-ui@appyrig-v14 ─',
      '❯ ',
      '────────────────────────────────────────────────────',
      '  ⏵⏵ auto mode on (shift+tab to cycle) · ← for agents',
      '',
    ];
    expect(contentTail(lines, 2)).toEqual([
      '⏺ Ran the tests: 147 passed.',
      '✻ Percolating… (7m 36s · ↓ 34.5k tokens)',
    ]);
  });
  it('drops Claude Code tips anywhere in the tail, and blank lines', () => {
    const lines = [
      'Bash(npx playwright test)',
      '',
      '  └ Tip: Use /btw to ask a quick side question without interrupting Claude’s',
      '    current work',
      '✻ Flowing… (1m 6s · ↓ 2.0k tokens)',
    ];
    expect(contentTail(lines, 3)).toEqual([
      'Bash(npx playwright test)',
      '✻ Flowing… (1m 6s · ↓ 2.0k tokens)',
    ]);
  });

  it('a screen that is all chrome falls back to the plain tail, never to nothing', () => {
    expect(contentTail(['❯ ', '  ⏵⏵ auto mode on (shift+tab to cycle)'], 3)).toHaveLength(2);
  });
});
