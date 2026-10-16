import { describe, it, expect } from 'vitest';
import type { FleetMachine } from '@appydave/shared';
import { nextTile, wallSeats, type Box } from './Wall.js';

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

describe('wallSeats (D09 W1)', () => {
  const fm = (id: string, seats: { id: string; rig: string | null; status: string }[]) =>
    ({
      machine: { id, label: id.toUpperCase() },
      liveness: 'live',
      snapshot: { seats },
    }) as unknown as FleetMachine;
  const a = fm('m2', [
    { id: 'dev-build@d09-crew', rig: 'd09-crew', status: 'idle' },
    { id: 'dev-build@old', rig: 'old', status: 'stopped' },
    { id: 'dev-qa@old', rig: 'old', status: 'stopped' },
  ]);
  const b = fm('m4', [{ id: 'x@gone', rig: 'gone', status: 'stopped' }]);
  const rig = (machineId: string, name: string) => ({
    key: `${machineId}:${name}`,
    machineId,
    name,
    machineLabel: machineId.toUpperCase(),
  });

  it('hides stopped seats and counts them; a machine left empty is dropped', () => {
    const r = wallSeats([a, b], true, null);
    expect(r.stopped).toBe(3);
    expect(r.inScope).toBe(4);
    expect(r.machines.map((m) => m.machine.id)).toEqual(['m2']);
    expect(r.machines[0]!.snapshot.seats.map((s) => s.id)).toEqual(['dev-build@d09-crew']);
  });

  it('off keeps every seat and the same machine objects', () => {
    const r = wallSeats([a, b], false, null);
    expect(r.stopped).toBe(0);
    expect(r.machines[0]).toBe(a);
    expect(r.machines[1]).toBe(b);
  });

  it('only this rig keeps that rig on that machine', () => {
    const r = wallSeats([a, b], false, rig('m2', 'old'));
    expect(r.machines.flatMap((m) => m.snapshot.seats.map((s) => s.id))).toEqual([
      'dev-build@old',
      'dev-qa@old',
    ]);
    expect(wallSeats([a, b], true, rig('m2', 'old'))).toMatchObject({ stopped: 2, inScope: 2 });
    expect(wallSeats([a, b], true, rig('m2', 'old')).machines).toEqual([]);
  });
});
