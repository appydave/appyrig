import { describe, expect, it } from 'vitest';
import type { FleetMachine, MachineHealth } from '@appydave/shared';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { clockAheadText } from '@appydave/shared';
import { swapAllocated } from '@client/lib/readings.js';
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

describe('C89: the badge is the kernel pressure level, and swap never moves it', () => {
  it("Roamy's case: macOS says normal, swap 12.8 of 14 GB: normal, with swap only as allocated", () => {
    const p = pressureOf(machine('normal', 12.8, 14));

    expect(p).toMatchObject({ kind: 'normal', word: 'normal', glyph: '●' });
    expect(p.basis).toContain('macOS memory pressure');
    expect(p.basis).toContain('12.8 GiB allocated');
    expect(p.basis).not.toMatch(/\d\s*%|14 G/);
  });

  const SWAP: [number, number][] = [
    [0, 0],
    [0, 14],
    [8, 14],
    [12.8, 14],
    [14, 14],
    [200, 200],
  ];

  it.each(['normal', 'warn', 'critical'] as const)('kernel says %s: so does the badge', (level) => {
    for (const [used, total] of SWAP) {
      expect(pressureOf(machine(level, used, total)).kind, `${used}/${total}`).toBe(level);
    }
  });

  it('no alarm in the client can divide swap used by swap total: nothing reads the total', () => {
    const sources = import.meta.glob<string>(
      ['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}', '!../../test/**'],
      {
        query: '?raw',
        import: 'default',
        eager: true,
      }
    );
    const readers = Object.keys(sources).filter((f) => /swapTotal/.test(sources[f]!));

    expect(Object.keys(sources).length).toBeGreaterThan(100); // the glob really saw the client
    expect(readers).toEqual([]);
  });

  it('swap shows as GiB allocated', () => {
    expect(swapAllocated(12.8 * GB)).toBe('12.8 GiB allocated');
    expect(swapAllocated(0)).toBe('0 GiB allocated');
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

  it('when stale it still says what the last reading was', () => {
    expect(pressureOf(at('critical', 12.88, 2_000), NOW)).toMatchObject({ kind: 'critical' });
    expect(pressureOf(at('critical', 12.88, 2_000, 10 * 60_000), NOW)).toMatchObject({
      kind: 'stale',
      last: 'critical',
    });
  });
});
