import { describe, expect, it } from 'vitest';
import { ASLEEP_AFTER_MS, type Seat } from '@appydave/shared';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import {
  ago,
  blockedBecause,
  blockedSeats,
  countSeats,
  findSeat,
  freshness,
  groupSeats,
  modelChip,
  pipFor,
  seatName,
  stripAnsi,
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

describe('text helpers', () => {
  it('seatName drops the rig', () => {
    expect(seatName({ id: 'dev-build@starter' } as Seat)).toBe('dev-build');
    expect(seatName({ id: 'openrig-orch' } as Seat)).toBe('openrig-orch');
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
