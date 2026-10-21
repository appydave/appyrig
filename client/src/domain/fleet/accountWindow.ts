import type { AccountWindow } from '@appydave/shared';

/**
 * v1.4 S5: one usage window told against its reset, in words (mochaccino accounts-over-time, B).
 * Everything is worked out from the hub's derived window (usage, time gone and projection, all as
 * of the reading); only the "now" tick moves with the clock.
 */

/** A reading older than this gets an "old reading" mark. */
export const STALE_READING_MS = 15 * 60_000;
/** Projected use at reset from which the verdict turns to "be careful". */
export const CAREFUL_PCT = 80;

export type VerdictKind = 'plenty' | 'careful' | 'runs-out' | 'spent' | 'early' | 'ended' | 'none';

export interface WindowStory {
  kind: VerdictKind;
  /** Glyph + words, so the verdict never rests on colour alone. */
  glyph: string;
  text: string;
  /** Share left now (100 − used), or null without a reading. */
  leftPct: number | null;
  usedPct: number | null;
  /** Where the clock is in the window, 0–100, for the "now" tick; null without a live window. */
  nowPct: number | null;
  /** Projected use at reset, capped at 100 for drawing; null when too early or no reading. */
  projectedPct: number | null;
  /** "▲ 24 points ahead of the clock" / "▼ 29 points behind the clock", or null. */
  pace: string | null;
  resetsAt: string | null;
}

const hhmm = (ms: number, now: number) => {
  const d = new Date(ms);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return d.toLocaleString(undefined, {
    ...(sameDay ? {} : { weekday: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
  });
};

/** "1 point" / "24 points" (QA + r1 S5). */
const points = (d: number) => {
  const n = Math.round(d);
  return `${n} point${n === 1 ? '' : 's'}`;
};

export function windowStory(w: AccountWindow, now: number): WindowStory {
  const base = {
    leftPct: null,
    usedPct: w.usedPct,
    nowPct: null,
    projectedPct: null,
    pace: null,
    resetsAt: w.resetsAt,
  };
  if (w.status === 'no-reading' || w.usedPct === null) {
    return { ...base, kind: 'none', glyph: '–', text: 'no reading' };
  }
  if (w.status === 'window-ended') {
    return {
      ...base,
      kind: 'ended',
      glyph: '↻',
      text: `window ended${w.resetsAt ? ` at ${hhmm(Date.parse(w.resetsAt), now)}` : ''}; it starts fresh, no reading for the new one yet`,
    };
  }
  const start = w.startsAt ? Date.parse(w.startsAt) : null;
  const nowPct =
    start === null
      ? w.elapsedNowPct
      : Math.max(0, Math.min(100, ((now - start) / w.windowMs) * 100));
  const used = w.usedPct;
  const delta = w.paceDeltaPct;
  const story = {
    ...base,
    leftPct: Math.max(0, Math.round(100 - used)),
    nowPct,
    projectedPct: w.projectedPct === null ? null : Math.min(100, w.projectedPct),
    // C3 (F25): "68 points behind the clock" hid both numbers, so two accounts could read the same
    // and nobody could say what a point was. The line now shows what it compares, per account.
    pace:
      delta === null || w.elapsedPct === null
        ? null
        : `${Math.round(delta) === 0 ? '●' : delta > 0 ? '▲' : '▼'} ${Math.round(used)}% used, ${Math.round(w.elapsedPct)}% of the window gone: ${
            Math.round(delta) === 0
              ? 'on pace'
              : delta > 0
                ? `${points(delta)} over pace`
                : `${points(-delta)} to spare`
          }`,
  };
  const resetText = w.resetsAt ? hhmm(Date.parse(w.resetsAt), now) : 'the reset';
  if (used >= 100) {
    return { ...story, kind: 'spent', glyph: '■', text: `spent · resets ${resetText}` };
  }
  if (w.projectedPct === null) {
    return {
      ...story,
      kind: 'early',
      glyph: '○',
      text: `too early to tell · ${Math.round(used)}% used`,
    };
  }
  if (w.projectedPct >= 100) {
    // When use reaches 100% if the pace at the reading holds.
    let when = '';
    if (start !== null && w.elapsedPct && used > 0) {
      const at = start + (100 / used) * (w.elapsedPct / 100) * w.windowMs;
      // An old reading can project a time that has already gone: say so, don't promise the past.
      if (at <= now) {
        return {
          ...story,
          kind: 'runs-out',
          glyph: '■',
          text: `likely ran out ~${hhmm(at, now)} (reading is older than that)`,
        };
      }
      when = ` ~${hhmm(at, now)}`;
    }
    return { ...story, kind: 'runs-out', glyph: '■', text: `will run out${when}` };
  }
  if (w.projectedPct >= CAREFUL_PCT) {
    return {
      ...story,
      kind: 'careful',
      glyph: '▲',
      text: `be careful · ~${Math.round(w.projectedPct)}% by reset`,
    };
  }
  return {
    ...story,
    kind: 'plenty',
    glyph: '●',
    text: `plenty of room · ~${Math.round(w.projectedPct)}% by reset`,
  };
}
