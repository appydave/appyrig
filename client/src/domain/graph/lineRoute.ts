import type { GroupKey } from './model.js';
import type { LinePair } from '../lines/handoffLines.js';

/** A rig box in canvas pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point on a line with the direction an arrowhead there would point (degrees, pointing out of the line). */
export interface Tip {
  x: number;
  y: number;
  angle: number;
}

export interface RoutedLine<P extends LinePair = LinePair> {
  pair: P;
  d: string;
  lx: number;
  ly: number;
  /** The arrowhead anchor at the `a` end and at the `b` end. */
  tipA: Tip;
  tipB: Tip;
}

type Side = 'l' | 'r' | 't' | 'b';

const LABEL_W = 28;
const LABEL_H = 18;

const deg = (dx: number, dy: number) => (Math.atan2(dy, dx) * 180) / Math.PI;

const bez = (t: number, p0: number, p1: number, p2: number, p3: number) =>
  (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;

/**
 * Where each rig-pair line goes: from the edge of one box to the edge of the other, one curve per
 * pair. Boxes side by side join left-right; boxes that overlap horizontally (stacked) join
 * bottom-top. Lines meeting one box side are spread along that side (ordered by where their other
 * end is), so no two leave from one point, and a count label that would sit on another slides along
 * its own line to the first free spot.
 */
export function routeLines<P extends LinePair>(
  pairs: P[],
  box: (key: GroupKey) => Box | null
): RoutedLine<P>[] {
  const drawn = pairs.flatMap((pair) => {
    const a = box(pair.a);
    const b = box(pair.b);
    return a && b ? [{ pair, a, b }] : [];
  });
  const sides = (a: Box, b: Box): [Side, Side] => {
    if (a.x + a.w <= b.x) return ['r', 'l'];
    if (b.x + b.w <= a.x) return ['l', 'r'];
    return a.y <= b.y ? ['b', 't'] : ['t', 'b'];
  };
  const k = (p: LinePair) => `${p.a}\u0000${p.b}`;
  const ends = new Map<string, { id: string; other: number }[]>();
  for (const { pair, a, b } of drawn) {
    const [sa, sb] = sides(a, b);
    const horizontal = sa === 'r' || sa === 'l';
    for (const [key, side, role, other] of [
      [pair.a, sa, 'a', horizontal ? b.y : b.x],
      [pair.b, sb, 'b', horizontal ? a.y : a.x],
    ] as const) {
      const id = `${key}|${side}`;
      ends.set(id, [...(ends.get(id) ?? []), { id: `${k(pair)}|${role}`, other }]);
    }
  }
  const anchor = (frame: Box, key: GroupKey, side: Side, lineId: string): [number, number] => {
    const list = (ends.get(`${key}|${side}`) ?? [])
      .slice()
      .sort((x, y) => x.other - y.other || x.id.localeCompare(y.id));
    const i = Math.max(
      0,
      list.findIndex((x) => x.id === lineId)
    );
    const f = (i + 1) / (list.length + 1);
    switch (side) {
      case 'r':
        return [frame.x + frame.w, frame.y + frame.h * f];
      case 'l':
        return [frame.x, frame.y + frame.h * f];
      case 'b':
        return [frame.x + frame.w * f, frame.y + frame.h];
      default:
        return [frame.x + frame.w * f, frame.y];
    }
  };

  const curves: { line: RoutedLine<P>; at: (t: number) => [number, number] }[] = [];
  for (const { pair, a, b } of drawn) {
    const [sa, sb] = sides(a, b);
    const [sx, sy] = anchor(a, pair.a, sa, `${k(pair)}|a`);
    const [ex, ey] = anchor(b, pair.b, sb, `${k(pair)}|b`);
    let c1x = sx;
    let c1y = sy;
    let c2x = ex;
    let c2y = ey;
    if (sa === 'r' || sa === 'l') {
      const dx = Math.max(24, Math.abs(ex - sx) / 2);
      c1x = sa === 'r' ? sx + dx : sx - dx;
      c2x = sb === 'l' ? ex - dx : ex + dx;
    } else {
      const dy = Math.max(24, Math.abs(ey - sy) / 2);
      c1y = sa === 'b' ? sy + dy : sy - dy;
      c2y = sb === 't' ? ey - dy : ey + dy;
    }
    const at = (t: number): [number, number] => [
      bez(t, sx, c1x, c2x, ex),
      bez(t, sy, c1y, c2y, ey),
    ];
    const [lx, ly] = at(0.5);
    curves.push({
      line: {
        pair,
        d: `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${ex},${ey}`,
        lx,
        ly,
        tipA: { x: sx, y: sy, angle: deg(sx - c1x, sy - c1y) },
        tipB: { x: ex, y: ey, angle: deg(ex - c2x, ey - c2y) },
      },
      at,
    });
  }
  // labels: slide along the line to the first spot that covers no other label
  const taken: { x: number; y: number }[] = [];
  const free = (x: number, y: number) =>
    taken.every((t) => Math.abs(t.x - x) >= LABEL_W + 2 || Math.abs(t.y - y) >= LABEL_H + 2);
  for (const { line, at } of curves) {
    if (!free(line.lx, line.ly)) {
      for (const u of [0.4, 0.6, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8]) {
        const [x, y] = at(u);
        if (free(x, y)) {
          line.lx = x;
          line.ly = y;
          break;
        }
      }
    }
    taken.push({ x: line.lx, y: line.ly });
  }
  return curves.map((c) => c.line);
}
