import { plannedWord, type MapEdge } from '../../../fleet/views.js';

/** A box in the same coordinate space as the routed lines. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A routed line as RigMap's router returns it: the cubic's control points let a label slide along it. */
interface Routed {
  edge: MapEdge;
  lx: number;
  ly: number;
  c: [number, number, number, number, number, number, number, number];
}

const LABEL_H = 18;
const MARGIN = 2;
const SLIDE = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78, 0.15, 0.85, 0.1, 0.9];

const bez = (t: number, p0: number, p1: number, p2: number, p3: number) =>
  (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;

/** A planned line's label is its kind in words, so it is as wide as its text (as RigMap sizes it). */
export const plannedLabelW = (edge: MapEdge) =>
  edge.planned ? Math.round(plannedWord(edge.planned).length * 6.6 + 14) : 22;

const covers = (x: number, y: number, w: number, r: Rect) =>
  x - w / 2 < r.x + r.w + MARGIN &&
  x + w / 2 > r.x - MARGIN &&
  y - LABEL_H / 2 < r.y + r.h + MARGIN &&
  y + LABEL_H / 2 > r.y - MARGIN;

/**
 * L6: a planned line's word label must not sit on an agent card's text. Where its spot overlaps a
 * card it slides along its own line to the first spot that overlaps none; it stays put when there
 * is no clear spot (the line is still reachable). Handoff-count labels are left to RigMap's own
 * spreading.
 */
export function avoidCards<T extends Routed>(placed: T[], cards: Rect[]): T[] {
  return placed.map((p) => {
    if (!p.edge.planned) return p;
    const w = plannedLabelW(p.edge);
    if (!cards.some((r) => covers(p.lx, p.ly, w, r))) return p;
    const [x0, y0, x1, y1, x2, y2, x3, y3] = p.c;
    for (const t of SLIDE) {
      const x = bez(t, x0, x1, x2, x3);
      const y = bez(t, y0, y1, y2, y3);
      if (!cards.some((r) => covers(x, y, w, r))) return { ...p, lx: x, ly: y };
    }
    return p;
  });
}
