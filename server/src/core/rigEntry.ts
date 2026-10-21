import type { RigEntry, SeatHistory, SeatHistoryEvent } from '@appydave/shared';

/**
 * v1.4 · S4: where did a rig's work come in? The first seat of the rig to act (reply or tool call),
 * and what woke it: the latest prompt before that first action. A nudge about a queued handoff
 * means the work came through the queue; a launch prompt, a direct message from another seat, or
 * text typed in means it did not. Prompts that are not a trigger (watchdog, compaction summary,
 * skill text) are looked past.
 *
 * Pure: histories in, answer out. It says `unknown` rather than guess whenever the history cannot
 * support an answer, and lists the seats it could not see.
 */

const TRIGGERS = new Set(['queue', 'send', 'typed', 'startup']);

interface FirstAct {
  seat: string;
  h: SeatHistory;
  actedAt: string;
  /** The prompt that woke it; null when no prompt precedes the action in the history we have. */
  trigger: SeatHistoryEvent | null;
}

function firstActOf(seat: string, h: SeatHistory): FirstAct | null {
  let trigger: SeatHistoryEvent | null = null;
  for (const e of h.events) {
    if (e.kind === 'prompt') {
      if (e.origin !== undefined && TRIGGERS.has(e.origin)) {
        trigger = e;
      }
    } else {
      return { seat, h, actedAt: e.at, trigger };
    }
  }

  return null;
}

export function rigEntryOf(
  seatIds: string[],
  historyOf: (seat: string) => SeatHistory | undefined
): RigEntry {
  const without: string[] = [];
  const histories: { seat: string; h: SeatHistory }[] = [];
  for (const seat of seatIds) {
    const h = historyOf(seat);
    if (h && h.events.length > 0) {
      histories.push({ seat, h });
    } else {
      without.push(seat);
    }
  }
  const unknown = (reason: string): RigEntry => ({
    status: 'unknown',
    reason,
    entry: null,
    seatsWithoutHistory: without,
  });

  if (histories.length === 0) {
    return unknown('no seat of this rig has history');
  }
  const prompts = histories.flatMap(({ h }) => h.events.filter((e) => e.kind === 'prompt'));
  if (prompts.length > 0 && prompts.every((e) => e.origin === undefined)) {
    return unknown('history has no prompt origin (collector older than v1.4)');
  }

  let best: FirstAct | null = null;
  for (const { seat, h } of histories) {
    const act = firstActOf(seat, h);
    if (act && (!best || Date.parse(act.actedAt) < Date.parse(best.actedAt))) {
      best = act;
    }
  }
  if (!best) {
    return unknown('no seat of this rig has acted yet');
  }
  // The earliest visible action wins even when we cannot see what woke it: skipping it would name a
  // later seat as "first" while this one visibly acted before it.
  if (!best.trigger) {
    return unknown(
      `${best.seat} acted first (${best.actedAt}) but what woke it is not in the history we have`
    );
  }

  // Dropped events are always OLDER than the window we hold, wherever that window starts, so a
  // truncated history can hide an earlier action on its seat. Not knowable, so not answered.
  const blind = histories.find(({ h }) => h.truncated);
  if (blind) {
    return unknown(`older events of ${blind.seat} were dropped; an earlier action may be missing`);
  }

  const trigger = best.trigger;
  const origin = trigger.origin!;

  return {
    status: origin === 'queue' ? 'via-queue' : 'outside-queue',
    reason: null,
    entry: {
      seat: best.seat,
      at: trigger.at,
      actedAt: best.actedAt,
      origin,
      excerpt: trigger.text || null,
    },
    seatsWithoutHistory: without,
  };
}
