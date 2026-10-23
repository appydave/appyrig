/** An open item older than this is stale: left behind, not a queue building up. */
const MS_PER_SECOND = 1000;

const SECONDS_PER_MINUTE = 60;

const MINUTES_PER_HOUR = 60;

const HOURS_PER_DAY = 24;

export const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;

const STALE_HOURS = 2;

/** How long an open item can sit before it counts as left behind rather than waiting. */
export const STALE_MS = STALE_HOURS * MINUTES_PER_HOUR * MS_PER_MINUTE;

export const ms = (iso: string) => Date.parse(iso);

/** "in 2h 10m" / "now" for a reset time. */
export function resetsIn(iso: string | null, now: number): string | null {
  if (!iso) {
    return null;
  }

  const m = Math.round((ms(iso) - now) / MS_PER_MINUTE);

  if (m <= 0) {
    return 'now';
  }

  const h = Math.floor(m / MINUTES_PER_HOUR);
  const d = Math.floor(h / HOURS_PER_DAY);

  if (d >= 1) {
    return `in ${d}d ${h % HOURS_PER_DAY}h`;
  }

  return h ? `in ${h}h ${m % MINUTES_PER_HOUR}m` : `in ${m}m`;
}
