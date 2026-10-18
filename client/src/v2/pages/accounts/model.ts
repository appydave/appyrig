import type { AccountWindow } from '@appydave/shared';

/** Burn per hour at the reading: used ÷ time gone. Null without a reading. */
export function burnPerHour(w: AccountWindow | undefined | null): number | null {
  if (!w || w.status !== 'reading' || w.usedPct === null || !w.elapsedPct) return null;
  const hours = (w.elapsedPct / 100) * (w.windowMs / 3_600_000);
  return hours > 0 ? w.usedPct / hours : null;
}

/** Hours until the window is spent at that burn; null when it never is, or no reading. */
export function hoursToEmpty(w: AccountWindow | undefined | null): number | null {
  const b = burnPerHour(w);
  if (b === null || b <= 0 || !w || w.usedPct === null) return null;
  return Math.max(0, (100 - w.usedPct) / b);
}
