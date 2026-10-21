import type { FleetMachine, Seat } from '@appydave/shared';
import { seatKey, type TileRef } from './model.js';

/** A tile (machine + seat) by its key `machine/seat`, searched across the given machines. */
export function findTile(machines: FleetMachine[], key: string | null): TileRef | null {
  if (!key) {
    return null;
  }
  const slash = key.indexOf('/');
  if (slash < 0) {
    return null;
  }
  const machineId = key.slice(0, slash);
  const seatId = key.slice(slash + 1);
  const machine = machines.find((m) => m.machine.id === machineId);
  const seat = machine?.snapshot.seats.find((s) => s.id === seatId);

  return machine && seat ? { key, machine, seat } : null;
}

/** Every seat of every machine, as tiles. */
export function allTiles(machines: FleetMachine[]): TileRef[] {
  return machines.flatMap((machine) =>
    machine.snapshot.seats.map((seat) => ({
      key: seatKey(machine.machine.id, seat.id),
      machine,
      seat,
    }))
  );
}

/** The ids a queue row may use for a seat: its session id, its logical id, and logical@rig. */
export function seatAddresses(seat: Seat): Set<string> {
  const ids = new Set([seat.id]);
  if (seat.logicalId) {
    ids.add(seat.logicalId);
    if (seat.rig) {
      ids.add(`${seat.logicalId}@${seat.rig}`);
    }
  }

  return ids;
}
