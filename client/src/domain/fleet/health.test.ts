import { describe, expect, it } from 'vitest';
import type { FleetMachine, MachineHealth } from '@appydave/shared';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { clockAheadText } from '@appydave/shared';
import { HEALTH_STALE_MS, healthAge, pressureOf } from './health.js';

const GB = 1024 ** 3;
const ok = <T>(value: T) => ({ status: 'ok' as const, value });

function machine(
  level: 'normal' | 'warn' | 'critical',
  swapUsedGb: number,
  swapTotalGb: number
): FleetMachine {
  const fm = fleetMachine(snapshot('m2'));
  const health = {
    sampledAt: new Date().toISOString(),
    memory: {
      totalBytes: ok(24 * GB),
      usedBytes: ok(19 * GB),
      pressureLevel: ok(level),
      freePct: ok(59),
      swapUsedBytes: ok(swapUsedGb * GB),
      swapTotalBytes: ok(swapTotalGb * GB),
    },
  } as unknown as MachineHealth;

  return { ...fm, snapshot: { ...fm.snapshot, health } };
}

describe('C2 (F26): the Machines badge tells the truth', () => {
  it("Roamy's case: macOS says normal, swap 12.8 of 14 GB (91%): under pressure, never green normal", () => {
    const p = pressureOf(machine('normal', 12.8, 14));

    expect(p).toMatchObject({ kind: 'critical', word: 'under pressure', glyph: '■' });
    expect(p.basis).toContain('macOS memory pressure says "normal"');
    expect(p.basis).toContain('swap 12.8 GB of 14 GB used (91%)');
    expect(p.basis).toContain('not based on "% free"');
  });

  it('swap above half is at least tight; the kernel level is never lowered by low swap', () => {
    expect(pressureOf(machine('normal', 8, 14)).word).toBe('tight');
    expect(pressureOf(machine('normal', 2, 14)).word).toBe('normal');
    expect(pressureOf(machine('warn', 0, 14)).word).toBe('tight');
    expect(pressureOf(machine('critical', 0, 14)).word).toBe('under pressure');
    expect(pressureOf(machine('normal', 0, 0)).word).toBe('normal'); // no swap allocated
  });
});

describe('F3 (resilience case 5): sample age survives a skewed collector clock', () => {
  const NOW = Date.parse('2026-10-13T04:00:00.000Z');
  const MIN = 60_000;
  // A push the hub received 2 s ago, from a machine whose clock is `skew` off the hub's; the health
  // reading was taken `before` ms before that push (on the machine's clock).
  const skewed = (skew: number, before: number): FleetMachine => {
    const fm = machine('normal', 1, 14);
    const receivedAt = NOW - 2_000;
    const collectedAt = receivedAt + skew;

    return {
      ...fm,
      lastSeen: new Date(receivedAt).toISOString(),
      snapshot: {
        ...fm.snapshot,
        collectedAt: new Date(collectedAt).toISOString(),
        health: { ...fm.snapshot.health!, sampledAt: new Date(collectedAt - before).toISOString() },
      },
    };
  };

  const age = (fm: FleetMachine) => healthAge(fm, fm.snapshot.health!, NOW);

  it('a clock 10 min behind: a fresh reading reads fresh, not "10m ago old reading"', () => {
    const a = age(skewed(-10 * MIN, 5_000));

    expect(a.ageMs).toBe(7_000);
    expect(a.ageMs).toBeLessThan(HEALTH_STALE_MS);
    expect(a.clockAhead).toBe(false);
  });

  it('a clock 15 min ahead: says "clock ahead 15 min", and an old reading is still old (never 0s)', () => {
    const fresh = age(skewed(15 * MIN, 5_000));

    expect(fresh.ageMs).toBe(7_000);
    expect(clockAheadText(fresh)).toBe('clock ahead 15 min');

    const old = age(skewed(15 * MIN, 2 * MIN));

    expect(old.ageMs).toBe(2 * MIN + 2_000);
    expect(old.ageMs).toBeGreaterThan(HEALTH_STALE_MS);
  });

  it('a few hundred ms of network delay is not a clock problem', () => {
    expect(clockAheadText(age(skewed(300, 1_000)))).toBeNull();
    expect(clockAheadText(age(skewed(-300, 1_000)))).toBeNull();
  });
});

describe('F4 (resilience: worst dishonesty): stale never looks green', () => {
  const NOW = Date.parse('2026-10-13T04:00:00.000Z');
  // A push the hub got `seen` ms ago, with a reading taken `before` ms before it (no clock skew).
  const at = (
    level: 'normal' | 'warn' | 'critical',
    swapGb: number,
    seen: number,
    before = 1_000
  ) => {
    const fm = machine(level, swapGb, 14);
    const received = NOW - seen;

    return {
      ...fm,
      lastSeen: new Date(received).toISOString(),
      snapshot: {
        ...fm.snapshot,
        collectedAt: new Date(received).toISOString(),
        health: { ...fm.snapshot.health!, sampledAt: new Date(received - before).toISOString() },
      },
    };
  };

  it('live and fresh: the real verdict, green when normal', () => {
    expect(pressureOf(at('normal', 1, 2_000), NOW)).toMatchObject({
      kind: 'normal',
      word: 'normal',
    });
  });

  it('c1, collector stopped (machine asleep): "○ asleep", the last verdict only on hover', () => {
    const fm = { ...at('normal', 1, 45_000), liveness: 'asleep' as const };
    const p = pressureOf(fm, NOW);

    expect(p).toMatchObject({ kind: 'stale', glyph: '○', word: 'asleep', last: 'normal' });
    expect(p.basis).toMatch(/Not current: the last reading, 46s ago, said "normal"/);
  });

  it('c3, a frozen feed (live pushes, reading 2 min old): "○ old reading", not green', () => {
    const p = pressureOf(at('normal', 1, 2_000, 2 * 60_000), NOW);

    expect(p).toMatchObject({ kind: 'stale', word: 'old reading', last: 'normal' });
  });

  it('Roamy at 92% swap is never "normal", and when stale it still says what it last was', () => {
    expect(pressureOf(at('normal', 12.88, 2_000), NOW)).toMatchObject({ kind: 'critical' });
    expect(pressureOf(at('normal', 12.88, 2_000, 10 * 60_000), NOW)).toMatchObject({
      kind: 'stale',
      last: 'critical',
    });
  });
});
