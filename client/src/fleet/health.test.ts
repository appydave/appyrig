import { describe, expect, it } from 'vitest';
import type { FleetMachine, MachineHealth } from '@appydave/shared';
import { fleetMachine, snapshot } from '../test/fleetFixtures.js';
import { pressureOf } from './health.js';

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
