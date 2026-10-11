import type { FleetMachine, MachineHealth, Reading } from '@appydave/shared';

/**
 * v1.4 S6: machine health in words (mochaccino machine-health, B). The collector re-samples every
 * 30 s, so a reading older than three samples is marked old. A reading that could not be taken is
 * said as such, with its reason, never as 0.
 */
export const HEALTH_STALE_MS = 90_000;

export type PressureKind = 'normal' | 'warn' | 'critical' | 'unavailable' | 'no-data';

export interface PressureView {
  kind: PressureKind;
  glyph: string;
  /** Short words for the strip: "normal", "warning", "critical", "unavailable", "no health data yet". */
  word: string;
  /** Why there is no reading, when there is none. */
  reason: string | null;
}

export function pressureOf(fm: FleetMachine): PressureView {
  const h = fm.snapshot.health;
  if (!h) {
    return {
      kind: 'no-data',
      glyph: '–',
      word: 'no health data yet',
      reason: `${fm.machine.label}'s collector predates v1.4 and sends no health readings.`,
    };
  }
  const p = h.memory.pressureLevel;
  if (p.status === 'unavailable') {
    return { kind: 'unavailable', glyph: '–', word: 'pressure unavailable', reason: p.reason };
  }
  return p.value === 'normal'
    ? { kind: 'normal', glyph: '●', word: 'normal', reason: null }
    : p.value === 'warn'
      ? { kind: 'warn', glyph: '▲', word: 'warning', reason: null }
      : { kind: 'critical', glyph: '■', word: 'critical', reason: null };
}

export const healthAgeMs = (h: MachineHealth, now: number) =>
  Math.max(0, now - Date.parse(h.sampledAt));

export function gb(bytes: number): string {
  const g = bytes / 1024 ** 3;
  return g >= 100
    ? `${g.toFixed(0)} GB`
    : g >= 1
      ? `${Number(g.toFixed(1))} GB`
      : `${Math.round(bytes / 1024 ** 2)} MB`;
}

/** The value, or null; with the reason kept for a hover. */
export function value<T>(r: Reading<T>): { v: T | null; why: string | null } {
  return r.status === 'ok' ? { v: r.value, why: null } : { v: null, why: r.reason };
}
