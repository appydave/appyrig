import type { FleetMachine, QueueItem } from '@appydave/shared';
import { seatKey, seatName } from '../fleet/model.js';
import { buildTimeline, dotState, OUTSIDE_LANE, type Timeline } from '../fleet/timeline.js';
import { endpointRig, isOpen, STALE_MS } from '../fleet/views.js';

/**
 * v2 Run Timeline, read at a glance: the run's outcome, its phases (who did the work in each),
 * and who waited on whom. Pure, over the shared timeline model (buildTimeline) read-only.
 */

export type Outcome = 'running' | 'stalled' | 'stopped' | 'finished';

export const OUTCOME: Record<Outcome, { glyph: string; word: string; says: string }> = {
  running: {
    glyph: '●',
    word: 'running',
    says: 'Work is still moving: something was handed on in the last 2 h and is open.',
  },
  stalled: {
    glyph: '⌛',
    word: 'stalled',
    says: 'Work is open, but nothing open is younger than 2 h.',
  },
  stopped: {
    glyph: '■',
    word: 'hit a stop',
    says: 'The last phase ended on a refused, blocked or failed handoff.',
  },
  finished: {
    glyph: '✓',
    word: 'finished',
    says: 'Nothing is open: every handoff was done or passed on.',
  },
};

export interface PhaseView {
  index: number;
  start: number;
  end: number;
  count: number;
  /** Seats that sent in this phase, most first. */
  senders: { name: string; count: number }[];
  first: QueueItem;
  last: QueueItem;
}

export interface WaitRow {
  /** The seat that handed the work over, and so waited. */
  from: string;
  /** The seat it waited on. */
  to: string;
  count: number;
  /** Closed handoffs: created → last update. */
  medianMs: number | null;
  longestMs: number;
  open: number;
  /** Sum of every wait, closed and still open, for the sort. */
  totalMs: number;
}

export interface RunView {
  timeline: Timeline;
  outcome: Outcome;
  open: number;
  done: number;
  spanMs: number;
  activeMs: number;
  phases: PhaseView[];
  waits: WaitRow[];
  /** Lane name → seat key, for opening the agent panel. */
  seatOf: Record<string, string>;
}

const ms = (iso: string) => {
  const t = Date.parse(iso);

  return Number.isFinite(t) ? t : 0;
};
const bare = (raw: string | null) => (raw ?? '?').split('@')[0] ?? '?';

const median = (xs: number[]) => {
  if (!xs.length) {
    return null;
  }
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);

  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function buildRun(fm: FleetMachine, rig: string, now: number): RunView | null {
  const timeline = buildTimeline(fm, rig, now);
  if (!timeline) {
    return null;
  }
  const items = timeline.marks
    .filter((m, i, all) => all.findIndex((x) => x.item.id === m.item.id) === i)
    .map((m) => m.item);
  const open = items.filter(isOpen);
  const fresh = open.filter((q) => now - ms(q.createdAt) <= STALE_MS);
  const phases: PhaseView[] = timeline.phases.map((p) => {
    const inPhase = items.filter((q) => {
      const t = ms(q.createdAt);

      return t >= p.start && t <= p.end;
    });
    const count = new Map<string, number>();
    for (const q of inPhase) {
      count.set(bare(q.source), (count.get(bare(q.source)) ?? 0) + 1);
    }

    return {
      index: p.index,
      start: p.start,
      end: p.end,
      count: p.count,
      senders: [...count.entries()]
        .map(([name, n]) => ({ name, count: n }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      first: inPhase[0]!,
      last: inPhase[inPhase.length - 1]!,
    };
  });
  const lastPhase = phases[phases.length - 1];
  const outcome: Outcome = fresh.length
    ? 'running'
    : open.length
      ? 'stalled'
      : lastPhase && dotState(lastPhase.last.state) === 'stopped'
        ? 'stopped'
        : 'finished';

  // Who waited on whom: per sender → receiver, inside the rig (David and other rigs are flags, not seats).
  const inRig = (raw: string | null) => endpointRig(fm, raw) === rig;
  const pairs = new Map<
    string,
    { from: string; to: string; closed: number[]; open: number; all: number[] }
  >();
  for (const q of items) {
    if (!inRig(q.source) || !inRig(q.destination)) {
      continue;
    }
    const from = bare(q.source);
    const to = bare(q.destination);
    if (from === to) {
      continue;
    }
    const k = `${from}→${to}`;
    const p = pairs.get(k) ?? { from, to, closed: [], open: 0, all: [] };
    if (isOpen(q)) {
      p.open += 1;
      p.all.push(Math.max(0, now - ms(q.createdAt)));
    } else {
      const w = Math.max(0, ms(q.updatedAt) - ms(q.createdAt));
      p.closed.push(w);
      p.all.push(w);
    }
    pairs.set(k, p);
  }
  const waits: WaitRow[] = [...pairs.values()]
    .map((p) => ({
      from: p.from,
      to: p.to,
      count: p.closed.length + p.open,
      medianMs: median(p.closed),
      longestMs: Math.max(0, ...p.all),
      open: p.open,
      totalMs: p.all.reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.totalMs - a.totalMs || a.from.localeCompare(b.from));

  const seatOf: Record<string, string> = {};
  for (const s of fm.snapshot.seats) {
    if (s.rig === rig) {
      seatOf[seatName(s)] = seatKey(fm.machine.id, s.id);
    }
  }

  return {
    timeline,
    outcome,
    open: open.length,
    done: items.length - open.length,
    spanMs: timeline.end - timeline.start,
    activeMs: timeline.phases.reduce((n, p) => n + (p.end - p.start), 0),
    phases,
    waits,
    seatOf,
  };
}

/** "4 min", "2 h 10 min", "3 d 2 h". */
export function dur(msv: number | null): string {
  if (msv === null) {
    return '—';
  }
  const m = Math.round(msv / 60_000);
  if (m < 1) {
    return '<1 min';
  }
  if (m < 60) {
    return `${m} min`;
  }
  const h = Math.floor(m / 60);
  if (h < 48) {
    return `${h} h${m % 60 ? ` ${m % 60} min` : ''}`;
  }

  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export { OUTSIDE_LANE };
