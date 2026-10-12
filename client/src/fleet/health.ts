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
  /** Short words: "normal", "tight", "under pressure", "pressure unavailable", "no health data yet". */
  word: string;
  /** Why there is no reading, when there is none. */
  reason: string | null;
  /** C2: what the verdict is based on, in plain words, with the numbers (for the badge's hover). */
  basis: string | null;
}

/** C2: swap used ≥ this share of swap total makes a machine at least "tight". */
export const SWAP_TIGHT = 0.5;
/** …and ≥ this share, "under pressure". */
export const SWAP_PRESSURE = 0.8;

const RANK: Record<'normal' | 'warn' | 'critical', number> = { normal: 0, warn: 1, critical: 2 };
const WORD = { normal: 'normal', warn: 'tight', critical: 'under pressure' } as const;
const GLYPH = { normal: '●', warn: '▲', critical: '■' } as const;

export function pressureOf(fm: FleetMachine): PressureView {
  const h = fm.snapshot.health;
  if (!h) {
    return {
      kind: 'no-data',
      glyph: '–',
      word: 'no health data yet',
      reason: `${fm.machine.label}'s collector predates v1.4 and sends no health readings.`,
      basis: null,
    };
  }
  const p = h.memory.pressureLevel;
  if (p.status === 'unavailable') {
    return {
      kind: 'unavailable',
      glyph: '–',
      word: 'pressure unavailable',
      reason: p.reason,
      basis: null,
    };
  }
  // Batch 2 · C2 (F26): macOS's own pressure level said "normal" for a Mac with swap 91% full,
  // shown in green beside "59% free". The verdict now takes the worse of the kernel's level and
  // swap use, so a machine swapping above half its swap can never read "normal".
  const used = h.memory.swapUsedBytes;
  const total = h.memory.swapTotalBytes;
  const share =
    used.status === 'ok' && total.status === 'ok' && total.value > 0
      ? used.value / total.value
      : null;
  const fromSwap: 'normal' | 'warn' | 'critical' =
    share === null
      ? 'normal'
      : share >= SWAP_PRESSURE
        ? 'critical'
        : share >= SWAP_TIGHT
          ? 'warn'
          : 'normal';
  const kind = RANK[fromSwap] > RANK[p.value] ? fromSwap : p.value;
  const swapWords =
    share === null
      ? 'swap use not readable'
      : `swap ${gb(used.status === 'ok' ? used.value : 0)} of ${gb(total.status === 'ok' ? total.value : 0)} used (${Math.round(share * 100)}%)`;
  return {
    kind,
    glyph: GLYPH[kind],
    word: WORD[kind],
    reason: null,
    basis: `"${WORD[kind]}" is the worse of two readings: macOS memory pressure says "${WORD[p.value]}" (the kernel's own level), and ${swapWords}; swap at ${SWAP_TIGHT * 100}% or more is at least "tight", at ${SWAP_PRESSURE * 100}% or more "under pressure". It is not based on "% free".`,
  };
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
