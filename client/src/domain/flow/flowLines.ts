import type { FlowEdge } from '@client/domain/fleet/views/flow/types.js';
import { STALE_MS } from '@client/domain/fleet/views/core/time.js';
import { mergePairs, pairKey, type LinePair } from '@client/domain/lines/handoffLines.js';

/**
 * Handoff Flow v2 on the kit's one line style (brief 2026-10-19, handoff lines): one line per pair
 * of boxes, both directions in its label ("14 ⇄ 8"), the width from absolute counts (the kit's
 * `lineWidth`), and "still waiting" / "left open" as badges, never a line style.
 */

/** A pair of boxes with everything the Flow needs to draw and open it. */
export interface FlowPair extends LinePair {
  /** `pair:<a>|<b>`, the panel and Tab key for the line. */
  key: string;
  /** The directed edges it merges (one or two), for the panel's item list. */
  edges: FlowEdge[];
  /** Of the handoffs, how many went back to an earlier stage (roles mode). */
  back: number;
}

export const flowPairKey = (a: string, b: string) => {
  const [x, y] = a < b ? [a, b] : [b, a];

  return `pair:${x}|${y}`;
};

/**
 * Merge the Flow's directed edges into pairs. An item still in flight at `at` counts as waiting
 * when it was handed over within STALE_MS of `at`, and as left open after that.
 */
export function flowPairs(edges: FlowEdge[], at: number): FlowPair[] {
  const aged = (e: FlowEdge, stale: boolean) =>
    e.inFlight.filter((q) => at - Date.parse(q.createdAt) > STALE_MS === stale).length;
  const pairs = mergePairs(
    edges.map((e) => ({
      from: e.from,
      to: e.to,
      count: e.count,
      open: aged(e, false),
      stale: aged(e, true),
    }))
  );

  return pairs.map((p) => {
    const mine = edges.filter(
      (e) => pairKey(e.from, e.to) === pairKey(p.a, p.b) && e.from !== e.to
    );

    return {
      ...p,
      key: flowPairKey(p.a, p.b),
      edges: mine,
      back: mine.reduce((n, e) => n + (e.back ?? (e.rework ? e.count : 0)), 0),
    };
  });
}

export interface PairGeometry {
  d: string;
  /** Where the count label sits. */
  lx: number;
  ly: number;
  /** The two ends, left box first, for the badges. */
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** True when the left box is `a` (so a→b runs left to right). */
  aLeft: boolean;
}

/**
 * One path per pair, always drawn from the left box to the right one: a straight line between
 * neighbours, an arc above the row for pairs further apart (higher the further apart, so nested
 * arcs never share a height). `level` lifts an arc further when a screen needs it.
 */
export function pairPath(
  p: Pick<LinePair, 'a' | 'b'>,
  L: { x: (id: string) => number; idx: (id: string) => number; boxW: number },
  rowY: number,
  boxH: number,
  level = 0
): PairGeometry {
  const aLeft = L.idx(p.a) <= L.idx(p.b);
  const [l, r] = aLeft ? [p.a, p.b] : [p.b, p.a];
  const x1 = L.x(l);
  const x2 = L.x(r);
  const gap = Math.abs(L.idx(r) - L.idx(l));

  if (gap <= 1) {
    const s = { x: x1 + L.boxW / 2, y: rowY };
    const e = { x: x2 - L.boxW / 2, y: rowY };

    return {
      d: `M${s.x},${s.y} L${e.x},${e.y}`,
      lx: (s.x + e.x) / 2,
      // The gap between neighbours is narrower than a label: it sits just above the boxes.
      ly: rowY - boxH / 2 - 12,
      start: s,
      end: e,
      aLeft,
    };
  }

  const y0 = rowY - boxH / 2;
  const rise = 40 + gap * 30 + level * 26;
  const s = { x: x1, y: y0 };
  const e = { x: x2, y: y0 };

  return {
    d: `M${s.x},${s.y} C${s.x},${y0 - rise} ${e.x},${y0 - rise} ${e.x},${e.y}`,
    lx: (x1 + x2) / 2,
    ly: y0 - rise * 0.75 - 4,
    start: s,
    end: e,
    aLeft,
  };
}
