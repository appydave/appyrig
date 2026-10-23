import { type FleetMachine, type QueueItem, type SeatHistoryEvent } from '@appydave/shared';
import { bare } from '@client/domain/fleet/views/core/addresses.js';
import { rigQueue } from '@client/domain/fleet/views/core/queue.js';
import { ms } from '@client/domain/fleet/views/core/time.js';
import { type ConsoleLine } from '@client/domain/fleet/views/flow/types.js';

/**
 * One seat's console at replay time `at`: the handoffs it sent and received (always there: the queue
 * carries every handoff's message) merged with its transcript events (prompts, replies, tool calls)
 * when the collector sent its history. Oldest first, nothing after `at`.
 */
export function consoleLines({ seatName, rig, items, history, at }: ConsoleQuery): ConsoleLine[] {
  const me = (raw: string | null) => raw === `${seatName}@${rig}` || bare(raw) === seatName;
  const handoffs = items
    .filter((q) => ms(q.createdAt) <= at)
    .map((q) => handoffLine(q, me))
    .filter((line): line is ConsoleLine => line !== null);
  const events = (history ?? []).filter((e) => ms(e.at) <= at);

  return [...handoffs, ...events].sort((a, b) => a.at.localeCompare(b.at));
}

interface ConsoleQuery {
  seatName: string;
  rig: string;
  items: QueueItem[];
  history: SeatHistoryEvent[] | null;
  at: number;
}

/** One queue row as the seat sees it: sent, received, a note to self, or not its row at all (null). */
function handoffLine(q: QueueItem, me: (raw: string | null) => boolean): ConsoleLine | null {
  const msg = q.summary ?? '(no message)';
  const fromMe = me(q.source);
  const toMe = me(q.destination);

  if (fromMe && toMe) {
    return { at: q.createdAt, kind: 'sent', text: `↺ note to self: ${msg}` };
  }

  if (fromMe) {
    return { at: q.createdAt, kind: 'sent', text: `→ ${bare(q.destination)}: ${msg}` };
  }

  return toMe ? { at: q.createdAt, kind: 'received', text: `← ${bare(q.source)}: ${msg}` } : null;
}

/** A rig's handoffs in time order: the replay's single steps. */
export function replaySteps(fm: FleetMachine, rig: string): QueueItem[] {
  return [...rigQueue(fm, rig)].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
}
