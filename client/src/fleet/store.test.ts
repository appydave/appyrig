import { describe, expect, it } from 'vitest';
import { TAIL_MAX_LINES } from '@appydave/shared';
import { fleetMachine, snapshot, update } from '../test/fleetFixtures.js';
import { applyFleetUpdate, initialFleetState } from './store.js';

describe('applyFleetUpdate', () => {
  it('a full update replaces every machine', () => {
    let s = applyFleetUpdate(initialFleetState, update([fleetMachine(snapshot('m2'))]));
    s = applyFleetUpdate(s, update([fleetMachine(snapshot('roamy'))], true));
    expect(Object.keys(s.machines)).toEqual(['roamy']);
    expect(s.received).toBe(true);
  });

  it('a partial update replaces only the listed machines, whole', () => {
    let s = applyFleetUpdate(
      initialFleetState,
      update([fleetMachine(snapshot('m2')), fleetMachine(snapshot('roamy'))])
    );
    s = applyFleetUpdate(s, update([fleetMachine(snapshot('roamy--blocked'))], false));
    expect(Object.keys(s.machines).sort()).toEqual(['m2', 'roamy']);
    expect(s.machines.roamy.snapshot.seats.some((x) => x.status === 'blocked')).toBe(true);
    expect(s.machines.m2.snapshot.seats).toHaveLength(18);
  });

  it('an empty full update is a real empty fleet, not "loading"', () => {
    const s = applyFleetUpdate(initialFleetState, update([]));
    expect(s).toEqual({ machines: {}, received: true, error: null });
  });

  it('AC 7: keeps at most TAIL_MAX_LINES per seat, the newest ones', () => {
    const fm = fleetMachine(snapshot('roamy'));
    const lines = Array.from({ length: TAIL_MAX_LINES + 75 }, (_, i) => `line ${i}`);
    fm.snapshot.seats[0] = {
      ...fm.snapshot.seats[0],
      tail: { lines, ansi: false, capturedAt: fm.lastSeen },
    };
    const s = applyFleetUpdate(initialFleetState, update([fm]));
    expect(s.error).toBeNull();
    const kept = s.machines.roamy.snapshot.seats[0].tail!.lines;
    expect(kept).toHaveLength(TAIL_MAX_LINES);
    expect(kept.at(-1)).toBe(`line ${TAIL_MAX_LINES + 74}`);
    for (const m of Object.values(s.machines))
      for (const seat of m.snapshot.seats)
        expect(seat.tail?.lines.length ?? 0).toBeLessThanOrEqual(TAIL_MAX_LINES);
  });

  it('refuses an invalid update loudly and keeps the last good fleet', () => {
    const good = applyFleetUpdate(initialFleetState, update([fleetMachine(snapshot('roamy'))]));
    const bad = applyFleetUpdate(good, { full: true, machines: [{ nope: 1 }] });
    expect(bad.machines).toBe(good.machines);
    expect(bad.error).toMatch(/^refused a fleet update/);
    const healed = applyFleetUpdate(bad, update([fleetMachine(snapshot('roamy'))]));
    expect(healed.error).toBeNull();
  });
});
