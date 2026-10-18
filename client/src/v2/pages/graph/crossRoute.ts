import type { CrossEdge, GroupKey } from './model.js';

/** A rig frame's header box in canvas coordinates, and which machine column it is in. */
export interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
  col: number;
}

export interface CrossPlaced {
  edge: CrossEdge;
  d: string;
  lx: number;
  ly: number;
}

/** How far a same-column arc bulges past the frames, and the step between stacked arcs. */
const BULGE = 22;
const BULGE_STEP = 12;
/** Two directions on one pair sit this far apart, so both stay visible. */
const PAIR_GAP = 6;

const bez = (t: number, p0: number, p1: number, p2: number, p3: number) =>
  (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;

/**
 * Where each cross-rig line goes. Frames sit in machine columns; a line leaves from the side of
 * its rig's header facing the other rig. Two rigs in one column join by an arc bulging into the
 * gap on the right (longer spans bulge further, so arcs nest instead of crossing). Lines between
 * columns are curves across the gaps; their label sits in the first gap, never on a frame.
 */
export function routeCross(
  edges: CrossEdge[],
  box: (key: GroupKey) => FrameBox | null,
  gap: number
): CrossPlaced[] {
  const out: CrossPlaced[] = [];
  const both = new Set(edges.map((e) => `${e.from}→${e.to}`));
  // Same-column arcs: stacked by span, shortest closest to the frames.
  const same = edges
    .map((edge) => ({ edge, a: box(edge.from), b: box(edge.to) }))
    .filter(
      (x): x is { edge: CrossEdge; a: FrameBox; b: FrameBox } =>
        !!x.a && !!x.b && x.a.col === x.b.col
    )
    .sort((x, y) => Math.abs(x.a.y - x.b.y) - Math.abs(y.a.y - y.b.y));
  const levels = new Map<number, [number, number][][]>();
  for (const { edge, a, b } of same) {
    const shift = both.has(`${edge.to}→${edge.from}`)
      ? (edge.from < edge.to ? -1 : 1) * PAIR_GAP
      : 0;
    const sy = a.y + a.h / 2 + shift;
    const ey = b.y + b.h / 2 + shift;
    const lo = Math.min(sy, ey);
    const hi = Math.max(sy, ey);
    const colLevels = levels.get(a.col) ?? [];
    let level = colLevels.findIndex((iv) => iv.every(([l, h]) => hi < l - 4 || lo > h + 4));
    if (level === -1) {
      level = colLevels.length;
      colLevels.push([]);
    }
    colLevels[level]!.push([lo, hi]);
    levels.set(a.col, colLevels);
    const sx = a.x + a.w;
    const ex = b.x + b.w;
    const cx = Math.max(sx, ex) + BULGE + level * BULGE_STEP;
    // a cubic with both handles at cx peaks at 3/4 of the way out
    const hx = sx + ((cx - sx) * 4) / 3;
    out.push({
      edge,
      d: `M${sx},${sy} C${hx},${sy} ${hx},${ey} ${ex},${ey}`,
      lx: bez(0.5, sx, hx, hx, ex),
      ly: (sy + ey) / 2,
    });
  }
  // Across columns.
  for (const edge of edges) {
    const a = box(edge.from);
    const b = box(edge.to);
    if (!a || !b || a.col === b.col) continue;
    const right = b.col > a.col;
    const shift = both.has(`${edge.to}→${edge.from}`)
      ? (edge.from < edge.to ? -1 : 1) * PAIR_GAP
      : 0;
    const sx = right ? a.x + a.w : a.x;
    const ex = right ? b.x : b.x + b.w;
    const sy = a.y + a.h / 2 + shift;
    const ey = b.y + b.h / 2 + shift;
    const dx = Math.max(30, Math.abs(ex - sx) / 2);
    const c1 = right ? sx + dx : sx - dx;
    const c2 = right ? ex - dx : ex + dx;
    // Label in the first gap: the point along the curve half a gap out from the start.
    const target = right ? sx + gap / 2 : sx - gap / 2;
    let t = 0.5;
    for (let i = 1; i < 40; i++) {
      const x = bez(i / 40, sx, c1, c2, ex);
      if (right ? x >= target : x <= target) {
        t = i / 40;
        break;
      }
    }
    out.push({
      edge,
      d: `M${sx},${sy} C${c1},${sy} ${c2},${ey} ${ex},${ey}`,
      lx: bez(t, sx, c1, c2, ex),
      ly: bez(t, sy, sy, ey, ey),
    });
  }
  return out;
}
