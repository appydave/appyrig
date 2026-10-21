import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MachineSnapshotSchema, TAIL_MAX_LINES } from '@appydave/shared';
import { SNAPSHOTS, loadSnapshot as load } from '../test/hubHarness.js';

describe('snapshot fixtures satisfy the shared contract', () => {
  for (const file of readdirSync(SNAPSHOTS).filter((f) => f.endsWith('.json'))) {
    it(`${file} parses with MachineSnapshotSchema`, () => {
      const result = MachineSnapshotSchema.safeParse(
        JSON.parse(readFileSync(resolve(SNAPSHOTS, file), 'utf8'))
      );

      expect(result.success, JSON.stringify(result.error?.issues.slice(0, 3))).toBe(true);
    });
  }

  it('rejects a tail longer than TAIL_MAX_LINES', () => {
    const snap = load('roamy');
    const seat = snap.seats.find((s) => s.tail)!;

    seat.tail!.lines = Array.from({ length: TAIL_MAX_LINES + 1 }, () => 'x');
    expect(MachineSnapshotSchema.safeParse(snap).success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    const snap = { ...load('m2'), extra: true };

    expect(MachineSnapshotSchema.safeParse(snap).success).toBe(false);
  });

  it('accepts a stopped seat with no activity key', () => {
    const seat = load('m2').seats[0];

    expect(seat.status).toBe('stopped');
    expect('activity' in seat).toBe(false);
  });
});
