import { describe, it, expect } from 'vitest';
import { nextTile, type Box } from './Wall.js';

// Two rows of three, then a lone tile in a second group further down.
const g = (x: number, y: number): Box => ({ x, y, w: 100, h: 80 });
const boxes = [g(0, 0), g(110, 0), g(220, 0), g(0, 90), g(110, 90), g(220, 90), g(110, 300)];

describe('nextTile (S2)', () => {
  it('starts at the first tile when nothing is focused', () => {
    expect(nextTile(boxes, -1, 'ArrowDown')).toBe(0);
    expect(nextTile([], -1, 'ArrowDown')).toBe(-1);
  });
  it('left/right walk reading order and stop at the ends', () => {
    expect(nextTile(boxes, 2, 'ArrowRight')).toBe(3);
    expect(nextTile(boxes, 0, 'ArrowLeft')).toBe(0);
    expect(nextTile(boxes, 6, 'ArrowRight')).toBe(6);
  });
  it('up/down go to the nearest row, then the nearest column', () => {
    expect(nextTile(boxes, 1, 'ArrowDown')).toBe(4);
    expect(nextTile(boxes, 5, 'ArrowUp')).toBe(2);
    expect(nextTile(boxes, 3, 'ArrowDown')).toBe(6);
    expect(nextTile(boxes, 6, 'ArrowUp')).toBe(4);
    expect(nextTile(boxes, 0, 'ArrowUp')).toBe(0);
  });
});
