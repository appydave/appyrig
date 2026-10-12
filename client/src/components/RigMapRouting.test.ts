import { describe, expect, it } from 'vitest';
import type { MapEdge } from '../fleet/views.js';
import { routeLines, spreadLabels, type Box } from './RigMap.js';

/**
 * C6-A geometric test: on a layout shaped like flicut-ab (three pods in a row, cards side by side,
 * a heading band at the top of every pod and lane, plus two outside lanes below), no line enters a
 * card other than its own two ends, no line enters a heading, and no two count labels overlap.
 * Laid out twice, as the browser does: the room the router asks for is given to the rows.
 */
const CARD_W = 150;
const CARD_H = 100;
const HEAD = 18; // a pod heading's band
const LANE_HEAD = 40; // a lane heading's band

interface Layout {
  cards: Map<string, Box>;
  pods: Map<string, Box>;
  lanes: Map<string, string>;
  headings: Box[];
}

function layout(
  rows: { lane: string; pods: string[][] }[],
  room: { top: Map<string, number>; bottom: Map<string, number> }
): Layout {
  const cards = new Map<string, Box>();
  const pods = new Map<string, Box>();
  const lanes = new Map<string, string>();
  const headings: Box[] = [];
  let y = 0;
  for (const row of rows) {
    const top = Math.max(24, room.top.get(row.lane) ?? 0);
    const bottom = Math.max(24, room.bottom.get(row.lane) ?? 0);
    headings.push({ x: 40, y, w: 600, h: LANE_HEAD }); // lane title
    let x = 40;
    const podY = y + LANE_HEAD + 10;
    for (const seats of row.pods) {
      const w = seats.length * (CARD_W + 40) + 10;
      const h = HEAD + top + CARD_H + bottom;
      const pod = { x, y: podY, w, h };
      headings.push({ x, y: podY, w, h: HEAD }); // the pod heading spans its width
      seats.forEach((k, i) => {
        cards.set(k, { x: x + 10 + i * (CARD_W + 40), y: podY + HEAD + top, w: CARD_W, h: CARD_H });
        pods.set(k, pod);
        lanes.set(k, row.lane);
      });
      x += w + 14;
    }
    y = podY + HEAD + top + CARD_H + bottom + 16 + 18;
  }
  return { cards, pods, lanes, headings };
}

const e = (from: string, to: string, count = 1): MapEdge => ({
  from,
  to,
  count,
  open: 0,
  stale: 0,
  self: false,
  items: [],
});

const ROWS = [
  { lane: 'm2', pods: [['lead'], ['deadair', 'wordcut', 'qa'], ['r1']] },
  { lane: '?', pods: [['orch@roamy']] },
  { lane: 'other', pods: [['boss']] },
];
const EDGES = [
  e('lead', 'deadair', 2),
  e('lead', 'wordcut', 2),
  e('lead', 'qa', 1),
  e('lead', 'r1', 1),
  e('deadair', 'qa', 2),
  e('wordcut', 'qa', 2),
  e('qa', 'r1', 3),
  e('deadair', 'wordcut', 1),
  e('r1', 'lead', 4),
  e('qa', 'lead', 1),
  e('qa', 'wordcut', 1),
  e('r1', 'qa', 1),
  e('wordcut', 'lead', 1),
  e('orch@roamy', 'lead', 3),
  e('lead', 'boss', 4),
  e('qa', 'boss', 1),
];

/** Points along a path in the router's own format: cubic "M … C …" or polyline "M … L …". */
function sample(d: string): { x: number; y: number }[] {
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const pts: { x: number; y: number }[] = [];
  if (d.includes('C')) {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = n as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let i = 1; i < 80; i++) {
      const t = i / 80;
      const b = (a: number, b: number, c: number, d: number) =>
        (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
      pts.push({ x: b(x0, x1, x2, x3), y: b(y0, y1, y2, y3) });
    }
  } else {
    for (let k = 0; k + 3 < n.length; k += 2)
      for (let i = 0; i <= 20; i++)
        pts.push({
          x: n[k]! + ((n[k + 2]! - n[k]!) * i) / 20,
          y: n[k + 1]! + ((n[k + 3]! - n[k + 1]!) * i) / 20,
        });
  }
  return pts;
}
const inside = (p: { x: number; y: number }, b: Box) =>
  p.x > b.x + 1 && p.x < b.x + b.w - 1 && p.y > b.y + 1 && p.y < b.y + b.h - 1;

describe('C6-A: Map lines never cross a box or a heading, and labels never overlap', () => {
  it('on a flicut-ab-shaped layout (two-pass, as the browser lays it out)', () => {
    let room = { top: new Map<string, number>(), bottom: new Map<string, number>() };
    let L = layout(ROWS, room);
    const look = () => ({
      card: (k: string) => L.cards.get(k) ?? null,
      pod: (k: string) => L.pods.get(k) ?? null,
      lane: (k: string) => L.lanes.get(k) ?? '',
    });
    const first = routeLines(EDGES, look());
    room = { top: first.roomTop, bottom: first.roomBottom };
    L = layout(ROWS, room);
    const { placed } = routeLines(EDGES, look());
    expect(placed).toHaveLength(EDGES.length);

    const crossings: string[] = [];
    for (const p of placed) {
      for (const pt of sample(p.d)) {
        for (const [k, box] of L.cards)
          if (k !== p.edge.from && k !== p.edge.to && inside(pt, box))
            crossings.push(`${p.edge.from}→${p.edge.to} over ${k}`);
        for (const h of L.headings)
          if (inside(pt, h)) crossings.push(`${p.edge.from}→${p.edge.to} over a heading`);
      }
    }
    expect([...new Set(crossings)]).toEqual([]);

    const labels = spreadLabels(placed).map((p) => ({ x: p.lx - 11, y: p.ly - 9, w: 22, h: 18 }));
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]!;
        const b = labels[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(
          overlap,
          `labels of ${placed[i]!.edge.from}→${placed[i]!.edge.to} and ${placed[j]!.edge.from}→${placed[j]!.edge.to}`
        ).toBe(false);
      }
  });

  it('packs arcs into levels: disjoint arcs share one, nested ones stack; room grows only where needed', () => {
    const L = layout([{ lane: 'm2', pods: [['a', 'b', 'c', 'd']] }], {
      top: new Map(),
      bottom: new Map(),
    });
    const r = routeLines([e('a', 'b'), e('c', 'd'), e('a', 'd')], {
      card: (k) => L.cards.get(k) ?? null,
      pod: (k) => L.pods.get(k) ?? null,
      lane: () => 'm2',
    });
    const peak = (from: string) =>
      r.placed.find((p) => p.edge.from === from && p.edge.to !== 'd')?.ly;
    // a→b and c→d do not overlap: same level, so same label height
    expect(peak('a')).toBe(r.placed.find((p) => p.edge.from === 'c')!.ly);
    // a→d contains both: one level higher (smaller y, above the row)
    expect(r.placed.find((p) => p.edge.to === 'd' && p.edge.from === 'a')!.ly).toBeLessThan(
      peak('a')!
    );
    expect(r.roomBottom.get('m2')).toBeUndefined(); // nothing goes right-to-left: no room below
  });
});
