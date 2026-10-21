/**
 * Fix-first F3 (resilience case 5): sample ages that a skewed collector clock cannot fake.
 *
 * Every time a collector stamps (`sampledAt`, `collectedAt`) is on ITS clock; the hub's receive
 * time (`lastSeen`) is on the hub's. An age measured as hub-now minus `sampledAt` is off by the
 * skew: a clock 10 minutes behind reads a fresh sample as "10 min old", one 15 minutes ahead is
 * clamped to "0 s" and looks fresh. So an age is measured on the collector's own clock,
 * `collectedAt − sampledAt` (both its stamps), plus the time since the hub received that push.
 */

/** A collector clock this far ahead of the hub's is said to be ahead; below it is network delay. */
export const CLOCK_AHEAD_MS = 5_000;

/** The collector's clock minus the hub's, seen on one push: positive = the collector runs ahead. */
export function clockSkewMs(collectedAt: string, receivedAt: string): number {
  return Date.parse(collectedAt) - Date.parse(receivedAt);
}

export interface SampleAge {
  /** How old the sample is now, skew removed. */
  ageMs: number;
  /** The collector's clock is CLOCK_AHEAD_MS or more ahead of the hub's: show "clock ahead". */
  clockAhead: boolean;
  skewMs: number;
}

/**
 * The age now of a time the collector stamped, given the push it came in (its `collectedAt`, and the
 * hub's `receivedAt` for it). Never clamped to hide a skew: only a sample stamped after its own push
 * (impossible on one clock) floors at 0.
 */
export function sampleAge(
  sampledAt: string,
  push: { collectedAt: string; receivedAt: string },
  now: number
): SampleAge {
  const skewMs = clockSkewMs(push.collectedAt, push.receivedAt);
  const onCollector = Math.max(0, Date.parse(push.collectedAt) - Date.parse(sampledAt));

  return {
    ageMs: onCollector + Math.max(0, now - Date.parse(push.receivedAt)),
    clockAhead: skewMs >= CLOCK_AHEAD_MS,
    skewMs,
  };
}

/** "clock ahead 15 min" for a label; null when the clock is not ahead. */
export function clockAheadText(a: SampleAge): string | null {
  if (!a.clockAhead) {
    return null;
  }

  const s = Math.round(a.skewMs / 1000);

  return s < 120 ? `clock ahead ${s}s` : `clock ahead ${Math.round(s / 60)} min`;
}

/** A time the collector stamped, moved onto the hub's clock (for maths against hub-now or a reset). */
export function onHubClock(at: string, push: { collectedAt: string; receivedAt: string }): string {
  return new Date(Date.parse(at) - clockSkewMs(push.collectedAt, push.receivedAt)).toISOString();
}
