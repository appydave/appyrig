import type { AccountWindow } from '@appydave/shared';

/** Under this share of the window gone, a burn rate is noise (a few minutes of use, scaled up). */
export const MIN_ELAPSED_PCT = 3;

/**
 * Burn per hour at the reading: used ÷ time gone. Null without a reading, and null whenever the
 * shared verdict says "too early to tell" (no projection) or under MIN_ELAPSED_PCT of the window
 * is gone, so a number never sits next to "too early to tell". Also null when the window is past
 * its end (a stale reading).
 */
export function burnPerHour(w: AccountWindow | undefined | null): number | null {
  if (!w || w.status !== 'reading' || w.usedPct === null || w.elapsedPct === null) return null;
  if (w.projectedPct === null || w.elapsedPct < MIN_ELAPSED_PCT || w.elapsedPct > 100) return null;
  const hours = (w.elapsedPct / 100) * (w.windowMs / 3_600_000);
  return hours > 0 ? w.usedPct / hours : null;
}

/** Hours until the window is spent at that burn; null when it never is, it is spent already, or no honest burn. */
export function hoursToEmpty(w: AccountWindow | undefined | null): number | null {
  const b = burnPerHour(w);
  if (b === null || b <= 0 || !w || w.usedPct === null || w.usedPct >= 100) return null;
  return (100 - w.usedPct) / b;
}
