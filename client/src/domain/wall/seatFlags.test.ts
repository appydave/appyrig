import { describe, expect, it } from 'vitest';
import type { FleetMachine, Seat } from '@appydave/shared';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { seatFlags, STUCK_AFTER_MS } from './model.js';

/**
 * The three flags of a Wall seat, each combination pinned on purpose: needs is only a blocked seat,
 * stuck is a seat that is up and (flagged, has a blocked item, or has waiting work and a quiet agent),
 * failing is a stopped seat in a running rig or one OpenRig flags.
 */

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const m = fleetMachine(snapshot('roamy--blocked'));
const idle = (over: Partial<Seat>): Seat => ({
  ...m.snapshot.seats[0]!,
  status: 'idle',
  rig: null,
  lifecycleState: 'running',
  work: { pending: 0, inProgress: 0, blocked: 0 },
  agentActivityAt: ago(1000),
  ...over,
});
const waiting = { pending: 1, inProgress: 0, blocked: 0 };
const quiet = ago(STUCK_AFTER_MS + 1);
const stuck = (seat: Seat) => seatFlags(seat, m, NOW).stuck;

describe('stuck', () => {
  it.each([
    ['nothing waiting, agent fresh', idle({}), false],
    ['flagged for attention', idle({ lifecycleState: 'attention_required' }), true],
    ['a blocked item', idle({ work: { pending: 0, inProgress: 0, blocked: 1 } }), true],
    ['waiting work, agent quiet', idle({ work: waiting, agentActivityAt: quiet }), true],
    [
      'an item in progress counts as waiting work',
      idle({ work: { pending: 0, inProgress: 1, blocked: 0 }, agentActivityAt: quiet }),
      true,
    ],
    ['waiting work, agent fresh', idle({ work: waiting }), false],
    [
      'quiet for exactly the limit is not yet stuck',
      idle({ work: waiting, agentActivityAt: ago(STUCK_AFTER_MS) }),
      false,
    ],
    [
      'waiting work but no activity time reported',
      idle({ work: waiting, agentActivityAt: null }),
      false,
    ],
    ['quiet with nothing waiting', idle({ agentActivityAt: quiet }), false],
    [
      'working with waiting work, agent quiet',
      idle({ status: 'working', work: waiting, agentActivityAt: quiet }),
      false,
    ],
    [
      'working but flagged for attention',
      idle({ status: 'working', lifecycleState: 'attention_required' }),
      true,
    ],
    [
      'working with a blocked item',
      idle({ status: 'working', work: { pending: 0, inProgress: 0, blocked: 1 } }),
      true,
    ],
    [
      'blocked on a person, even flagged',
      idle({ status: 'blocked', lifecycleState: 'attention_required' }),
      false,
    ],
    [
      'stopped with a blocked item',
      idle({ status: 'stopped', work: { pending: 0, inProgress: 0, blocked: 1 } }),
      false,
    ],
  ])('%s', (_name, seat, expected) => {
    expect(stuck(seat)).toBe(expected);
  });

  it('with no agent time, falls back to the last activity time', () => {
    const lastActivityAt = quiet;

    expect(stuck(idle({ work: waiting, agentActivityAt: undefined, lastActivityAt }))).toBe(true);
  });
});

describe('needs and failing', () => {
  const rig = (status: string): FleetMachine => ({
    ...m,
    snapshot: { ...m.snapshot, rigs: [{ ...m.snapshot.rigs[0]!, name: 'r', status } as never] },
  });
  const flags = (seat: Seat, fm = m) => seatFlags(seat, fm, NOW);

  it('needs is exactly a blocked seat', () => {
    expect(flags(idle({ status: 'blocked' })).needs).toBe(true);
    expect(flags(idle({ status: 'idle' })).needs).toBe(false);
    expect(flags(idle({ status: 'stopped' })).needs).toBe(false);
  });

  it('failing: stopped and flagged, or stopped in a running rig; nothing else', () => {
    const down = idle({ status: 'stopped', rig: 'r' });

    expect(flags({ ...down, lifecycleState: 'attention_required' }, rig('stopped')).failing).toBe(
      true
    );
    expect(flags(down, rig('running')).failing).toBe(true);
    expect(flags(down, rig('stopped')).failing).toBe(false);
    expect(flags({ ...down, rig: 'elsewhere' }, rig('running')).failing).toBe(false);
    expect(flags({ ...down, rig: null }, rig('running')).failing).toBe(false);
    expect(
      flags(idle({ rig: 'r', lifecycleState: 'attention_required' }), rig('running')).failing
    ).toBe(false);
  });

  it('an asleep machine flags nothing', () => {
    const asleep = { ...m, liveness: 'asleep' as const };

    expect(
      seatFlags(idle({ status: 'blocked', lifecycleState: 'attention_required' }), asleep, NOW)
    ).toEqual({
      needs: false,
      stuck: false,
      failing: false,
    });
  });
});
