/** The seat line inside a Handoff Flow box: what it says, cut to fit, models said once. */

// A box line is 11px text: about this many units a letter, inside this much side padding.
const CHAR_UNITS = 5.2;
const SIDE_PAD = 16;
const MIN_CHARS = 8;

/** A box line cut to what fits the box, with an ellipsis. */
export function fitText(text: string, boxW: number): string {
  const max = Math.max(MIN_CHARS, Math.floor((boxW - SIDE_PAD) / CHAR_UNITS));

  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** What a box says about its seats: the full line (for its title) and the short one (models said once). */
export function seatsLine(
  models: readonly string[],
  empty: string
): { full: string; short: string } {
  const full = models.length ? models.join(' · ') : empty;

  return { full, short: models.length ? [...new Set(models)].join(' · ') : empty };
}

/** What a box with no seat says in the seat line. */
export function emptySeatsWord(
  s: { noLead?: boolean; outside?: boolean; stage: string },
  roles: boolean
): string {
  if (s.noLead) {
    return 'no lead seat in this rig';
  }

  if (s.outside) {
    return roles ? 'orchestrator, David or another rig' : 'outside this rig';
  }

  return s.stage === 'others' ? 'quieter seats' : 'no seat';
}
