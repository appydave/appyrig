import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FleetMachine, FleetUpdate, MachineSnapshot } from '@appydave/shared';

/** The P0b AppyRig-shaped snapshots in test/fixtures/snapshots/, read from disk. */
export function snapshot(name: 'roamy' | 'roamy--blocked' | 'm2'): MachineSnapshot {
  const file = path.resolve(__dirname, '../../../test/fixtures/snapshots', `${name}.json`);

  return JSON.parse(readFileSync(file, 'utf8')) as MachineSnapshot;
}

export function fleetMachine(
  snap: MachineSnapshot,
  over: Partial<Pick<FleetMachine, 'liveness' | 'lastSeen'>> = {}
): FleetMachine {
  return {
    machine: snap.machine,
    liveness: over.liveness ?? 'live',
    lastSeen: over.lastSeen ?? new Date().toISOString(),
    snapshot: snap,
  };
}

export function update(machines: FleetMachine[], full = true): FleetUpdate {
  return { generatedAt: new Date().toISOString(), full, machines };
}
