import { describe, it, expect } from 'vitest';
import { FIVE_HOUR_MS, type AccountWindow } from '@appydave/shared';
import { windowStory } from './accountWindow.js';

const START = Date.parse('2026-10-11T08:30:00Z');
const w = (over: Partial<AccountWindow>): AccountWindow => ({
  status: 'reading',
  usedPct: 20,
  resetsAt: new Date(START + FIVE_HOUR_MS).toISOString(),
  windowMs: FIVE_HOUR_MS,
  startsAt: new Date(START).toISOString(),
  elapsedPct: 50,
  elapsedNowPct: 50,
  paceDeltaPct: -30,
  projectedPct: 40,
  ...over,
});
const at = (pct: number) => START + (pct / 100) * FIVE_HOUR_MS;

describe('windowStory (S5)', () => {
  it('plenty of room under 80% at reset, with % left and pace in words', () => {
    const s = windowStory(w({}), at(50));
    expect(s.kind).toBe('plenty');
    expect(s.text).toBe('plenty of room · ~40% by reset');
    expect(s.glyph).toBe('●');
    expect(s.leftPct).toBe(80);
    expect(s.pace).toBe('▼ 30 points behind the clock');
  });

  it('be careful from 80%, will run out from 100% with the time it would', () => {
    expect(windowStory(w({ usedPct: 45, paceDeltaPct: -5, projectedPct: 90 }), at(50)).kind).toBe(
      'careful'
    );
    // 60% used at 30% of the window: 100% is reached at 50% of the window = 11:00Z.
    const s = windowStory(
      w({ usedPct: 60, elapsedPct: 30, paceDeltaPct: 30, projectedPct: 200 }),
      at(31)
    );
    expect(s.kind).toBe('runs-out');
    expect(s.glyph).toBe('■');
    const expected = new Date(START + 0.5 * FIVE_HOUR_MS).toLocaleString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(s.text).toBe(`will run out ~${expected}`);
    expect(s.projectedPct).toBe(100);
  });

  it('a run-out time already in the past (old reading) is said as past, never promised', () => {
    // 60% at 30% gone: 100% at 50% of the window; the clock is now at 70%.
    const s = windowStory(
      w({ usedPct: 60, elapsedPct: 30, paceDeltaPct: 30, projectedPct: 200 }),
      at(70)
    );
    expect(s.kind).toBe('runs-out');
    expect(s.text).toMatch(/^likely ran out ~.* \(reading is older than that\)$/);
  });

  it('spent at 100%, too early under 5%, ended and no reading said in words', () => {
    expect(windowStory(w({ usedPct: 102 }), at(80)).kind).toBe('spent');
    expect(windowStory(w({ projectedPct: null, elapsedPct: 2 }), at(2)).text).toBe(
      'too early to tell · 20% used'
    );
    const ended = windowStory(w({ status: 'window-ended', elapsedPct: null }), at(120));
    expect(ended.kind).toBe('ended');
    expect(ended.nowPct).toBeNull();
    expect(windowStory(w({ status: 'no-reading', usedPct: null }), at(10)).text).toBe('no reading');
  });

  it('one point is singular (QA + r1 S5)', () => {
    expect(windowStory(w({ usedPct: 51, paceDeltaPct: 1, projectedPct: 102 }), at(50)).pace).toBe(
      '▲ 1 point ahead of the clock'
    );
  });

  it('the now tick follows the clock, not the reading', () => {
    expect(windowStory(w({ elapsedNowPct: 50 }), at(75)).nowPct).toBeCloseTo(75);
  });
});
