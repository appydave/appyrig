import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { FLEET_EVENTS, type FleetUpdate } from '@appydave/shared';
import { useFleet } from '@client/domain/fleet/useFleet.js';
import { fleetMachine, snapshot } from '@client/test/fleetFixtures.js';
import { socketWithEvents } from '@client/test/socketWithEvents.js';

/**
 * AFTER audit CQ-C-002. The error boundary's retry remounts the app. The hub sends the whole fleet
 * only on connect and the socket stays connected, so a fresh reducer would stay empty.
 */
const update = (full: boolean, id: string): FleetUpdate => {
  const m = fleetMachine(snapshot('m2'));

  return {
    generatedAt: '2026-11-09T00:00:00.000Z',
    full,
    machines: [{ ...m, machine: { ...m.machine, id } }],
  };
};

describe('a retry after a crash keeps the fleet', () => {
  it('still shows the machines it had, and adds to them', () => {
    const { socket, fire } = socketWithEvents();
    const push = (u: FleetUpdate) => fire(FLEET_EVENTS.UPDATE, u);

    const first = renderHook(() => useFleet(() => socket));

    push(update(true, 'm2'));
    expect(Object.keys(first.result.current.state.machines)).toEqual(['m2']);
    first.unmount();

    const retried = renderHook(() => useFleet(() => socket));

    expect(Object.keys(retried.result.current.state.machines)).toEqual(['m2']);
    push(update(false, 'm4'));
    expect(Object.keys(retried.result.current.state.machines).sort()).toEqual(['m2', 'm4']);
  });

  it('a different socket starts empty', () => {
    const { socket } = socketWithEvents();
    const { result } = renderHook(() => useFleet(() => socket));

    expect(result.current.state.machines).toEqual({});
  });
});
