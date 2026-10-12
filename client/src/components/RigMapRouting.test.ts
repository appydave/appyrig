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

/**
 * As index.css draws it: cards start 15 px inside their pod (border, padding, seats padding);
 * a pod's seats wrap after `wrap` cards with a row gap of max(70, arc room above + below); pods in
 * one lane stretch to the same height.
 */
function layout(
  rows: { lane: string; pods: string[][]; wrap?: number }[],
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
    const gap = Math.max(70, top + bottom);
    const wrap = row.wrap ?? 99;
    headings.push({ x: 40, y, w: 600, h: LANE_HEAD }); // lane title
    const podY = y + LANE_HEAD + 10;
    const tallest = Math.max(...row.pods.map((p) => Math.ceil(p.length / wrap)));
    const h = HEAD + top + tallest * CARD_H + (tallest - 1) * gap + bottom;
    let x = 40;
    for (const seats of row.pods) {
      const w = Math.min(seats.length, wrap) * (CARD_W + 40) - 40 + 30;
      const pod = { x, y: podY, w, h };
      headings.push({ x, y: podY, w, h: HEAD }); // the pod heading spans its width
      seats.forEach((k, i) => {
        const col = i % wrap;
        const r = Math.floor(i / wrap);
        cards.set(k, {
          x: x + 15 + col * (CARD_W + 40),
          y: podY + HEAD + top + r * (CARD_H + gap),
          w: CARD_W,
          h: CARD_H,
        });
        pods.set(k, pod);
        lanes.set(k, row.lane);
      });
      x += w + 14;
    }
    y = podY + h + 16 + 18;
  }
  return { cards, pods, lanes, headings };
}

/** Route twice, as the browser does: the room asked for the first time is given to the rows. */
function routeTwice(rows: Parameters<typeof layout>[0], edges: MapEdge[]) {
  let L = layout(rows, { top: new Map(), bottom: new Map() });
  const look = () => ({
    card: (k: string) => L.cards.get(k) ?? null,
    pod: (k: string) => L.pods.get(k) ?? null,
    lane: (k: string) => L.lanes.get(k) ?? '',
    podCards: (k: string) => {
      const pod = L.pods.get(k);
      return [...L.cards].filter(([o]) => L.pods.get(o) === pod).map(([, b]) => b);
    },
  });
  const first = routeLines(edges, look());
  L = layout(rows, { top: first.roomTop, bottom: first.roomBottom });
  return { L, placed: routeLines(edges, look()).placed };
}

/** Each line that enters a card other than its own ends, or any heading; and overlapping labels. */
function faults(L: Layout, placed: ReturnType<typeof routeLines>['placed']) {
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
  const labels = spreadLabels(placed).map((p) => ({ x: p.lx - 11, y: p.ly - 9, w: 22, h: 18 }));
  const overlaps: string[] = [];
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!;
      const b = labels[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
        overlaps.push(
          `${placed[i]!.edge.from}→${placed[i]!.edge.to} / ${placed[j]!.edge.from}→${placed[j]!.edge.to}`
        );
    }
  return { crossings: [...new Set(crossings)], overlaps };
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
    const { L, placed } = routeTwice(ROWS, EDGES);
    expect(placed).toHaveLength(EDGES.length);
    expect(faults(L, placed)).toEqual({ crossings: [], overlaps: [] });
  });

  // C6-A.1 (r1 MEDIUM-1): a narrow window wraps a big pod's seats onto more rows.
  const WRAPPED = [
    { lane: 'm2', pods: [['lead'], ['a', 'b', 'c', 'f', 'g', 'h', 'i'], ['r1']], wrap: 3 },
    { lane: 'other', pods: [['boss']] },
  ];
  const WRAPPED_EDGES = [
    e('a', 'g', 2), // r1's probe: row 1 to row 2 of one pod, f sits under a
    e('g', 'a', 1),
    e('b', 'i', 1), // row 1 to row 3
    e('i', 'c', 1),
    e('a', 'b', 3), // arcs inside row 1, row 2 and row 3
    e('c', 'b', 1),
    e('f', 'h', 2),
    e('h', 'g', 1),
    e('lead', 'a', 4), // other pods to a card with rows below it, both ways
    e('c', 'r1', 2),
    e('r1', 'f', 1),
    e('b', 'boss', 1), // another lane, from and to a top-row card
    e('boss', 'c', 1),
    e('lead', 'boss', 2),
  ];

  it('on a pod whose seats wrap to three rows: no line runs through the card under its end', () => {
    const { L, placed } = routeTwice(WRAPPED, WRAPPED_EDGES);
    expect(placed).toHaveLength(WRAPPED_EDGES.length);
    expect(faults(L, placed)).toEqual({ crossings: [], overlaps: [] });
  });

  it('two rows of one pod join inside the pod, not via the gutter', () => {
    const { placed } = routeTwice(WRAPPED, WRAPPED_EDGES);
    const ag = placed.find((p) => p.edge.from === 'a' && p.edge.to === 'g')!;
    const xs = sample(ag.d).map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThan(40); // never left of the lane: the gutter is x < 26
  });

  it('a new line does not move the others (slots come from the ends, not the order)', () => {
    const before = routeTwice(WRAPPED, WRAPPED_EDGES).placed;
    const after = routeTwice(WRAPPED, [e('i', 'r1'), ...WRAPPED_EDGES]).placed;
    for (const p of before) {
      const q = after.find((x) => x.edge.from === p.edge.from && x.edge.to === p.edge.to)!;
      expect(q.d, `${p.edge.from}→${p.edge.to}`).toBe(p.d);
    }
  });

  it('packs arcs into levels: disjoint arcs share one, nested ones stack; room grows only where needed', () => {
    const { placed: r0 } = routeTwice(
      [{ lane: 'm2', pods: [['a', 'b', 'c', 'd']] }],
      [e('a', 'b'), e('c', 'd'), e('a', 'd')]
    );
    const ly = (from: string, to: string) =>
      r0.find((p) => p.edge.from === from && p.edge.to === to)!.ly;
    expect(ly('a', 'b')).toBe(ly('c', 'd')); // disjoint: same level
    expect(ly('a', 'd')).toBeLessThan(ly('a', 'b')); // contains both: one level higher
    const L = layout([{ lane: 'm2', pods: [['a', 'b', 'c', 'd']] }], {
      top: new Map(),
      bottom: new Map(),
    });
    const r = routeLines([e('a', 'b'), e('c', 'd'), e('a', 'd')], {
      card: (k) => L.cards.get(k) ?? null,
      pod: (k) => L.pods.get(k) ?? null,
      lane: () => 'm2',
      podCards: () => [...L.cards.values()],
    });
    expect(r.roomBottom.get('m2')).toBeUndefined(); // nothing goes right-to-left: no room below
  });
});
