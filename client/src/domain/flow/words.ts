import type { RigEntry } from '@appydave/shared';

// Words for the Handoff Flow page: the median handoff time and how a rig's first seat was woken.

/**
 * Batch 1 · B3 (fb-0006, "3.1-minute median handoff: what's that really telling me?"): the stat
 * as one plain sentence. It is a median (the middle value), not a grade: there are no thresholds.
 */
export function medianSentence(min: number | null, closed: number): string {
  if (min === null || closed === 0) {
    return 'No handoff in this rig has been closed yet, so there is no typical time to show.';
  }

  const t = min < 1 ? `${Math.round(min * 60)} seconds` : `${min.toFixed(1)} minutes`;

  return closed === 1
    ? `The one handoff closed so far took ${t} from being handed over to being closed.`
    : `Of the ${closed} handoffs closed so far, half were closed within ${t} of being handed over and half took longer (the median, the middle value). It is not a grade: there are no thresholds. Handoffs still open are not counted; they show as waiting or left open.`;
}

/**
 * S4: how the first seat to act was woken, in calm words. Nearly every rig starts at launch,
 * which is normal, so that case reads as a fact, not an alarm.
 */
export function entryWords(e: RigEntry): string | null {
  if (e.status === 'unknown' || !e.entry) {
    return null;
  }

  if (e.status === 'via-queue') {
    return 'came in through the queue';
  }

  switch (e.entry.origin) {
    case 'startup':
      return 'started at launch, not via the queue';
    case 'typed':
      return 'a prompt typed into the seat, not via the queue';
    case 'send':
      return 'a direct message from another seat, not via the queue';
    case 'system':
      return 'an OpenRig system message, not via the queue';
    case 'compaction':
      return 'resumed after a context compaction, not via the queue';
    case 'skill':
      return "a skill's instructions, not via the queue";
    default:
      return 'not via the queue';
  }
}
