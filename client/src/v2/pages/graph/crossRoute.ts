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
/** A count label's height (as RigMap draws it). */
export const LABEL_H = 18;
/**
 * Two directions on one pair sit this far apart (each shifted half of it), at least a label's
 * height, so the two count labels never sit on top of each other.
 */
export const PAIR_GAP = LABEL_H + 2;
/** A count label's width. */
const LABEL_W = 26;

const bez = (t: number, p0: number, p1: number, p2: number, p3: number) =>
  (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;

type Side = 'l' | 'r';

/**
 * Where each cross-rig line goes. Frames sit in machine columns; a line leaves from the side of
 * its rig's header facing the other rig, and arrives at the side of the other. Lines that meet one
 * frame side are spread along that header (ordered by where their other end is), so ten lines
 * never leave from one point and can be followed end to end. Two rigs in one column join by an arc
 * bulging into the gap on the right (longer spans bulge further, so arcs nest instead of
 * crossing). Lines between columns are curves across the gaps; their label sits in the first gap,
 * never on a frame.
 */
export function routeCross(
  edges: CrossEdge[],
  box: (key: GroupKey) => FrameBox | null,
  gap: number
): CrossPlaced[] {
  const out: CrossPlaced[] = [];
  /** Each line's point at t, so a label that lands on another can slide along its own line. */
  const curveAt = new Map<CrossPlaced, (t: number) => [number, number]>();
  const both = new Set(edges.map((e) => `${e.from}→${e.to}`));
  const k = (e: CrossEdge) => `${e.from}→${e.to}`;
  const drawn = edges.flatMap((edge) => {
    const a = box(edge.from);
    const b = box(edge.to);
    return a && b ? [{ edge, a, b }] : [];
  });
  // the side each end uses
  const sides = (a: FrameBox, b: FrameBox): [Side, Side] =>
    a.col === b.col ? ['r', 'r'] : b.col > a.col ? ['r', 'l'] : ['l', 'r'];
  // slot per (frame side, edge end): lines on one side ordered by their other end's height
  const ends = new Map<string, { id: string; other: number }[]>();
  for (const { edge, a, b } of drawn) {
    const [sa, sb] = sides(a, b);
    for (const [key, side, role, other] of [
      [edge.from, sa, 'f', b.y],
      [edge.to, sb, 't', a.y],
    ] as const) {
      const id = `${key}|${side}`;
      ends.set(id, [...(ends.get(id) ?? []), { id: `${k(edge)}|${role}`, other }]);
    }
  }
  const slotY = (frame: FrameBox, key: GroupKey, side: Side, lineId: string) => {
    const list = (ends.get(`${key}|${side}`) ?? [])
      .slice()
      .sort((x, y) => x.other - y.other || x.id.localeCompare(y.id));
    const i = Math.max(
      0,
      list.findIndex((x) => x.id === lineId)
    );
    return frame.y + (frame.h * (i + 1)) / (list.length + 1);
  };
  const pairShift = (edge: CrossEdge) =>
    both.has(`${edge.to}→${edge.from}`) ? ((edge.from < edge.to ? -1 : 1) * PAIR_GAP) / 2 : 0;

  // Same-column arcs: stacked by span, shortest closest to the frames.
  const same = drawn
    .filter((x) => x.a.col === x.b.col)
    .sort((x, y) => Math.abs(x.a.y - x.b.y) - Math.abs(y.a.y - y.b.y));
  const levels = new Map<number, [number, number][][]>();
  for (const { edge, a, b } of same) {
    const shift = pairShift(edge);
    const sy = slotY(a, edge.from, 'r', `${k(edge)}|f`) + shift;
    const ey = slotY(b, edge.to, 'r', `${k(edge)}|t`) + shift;
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
    const arc: CrossPlaced = {
      edge,
      d: `M${sx},${sy} C${hx},${sy} ${hx},${ey} ${ex},${ey}`,
      lx: bez(0.5, sx, hx, hx, ex),
      ly: (sy + ey) / 2,
    };
    out.push(arc);
  }
  // Across columns.
  for (const { edge, a, b } of drawn) {
    if (a.col === b.col) continue;
    const right = b.col > a.col;
    const shift = pairShift(edge);
    const sx = right ? a.x + a.w : a.x;
    const ex = right ? b.x : b.x + b.w;
    const sy = slotY(a, edge.from, right ? 'r' : 'l', `${k(edge)}|f`) + shift;
    const ey = slotY(b, edge.to, right ? 'l' : 'r', `${k(edge)}|t`) + shift;
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
    const across: CrossPlaced = {
      edge,
      d: `M${sx},${sy} C${c1},${sy} ${c2},${ey} ${ex},${ey}`,
      lx: bez(t, sx, c1, c2, ex),
      ly: bez(t, sy, sy, ey, ey),
    };
    curveAt.set(across, (u) => [bez(u, sx, c1, c2, ex), bez(u, sy, sy, ey, ey)]);
    out.push(across);
  }
  // Labels of lines leaving one frame sit close together: slide one that would cover another along
  // its own line to the first free spot (arcs keep their peak; they were placed first).
  const taken: { x: number; y: number }[] = out
    .filter((p) => !curveAt.has(p))
    .map((p) => ({ x: p.lx, y: p.ly }));
  const free = (x: number, y: number) =>
    taken.every((t) => Math.abs(t.x - x) >= LABEL_W + 2 || Math.abs(t.y - y) >= LABEL_H + 2);
  for (const p of out) {
    const at = curveAt.get(p);
    if (!at) continue;
    if (!free(p.lx, p.ly)) {
      for (const u of [0.35, 0.65, 0.25, 0.75, 0.45, 0.55, 0.15, 0.85]) {
        const [x, y] = at(u);
        if (free(x, y)) {
          p.lx = x;
          p.ly = y;
          break;
        }
      }
    }
    taken.push({ x: p.lx, y: p.ly });
  }
  return out;
}
