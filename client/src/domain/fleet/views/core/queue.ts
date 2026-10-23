import { type FleetMachine, type QueueItem, type Seat } from '@appydave/shared';
import { bare, logicalAddresses, suffix } from '@client/domain/fleet/views/core/addresses.js';

/**
 * Closed states. `handed-off` is closed too: the receiver passed the work on (a QA seat hands a
 * builder's item to review), so it is no longer waiting. Anything else (pending, in-progress,
 * blocked, a state OpenRig adds later) counts as open, so a new state never hides waiting work.
 */
const CLOSED = new Set([
  'done',
  'handed-off',
  'closed',
  'cancelled',
  'canceled',
  'rejected',
  'expired',
]);

/** Open = still in someone's inbox. */
export function isOpen(item: QueueItem): boolean {
  return !CLOSED.has(item.state);
}

const seatRigs = new WeakMap<FleetMachine['snapshot'], Map<string, string | null>>();

/**
 * Fix-first F1 (truth E1): the rig a queue endpoint belongs to. A seat the machine reports belongs
 * to its own rig, the same rule as the collector's `recentAt`. `human@<rig>` is David's mailbox,
 * not a seat, so it belongs to no rig (`human@kernel` is not the kernel rig). A name no seat list
 * knows falls back to its `@rig` suffix.
 */
export function endpointRig(fm: FleetMachine, raw: string | null): string | null {
  if (!raw || bare(raw) === 'human') {
    return null;
  }

  const rigs = seatRigIndex(fm);

  return rigs.has(raw) ? (rigs.get(raw) ?? null) : suffix(raw) || null;
}

/** Every address a seat answers to, mapped to its rig (null where two rigs share the address). */
function seatRigIndex(fm: FleetMachine): Map<string, string | null> {
  const cached = seatRigs.get(fm.snapshot);

  if (cached) {
    return cached;
  }

  const rigs = buildSeatRigIndex(fm.snapshot.seats);

  seatRigs.set(fm.snapshot, rigs);

  return rigs;
}

function buildSeatRigIndex(seats: Seat[]): Map<string, string | null> {
  const rigs = new Map<string, string | null>();

  // A logical form shared by seats in different rigs is ambiguous: null, same as resolveEndpoint.
  for (const s of seats) {
    for (const a of logicalAddresses(s)) {
      rigs.set(a, rigs.has(a) && rigs.get(a) !== s.rig ? null : s.rig);
    }
  }

  for (const s of seats) {
    rigs.set(s.id, s.rig);
  }

  return rigs;
}

/**
 * F1: the one rig an item counts towards: the rig of the seat that does the work (destination),
 * else the sender's rig (a report to David's mailbox). Rig totals count each item once this way.
 */
export function ownerRig(fm: FleetMachine, q: QueueItem): string | null {
  return endpointRig(fm, q.destination) ?? endpointRig(fm, q.source);
}

/** Queue rows that start or end inside this rig: its own work and what it sent to other rigs. */
export function rigQueue(fm: FleetMachine, rig: string): QueueItem[] {
  return fm.snapshot.queue.filter(
    (q) => endpointRig(fm, q.source) === rig || endpointRig(fm, q.destination) === rig
  );
}
