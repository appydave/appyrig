import { describe, expect, it } from 'vitest';
import { nextOrder } from './stableOrder.js';

describe('nextOrder (B1 fb-0004: nothing re-sorts under the pointer)', () => {
  const opts = { allowResort: false, groupChanged: false, frozen: false };

  it('holds the order between re-sorts, even when the live sort swaps two busy rigs', () => {
    const first = nextOrder([], ['kernel', 'loadout', 'ylo'], opts);

    expect(first).toEqual({ order: ['kernel', 'loadout', 'ylo'], resorted: true });
    // the next push has loadout busier than kernel: no swap yet
    expect(nextOrder(first.order, ['loadout', 'kernel', 'ylo'], opts).order).toEqual([
      'kernel',
      'loadout',
      'ylo',
    ]);
  });

  it('re-sorts when the interval allows, or at once when a rig starts or stops', () => {
    const prev = ['kernel', 'loadout'];

    expect(nextOrder(prev, ['loadout', 'kernel'], { ...opts, allowResort: true }).order).toEqual([
      'loadout',
      'kernel',
    ]);
    expect(nextOrder(prev, ['loadout', 'kernel'], { ...opts, groupChanged: true }).order).toEqual([
      'loadout',
      'kernel',
    ]);
  });

  it('never re-sorts while frozen (pointer over the list), whatever changed', () => {
    const r = nextOrder(['a', 'b'], ['b', 'a'], {
      allowResort: true,
      groupChanged: true,
      frozen: true,
    });

    expect(r).toEqual({ order: ['a', 'b'], resorted: false });
  });

  it('drops rigs that left and appends new ones at the end, so nothing jumps', () => {
    expect(nextOrder(['a', 'b', 'c'], ['d', 'c', 'a'], opts).order).toEqual(['a', 'c', 'd']);
  });
});
