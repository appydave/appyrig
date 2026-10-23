import { type FleetMachine, type QueueItem, type Seat } from '@appydave/shared';
import { agentActivityOf, pipFor } from '@client/domain/fleet/model.js';
import { rigState } from '@client/domain/fleet/views/core/rigState.js';
import { type RigRef } from '@client/domain/fleet/views/core/types.js';
import { ownerRig, rigQueue } from '@client/domain/fleet/views/core/queue.js';

/** Every rig on every machine: running first, then the most recent sign of life (a queue row or a seat). */
export function listRigs(machines: FleetMachine[]): RigRef[] {
  const out = machines.flatMap((fm) => fm.snapshot.rigs.map((rig) => rigRef(fm, rig)));
  // S3: every rig list reads running first, then most recent (Wall groups, Map and Flow chips).
  const running = (r: RigRef) => (r.status === 'running' ? 0 : 1);

  return out.sort(
    (a, b) =>
      running(a) - running(b) ||
      (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '') ||
      a.key.localeCompare(b.key)
  );
}

function rigRef(fm: FleetMachine, rig: FleetMachine['snapshot']['rigs'][number]): RigRef {
  const items = rigQueue(fm, rig.name);
  const seats = fm.snapshot.seats.filter((s) => s.rig === rig.name);

  return {
    key: `${fm.machine.id}:${rig.name}`,
    machineId: fm.machine.id,
    machineLabel: fm.machine.label,
    name: rig.name,
    status: rig.status,
    state: rigState({
      liveness: fm.liveness,
      status: rig.status,
      attentionCount: rig.attentionCount,
      seatPips: seats.map((s) => pipFor(s, fm)),
    }),
    seatCount: seats.length,
    // F1: each item once, on the rig doing the work (a rig's outgoing items are not its total).
    handoffs: items.filter((q) => ownerRig(fm, q) === rig.name).length,
    // The collector's recentAt is the same rule computed over the full queue; prefer it.
    lastActivity: rig.recentAt !== undefined ? rig.recentAt : lastSignOfLife(items, seats),
    displayName: rig.displayName,
    owner: rig.owner,
    summary: rig.summary,
    specPath: rig.specPath,
    specStatus: rig.specStatus,
  };
}

/** Most recent sign of life: a queue row moving, or any of its seats doing something. */
function lastSignOfLife(items: QueueItem[], seats: Seat[]): string | null {
  return [...items.map((q) => q.updatedAt), ...seats.map(agentActivityOf)].reduce<string | null>(
    (acc, at) => (at && (acc === null || at > acc) ? at : acc),
    null
  );
}
