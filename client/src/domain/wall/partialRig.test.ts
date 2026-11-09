import { describe, expect, it } from 'vitest';
import type { FleetMachine } from '@appydave/shared';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { allGroups, buildGraph } from '@client/domain/graph/model.js';
import { seatFlags } from '@client/domain/wall/model.js';
import { runCard } from '@client/domain/fleet/runcard.js';

/** AFTER audit: `partial` means part of a rig is up. Every screen has to read it as live. */
const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const RIG = 'starter';

function partial(firstSeat: 'idle' | 'working' = 'idle'): FleetMachine {
  const base = fleetMachine(snapshot('m2'));
  let first = true;
  const seats = base.snapshot.seats.map((s) => {
    if (s.rig !== RIG) {
      return s;
    }

    const status = first ? firstSeat : ('stopped' as const);

    first = false;

    return { ...s, status, lifecycleState: 'recoverable', recoveryGuidance: null };
  });
  const rigs = base.snapshot.rigs.map((r) =>
    r.name === RIG ? { ...r, status: 'partial', runningCount: 1, nodeCount: 2 } : r
  );

  return { ...base, snapshot: { ...base.snapshot, rigs, seats, queue: [] } };
}

describe('a partial rig is live', () => {
  it('Wall: a seat down inside it is failing', () => {
    const fm = partial();
    const down = fm.snapshot.seats.find((s) => s.rig === RIG && s.status === 'stopped')!;

    expect(seatFlags(down, fm, NOW).failing).toBe(true);
  });

  it('Graph: a seat down inside it counts as failing', () => {
    const box = allGroups(buildGraph([partial()], NOW)).find((r) => r.name === RIG)!;

    expect(box.flags.failing).toBeGreaterThan(0);
  });

  it('Run card: says part of it is up, with the count', () => {
    const state = runCard(partial(), RIG, NOW)!.state;

    expect(state.word).toBe('partial');
    expect(state.why).toContain('1 of 2 seats');
  });

  it('Run card: a seat mid-turn in it still reads as working', () => {
    expect(runCard(partial('working'), RIG, NOW)!.state.word).toBe('working');
  });
});
