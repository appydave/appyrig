import { QUEUE_MAX_ITEMS, type FleetMachine, type QueueItem } from '@appydave/shared';
import { rigQueue } from '@client/domain/fleet/views/core/queue.js';

/** This machine's list reached the snapshot's cap, so its older rows are not here. */
export const queueCapped = (fm: FleetMachine): boolean =>
  fm.snapshot.queue.length >= QUEUE_MAX_ITEMS;

/**
 * The cap keeps the most recently updated rows, so the list is complete only from its oldest
 * update on: a row created after that was updated after it too. Null when nothing was cut.
 */
function queueCompleteSince(fm: FleetMachine): number | null {
  return queueCapped(fm)
    ? Math.min(...fm.snapshot.queue.map((q) => Date.parse(q.updatedAt)))
    : null;
}

/**
 * The rig's rows to tell a story in time from. A row created before the complete part is a
 * straggler kept for a late update: with the rows around it gone, a gap beside it means nothing.
 */
export function rigStoryQueue(fm: FleetMachine, rig: string): QueueItem[] {
  const since = queueCompleteSince(fm);
  const rows = rigQueue(fm, rig);

  return since === null ? rows : rows.filter((q) => Date.parse(q.createdAt) >= since);
}

/** What a screen must say when its list was cut; null when nothing was. */
export function queueCapNote(fm: FleetMachine): string | null {
  const since = queueCompleteSince(fm);

  if (since === null) {
    return null;
  }

  const from = new Date(since).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return `Only the newest ${QUEUE_MAX_ITEMS} handoffs on this machine are kept, so this shows work from ${from} on. Older handoffs are not here, and some may still be open.`;
}
