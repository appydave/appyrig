import { type FleetMachine, type QueueItem } from '@appydave/shared';
import { isOpen, rigQueue } from '@client/domain/fleet/views/core/queue.js';
import { MS_PER_MINUTE, STALE_MS, ms } from '@client/domain/fleet/views/core/time.js';
import { OUTSIDE } from '@client/domain/fleet/views/flow/stages.js';
import {
  type FlowEdge,
  type FlowOptions,
  type FlowRun,
  type FlowView,
} from '@client/domain/fleet/views/flow/types.js';
import { flowLayout } from '@client/domain/fleet/views/flow/layout.js';
import { bottleneckOf, stageViews } from '@client/domain/fleet/views/flow/stageViews.js';
import { median } from '@client/domain/fleet/views/core/stats.js';

/** The time range of a rig's queue, for the replay scrubber. */
export function flowRange(items: QueueItem[]): { start: number; end: number } | null {
  if (!items.length) {
    return null;
  }

  let start = Infinity;
  let end = -Infinity;

  for (const q of items) {
    start = Math.min(start, ms(q.createdAt));
    end = Math.max(end, ms(q.updatedAt));
  }

  return { start, end };
}

/** Verdicts that send work back. */
const SENT_BACK_VERDICTS = new Set(['changes', 'fail']);

/** The `verdict:<word>` tag on a handoff, lower-cased; null when it has none. */
function verdictOf(q: Pick<QueueItem, 'tags'>): string | null {
  const t = q.tags.find((x) => x.startsWith('verdict:'));

  return t ? t.slice('verdict:'.length).trim().toLowerCase() : null;
}

interface FlowQuery {
  fm: FleetMachine;
  rig: string;
  at: number;
  now: number;
  opts?: FlowOptions;
}

export function buildFlow(query: FlowQuery): FlowView | null {
  const { fm, rig, at, now } = query;
  const opts: FlowOptions = query.opts ?? {};
  const items = rigQueue(fm, rig);
  const range = flowRange(items);

  if (!range) {
    return null;
  }

  const run: FlowRun = {
    fm,
    rig,
    items,
    at,
    now,
    sentBack: opts.sentBack,
    byVerdict: opts.sentBack === 'verdict-or-stage' && items.some((q) => verdictOf(q) !== null),
    layout: flowLayout(fm, rig, items),
    edges: new Map<string, FlowEdge>(),
    waiting: new Map(),
    stale: new Map(),
    closedTurn: [],
    total: 0,
    rework: 0,
  };

  for (const q of items) {
    recordFlowHandoff(run, q);
  }

  return flowViewOf(run, range);
}

function flowViewOf(run: FlowRun, range: { start: number; end: number }): FlowView {
  const stages = stageViews(run);

  return {
    mode: run.layout.mode,
    start: range.start,
    end: range.end,
    at: run.at,
    stages,
    edges: [...run.edges.values()].filter((e) => e.from !== e.to),
    total: run.total,
    rework: run.rework,
    medianTurnaroundMin: median(run.closedTurn),
    closedCount: run.closedTurn.length,
    bottleneck: bottleneckOf(stages),
  };
}

function recordFlowHandoff(run: FlowRun, q: QueueItem): void {
  if (ms(q.createdAt) > run.at) {
    return;
  }

  run.total += 1;

  const from = run.layout.nodeOf(q.source);
  const to = run.layout.nodeOf(q.destination);
  const back = isSentBack(run, q, { from, to });

  if (back) {
    run.rework += 1;
  }

  const e = flowEdge(run.edges, { from, to }, back);

  markEdge(e, { back, counted: run.sentBack !== undefined });
  e.count += 1;
  e.items.push(q);
  settle(run, e, { q, to });
}

/**
 * By stage every item on one edge agrees; by verdict one sent-back item marks the edge, and `back`
 * (set only when a rule was asked for, `counted`) says how many of its items were.
 */
function markEdge(e: FlowEdge, sent: { back: boolean; counted: boolean }): void {
  if (sent.back) {
    e.rework = true;
  }

  if (sent.counted) {
    e.back = (e.back ?? 0) + (sent.back ? 1 : 0);
  }
}

function isSentBack(run: FlowRun, q: QueueItem, ends: { from: string; to: string }): boolean {
  if (run.byVerdict) {
    return SENT_BACK_VERDICTS.has(verdictOf(q) ?? '');
  }

  const { mode, order } = run.layout;

  return (
    mode === 'roles' &&
    order.indexOf(ends.to) < order.indexOf(ends.from) &&
    ends.to !== 'lead' &&
    ends.to !== OUTSIDE
  );
}

/** The line between two boxes, created (and remembered) on its first handoff. */
function flowEdge(
  edges: Map<string, FlowEdge>,
  ends: { from: string; to: string },
  back: boolean
): FlowEdge {
  const k = `${ends.from}→${ends.to}`;
  const e: FlowEdge = edges.get(k) ?? {
    from: ends.from,
    to: ends.to,
    count: 0,
    inFlight: [],
    items: [],
    rework: back,
  };

  edges.set(k, e);

  return e;
}

/** An item still in flight at the replay time waits (fresh) or is stale; a closed one adds its turnaround. */
function settle(run: FlowRun, e: FlowEdge, handoff: { q: QueueItem; to: string }): void {
  const { q, to } = handoff;
  const created = ms(q.createdAt);
  const closedAt = isOpen(q) ? run.now : ms(q.updatedAt);

  // Still open = still in flight, even when the replay time is "now".
  if (isOpen(q) || closedAt > run.at) {
    const bucket = run.at - created > STALE_MS ? run.stale : run.waiting;

    e.inFlight.push(q);
    bucket.set(to, [...(bucket.get(to) ?? []), q]);
  } else {
    run.closedTurn.push((closedAt - created) / MS_PER_MINUTE);
  }
}
