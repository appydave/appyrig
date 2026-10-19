import { describe, expect, it } from 'vitest';
import type { QueueItem } from '@appydave/shared';
import { planLines, type MapPair } from './lines.js';

const item = (id: string, at: string): QueueItem => ({
  id,
  source: null,
  destination: null,
  state: 'done',
  priority: null,
  tags: [],
  summary: id,
  createdAt: at,
  updatedAt: at,
});

const pair = (
  a: string,
  b: string,
  aToB: number,
  bToA: number,
  over: Partial<MapPair> = {}
): MapPair => ({
  a,
  b,
  aToB,
  bToA,
  total: aToB + bToA,
  waiting: 0,
  leftOpen: 0,
  planned: false,
  plannedWords: null,
  items: [],
  ...over,
});

const box = (x: number, y: number) => ({ x, y, w: 200, h: 100 });
const POD: Record<string, string> = { a1: 'P1', a2: 'P1', b1: 'P2', b2: 'P2', c1: 'P3' };
const POS: Record<string, [number, number]> = {
  a1: [0, 0],
  a2: [300, 0],
  b1: [0, 400],
  b2: [300, 400],
  c1: [600, 0],
};
const look = {
  card: (k: string) => (POS[k] ? box(POS[k]![0], POS[k]![1]) : null),
  pod: (k: string) => POD[k] ?? '',
};

describe('Rig Map v2 line plan', () => {
  it('pairs in one row stay one arc each', () => {
    const lines = planLines([pair('a1', 'a2', 14, 8), pair('a1', 'c1', 3, 0)], look);
    expect(lines.map((l) => [l.a, l.b, l.aToB, l.bToA, l.rail])).toEqual([
      ['a1', 'a2', 14, 8, false],
      ['a1', 'c1', 3, 0, false],
    ]);
  });

  it('lines that cannot stay in a row fold into ONE rail per pair of pods, with the totals', () => {
    const lines = planLines(
      [
        pair('a1', 'b1', 5, 2, { waiting: 1, items: [item('x', '2026-10-18T10:00:00Z')] }),
        pair('a2', 'b2', 7, 0, { leftOpen: 2, items: [item('y', '2026-10-18T09:00:00Z')] }),
        pair('b1', 'a2', 1, 3),
      ],
      look
    );
    expect(lines).toHaveLength(1);
    const rail = lines[0]!;
    expect(rail.rail).toBe(true);
    expect(rail.pairs).toBe(3);
    // P1 to P2: a1→b1 5, a2→b2 7, a2→b1 3 = 15; back: b1→a1 2, b1→a2 1 = 3
    expect([rail.aToB, rail.bToA, rail.total]).toEqual([15, 3, 18]);
    expect([rail.waiting, rail.leftOpen]).toEqual([1, 2]);
    expect([...rail.members].sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(rail.items.map((i) => i.id)).toEqual(['y', 'x']);
  });

  it('a planned pair is never folded into a rail', () => {
    const lines = planLines(
      [pair('a1', 'b1', 0, 0, { planned: true, plannedWords: 'observes' })],
      look
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ planned: 'observes', rail: false });
  });
});
