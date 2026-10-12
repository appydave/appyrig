import { describe, expect, it } from 'vitest';
import { spreadLabels } from './RigMap.js';

describe('C6a: count labels never sit on top of each other', () => {
  it('slides a colliding label along its own line to a free spot', () => {
    const arc = [0, 100, 0, 40, 200, 40, 200, 100] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const out = spreadLabels([
      { lx: 100, ly: 55, c: arc },
      { lx: 100, ly: 55, c: arc },
      { lx: 100, ly: 55, c: arc },
    ]);
    for (let i = 0; i < out.length; i++)
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i]!;
        const b = out[j]!;
        expect(Math.abs(a.lx - b.lx) >= 24 || Math.abs(a.ly - b.ly) >= 20).toBe(true);
      }
  });

  it('leaves labels alone when nothing collides', () => {
    const c = [0, 0, 0, 0, 0, 0, 0, 0] as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    expect(
      spreadLabels([
        { lx: 10, ly: 10, c },
        { lx: 200, ly: 10, c },
      ]).map((p) => p.lx)
    ).toEqual([10, 200]);
  });
});
