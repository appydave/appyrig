import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FleetMachine, QueueItem } from '@appydave/shared';
import { fleetMachine, snapshot } from '../../../test/fleetFixtures.js';
import type { FleetSocket } from '../../../fleet/useFleet.js';
import type { V2Context } from '../../types.js';
import { page as missions } from './index.js';
import { deriveMissions } from './model.js';

/**
 * Run board brief, lane 2 (2026-10-19): Missions keeps machines apart. The same mission id on two
 * machines (d09-crew runs on both the M2 and the M4) is two missions, each with its machine chip,
 * and each reads MISSION.md from its own machine's rig.
 */

const T = '2026-10-18T10:00:00.000Z';
function q(id: string, tags: string[], dest: string, state = 'pending'): QueueItem {
  return {
    id,
    source: 'orch-lead@x',
    destination: dest,
    state,
    priority: null,
    tags,
    summary: `job ${id}`,
    createdAt: T,
    updatedAt: T,
  };
}

/** mission:d09 on the M2 (pre-GO chores) and on Roamy (the run), both in a rig called starter. */
function twoMachines(): FleetMachine[] {
  const m2 = fleetMachine(snapshot('m2'));
  m2.snapshot = {
    ...m2.snapshot,
    queue: [q('m2-a', ['mission:d09', 'slice:chores'], 'dev-build@starter', 'done')],
  };
  const roamy = fleetMachine(snapshot('roamy--blocked'));
  roamy.snapshot = {
    ...roamy.snapshot,
    queue: [
      q('r-a', ['mission:d09', 'slice:1'], 'dev-build@starter', 'done'),
      q('r-b', ['mission:d09', 'slice:1'], 'dev-review@starter'),
    ],
  };
  return [m2, roamy];
}

function ctxFor(ms: FleetMachine[], calls: { verb: string; input: Record<string, unknown> }[]) {
  const socket = {
    connected: true,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    timeout: vi.fn(() => ({
      emit: (
        _e: string,
        req: { verb: string; input: Record<string, unknown> },
        cb: (err: null, a: unknown) => void
      ) => {
        calls.push(req);
        cb(null, { ok: false, error: { failureMode: 'not_found', message: 'none' } });
      },
    })),
  } as unknown as FleetSocket;
  return {
    machines: ms,
    allMachines: ms,
    rigs: [],
    activeRig: null,
    chooseRig: vi.fn(),
    pickedRig: null,
    groupBy: 'rig',
    now: Date.parse(T),
    link: 'connected',
    hubConnected: true,
    received: true,
    getSocket: () => socket,
    keys: true,
    hidden: [],
    onShowMachine: vi.fn(),
    onOpenSeat: vi.fn(),
    onOpenSkills: vi.fn(),
    onOpenAgent: vi.fn(),
    onOpenFiles: vi.fn(),
    goTo: vi.fn(),
    agentKey: null,
    openAgentPage: vi.fn(),
  } as V2Context;
}

describe('Missions keeps machines apart', () => {
  it('one mission id on two machines is two missions, each on one machine and one rig', () => {
    const ms = deriveMissions(twoMachines()).filter((m) => m.id === 'd09');
    expect(ms).toHaveLength(2);
    const byMachine = Object.fromEntries(ms.map((m) => [m.machines.join(','), m]));
    expect(Object.keys(byMachine).sort()).toEqual(['M2', 'Roamy']);
    expect(byMachine.M2!.rigs).toEqual([{ machineId: 'm2', rig: 'starter' }]);
    expect(byMachine.Roamy!.rigs).toEqual([{ machineId: 'roamy', rig: 'starter' }]);
    expect(byMachine.M2!.slices.map((s) => s.id)).toEqual(['chores']);
    expect(byMachine.Roamy!.slices.map((s) => s.id)).toEqual(['1']);
  });

  it('the page shows two cards with their machine chip, and each reads its own machine’s MISSION.md', async () => {
    const calls: { verb: string; input: Record<string, unknown> }[] = [];
    render(<missions.component ctx={ctxFor(twoMachines(), calls)} />);
    const cards = screen.getAllByTestId('ms-mission').filter((c) => c.dataset.mission === 'd09');
    expect(cards).toHaveLength(2);
    const chips = cards.map((c) => within(c).getByTestId('ms-machine').textContent);
    expect(chips.sort()).toEqual(['M2', 'Roamy']);
    // open each in turn: its rig.files call names only its own machine
    for (const card of cards) {
      calls.length = 0;
      const chip = within(card).getByTestId('ms-machine').textContent;
      const toggle = within(card).getByTestId('ms-toggle');
      // close it if it is the one open by default, then open it: a fresh read
      if (toggle.getAttribute('aria-expanded') === 'true') fireEvent.click(toggle);
      fireEvent.click(toggle);
      await waitFor(() => expect(calls.some((c) => c.verb === 'rig.files')).toBe(true));
      const asked = calls.filter((c) => c.verb === 'rig.files').map((c) => c.input.machine);
      expect([...new Set(asked)]).toEqual([chip === 'M2' ? 'm2' : 'roamy']);
    }
  });
});
