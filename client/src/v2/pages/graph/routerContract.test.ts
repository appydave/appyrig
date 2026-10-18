import { describe, expect, it } from 'vitest';
import { routeLines, spreadLabels } from '../../../components/RigMap.js';
import type { MapEdge } from '../../../fleet/views.js';

/**
 * L1. The Graph reuses RigMap's `routeLines` and `spreadLabels` as they are (the originals are not
 * edited). This pins what they return for a small, fixed layout, so a change to how the Rig Map
 * routes or labels lines fails here, in a v2 test, and is looked at before the Graph silently
 * changes with it.
 */
const box = (x: number, y: number, w = 120, h = 80) => ({ x, y, w, h });
const cards: Record<string, ReturnType<typeof box>> = {
  a: box(10, 60),
  b: box(160, 60),
  c: box(10, 230),
};
const pods: Record<string, ReturnType<typeof box>> = {
  a: { x: 0, y: 40, w: 300, h: 120 },
  b: { x: 0, y: 40, w: 300, h: 120 },
  c: { x: 0, y: 210, w: 300, h: 120 },
};
const edge = (from: string, to: string, count: number, planned?: string): MapEdge => ({
  from,
  to,
  count,
  open: 0,
  stale: 0,
  self: false,
  items: [],
  ...(planned ? { planned } : {}),
});

const look = {
  card: (k: string) => cards[k] ?? null,
  pod: (k: string) => pods[k] ?? null,
  lane: () => 'rig',
  podCards: (k: string) => (k === 'c' ? [cards.c!] : [cards.a!, cards.b!]),
};
const r1 = (n: string) => n.replace(/-?\d+\.\d+/g, (m) => String(Math.round(Number(m) * 10) / 10));

describe('RigMap router contract (reused read-only by the Graph)', () => {
  const edges = [
    edge('a', 'b', 3),
    edge('b', 'a', 1),
    edge('a', 'c', 2),
    edge('b', 'c', 0, 'delegates_to'),
  ];

  it('routes a row of cards: same-row arcs over and under, other pods by the corridors', () => {
    const { placed, roomTop, roomBottom } = routeLines(edges, look);
    expect(
      placed.map((p) => ({
        line: `${p.edge.from}>${p.edge.to}${p.edge.planned ? ' planned' : ''}`,
        d: r1(p.d),
        label: [Math.round(p.lx * 10) / 10, Math.round(p.ly * 10) / 10],
      }))
    ).toMatchInlineSnapshot(`
      [
        {
          "d": "M82,60 C82,38.7 208,38.7 208,60",
          "label": [
            145,
            44,
          ],
          "line": "a>b",
        },
        {
          "d": "M208,140 C208,161.3 82,161.3 82,140",
          "label": [
            145,
            156,
          ],
          "line": "b>a",
        },
        {
          "d": "M108,140 L108,163 L20,163 L20,333 L108,333 L108,310",
          "label": [
            32,
            248,
          ],
          "line": "a>c",
        },
        {
          "d": "M258,140 L258,165.5 L16,165.5 L16,335.5 L108,335.5 L108,310",
          "label": [
            28,
            250.5,
          ],
          "line": "b>c planned",
        },
      ]
    `);
    expect([roomTop.get('rig'), roomBottom.get('rig')]).toMatchInlineSnapshot(`
      [
        30,
        30,
      ]
    `);
  });

  it('slides a count label that would sit on another along its own line', () => {
    // two lines whose labels start on the same point: the second moves, the first stays
    const c: [number, number, number, number, number, number, number, number] = [
      0, 0, 40, 0, 80, 100, 120, 100,
    ];
    const at = (x: number, y: number, e: MapEdge) => ({ edge: e, lx: x, ly: y, c });
    const [first, second] = spreadLabels([
      at(60, 50, edge('a', 'b', 2)),
      at(60, 50, edge('b', 'a', 2)),
    ]);
    expect([first!.lx, first!.ly]).toEqual([60, 50]);
    expect([Math.round(second!.lx * 10) / 10, Math.round(second!.ly * 10) / 10])
      .toMatchInlineSnapshot(`
      [
        36,
        21.6,
      ]
    `);
  });
});
