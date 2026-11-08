import { sampleAge, type FleetMachine, type MachineHealth, type SampleAge } from '@appydave/shared';

/**
 * v1.4 S6: machine health in words (mochaccino machine-health, B). The collector re-samples every
 * 30 s, so a reading older than three samples is marked old. A reading that could not be taken is
 * said as such, with its reason, never as 0.
 */
export const HEALTH_STALE_MS = 90_000;

export type PressureKind = 'normal' | 'warn' | 'critical' | 'unavailable' | 'no-data' | 'stale';

export interface PressureView {
  kind: PressureKind;
  glyph: string;
  /** Short words: "normal", "tight", "under pressure", "pressure unavailable", "no health data yet". */
  word: string;
  /** Why there is no reading, when there is none. */
  reason: string | null;
  /** C2: what the verdict is based on, in plain words, with the numbers (for the badge's hover). */
  basis: string | null;
  /** F4: on a stale pill, what the last reading said (normal / warn / critical); else absent. */
  last?: 'normal' | 'warn' | 'critical';
}

const BYTES_PER_GIB = 1024 ** 3;

/** C89: swap in use, never against a total: on macOS "total" is only what is allocated so far. */
export const swapAllocated = (bytes: number): string =>
  `${Number((bytes / BYTES_PER_GIB).toFixed(1))} GiB allocated`;

const WORD = { normal: 'normal', warn: 'tight', critical: 'under pressure' } as const;
const GLYPH = { normal: '●', warn: '▲', critical: '■' } as const;

/**
 * Fix-first F4 (resilience: worst dishonesty). The pill is tied to freshness and liveness: an
 * asleep machine, or a reading older than HEALTH_STALE_MS, never shows a coloured verdict. It reads
 * "○ asleep" or "○ old reading", greyed, and its hover keeps what the last reading said.
 */
export function pressureOf(fm: FleetMachine, now: number = Date.now()): PressureView {
  const v = verdictOf(fm);
  const h = fm.snapshot.health;

  if (!h || (v.kind !== 'normal' && v.kind !== 'warn' && v.kind !== 'critical')) {
    return v;
  }

  const asleep = fm.liveness === 'asleep';
  const age = healthAge(fm, h, now).ageMs;

  if (!asleep && age <= HEALTH_STALE_MS) {
    return v;
  }

  const when = ago(age);

  return {
    kind: 'stale',
    glyph: '○',
    word: asleep ? 'asleep' : 'old reading',
    reason: asleep
      ? `${fm.machine.label} has stopped reporting; its last memory reading is ${when} old.`
      : `The memory reading is ${when} old (readings come every 30 s).`,
    basis: `Not current: the last reading, ${when} ago, said "${v.word}". ${v.basis ?? ''}`,
    last: v.kind,
  };
}

const ago = (ms: number) => {
  const s = Math.round(ms / 1000);

  if (s < 90) {
    return `${s}s`;
  }

  const m = Math.round(s / 60);

  return m < 90 ? `${m} min` : `${Math.round(m / 60)} h`;
};

function verdictOf(fm: FleetMachine): PressureView {
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

  // C89: the kernel's level alone. vm.swapusage's total grows on demand up to free disk, so swap
  // used / total measures nothing, and it alarmed on healthy machines.
  const kind = p.value;
  const swap = h.memory.swapUsedBytes;
  const swapWords =
    swap.status === 'ok' ? `Swap: ${swapAllocated(swap.value)}` : 'Swap not readable';

  return {
    kind,
    glyph: GLYPH[kind],
    word: WORD[kind],
    reason: null,
    basis: `"${WORD[kind]}" is macOS memory pressure, the kernel's own level. ${swapWords}, which is not counted. It is not based on "% free".`,
  };
}

/**
 * F3 (resilience case 5): the readings' age on the collector's own clock, so a skewed clock neither
 * ages a fresh reading nor passes an old one off as "0s"; `clockAhead` says when it runs ahead.
 */
export const healthAge = (fm: FleetMachine, h: MachineHealth, now: number): SampleAge =>
  sampleAge(h.sampledAt, { collectedAt: fm.snapshot.collectedAt, receivedAt: fm.lastSeen }, now);
