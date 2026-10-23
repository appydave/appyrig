import { type FleetMachine, type QueueItem, type Seat } from '@appydave/shared';
import { seatName } from '@client/domain/fleet/model.js';
import { bare, seatAnswersTo } from '@client/domain/fleet/views/core/addresses.js';
import { endpointRig } from '@client/domain/fleet/views/core/queue.js';
import {
  OUTSIDE,
  flowModeOf,
  rolesOrder,
  stageOf,
} from '@client/domain/fleet/views/flow/stages.js';
import { type FlowLayout } from '@client/domain/fleet/views/flow/types.js';

/** Seat mode shows at most this many boxes; the quietest endpoints share one "others" box. */
const MAX_SEAT_BOXES = 6;

export function flowLayout(fm: FleetMachine, rig: string, items: QueueItem[]): FlowLayout {
  const rigSeats = fm.snapshot.seats.filter((x) => x.rig === rig);
  const inRig = (raw: string | null) => endpointRig(fm, raw) === rig;
  const nameOf = seatNamer(rigSeats);
  const mode = flowModeOf([
    ...rigSeats.map(seatName),
    ...items.flatMap((q) => [q.source, q.destination].filter(inRig).map(nameOf)),
  ]);

  if (mode === 'roles') {
    return {
      rigSeats,
      mode,
      order: rolesOrder(items, inRig),
      inRig,
      nameOf,
      nodeOf: roleNodeOf(inRig, nameOf),
    };
  }

  const nodeOfRaw = (raw: string | null) => (inRig(raw) ? nameOf(raw) : (raw ?? '?'));
  const seatOrder = seatNodes(rigSeats, items, nodeOfRaw);

  return {
    rigSeats,
    mode,
    order: seatOrder,
    inRig,
    nameOf,
    nodeOf: seatNodeOf(seatOrder, nodeOfRaw),
  };
}

/** An in-rig address may be a logical id (`dev.qa@r`): read its stage from the seat's own name. */
function seatNamer(rigSeats: Seat[]): (raw: string | null) => string {
  return (raw) => {
    const seat = raw ? rigSeats.find((x) => seatAnswersTo(x, raw)) : undefined;

    return seat ? seatName(seat) : bare(raw);
  };
}

function roleNodeOf(
  inRig: (raw: string | null) => boolean,
  nameOf: (raw: string | null) => string
): (raw: string | null) => string {
  return (raw) => (inRig(raw) ? stageOf(nameOf(raw)) : OUTSIDE);
}

function seatNodeOf(
  seatOrder: string[],
  nodeOfRaw: (raw: string | null) => string
): (raw: string | null) => string {
  return (raw) => {
    const id = nodeOfRaw(raw);

    return seatOrder.includes(id) ? id : 'others';
  };
}

/**
 * Seats mode: one node per endpoint, in the order each first handed work on; the overflow shares an
 * "others" node.
 */
function seatNodes(
  rigSeats: Seat[],
  items: QueueItem[],
  nodeOfRaw: (raw: string | null) => string
): string[] {
  const { seatOrder, counts } = firstSeen(items, nodeOfRaw);
  const idle = rigSeats.map(seatName).filter((name) => !counts.has(name));
  const all = [...seatOrder, ...idle];

  return all.length > MAX_SEAT_BOXES ? capSeatBoxes(all, counts) : all;
}

/** Each endpoint in the order it first took part in a handoff, with how many handoffs it is in. */
function firstSeen(
  items: QueueItem[],
  nodeOfRaw: (raw: string | null) => string
): { seatOrder: string[]; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const seatOrder: string[] = [];

  for (const q of [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    for (const raw of [q.source, q.destination]) {
      const id = nodeOfRaw(raw);

      if (!counts.has(id)) {
        seatOrder.push(id);
      }

      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  return { seatOrder, counts };
}

/** Keep the busiest seats (in first-seen order) and fold the rest into "others". */
function capSeatBoxes(seatOrder: string[], counts: Map<string, number>): string[] {
  const keep = new Set(
    [...seatOrder]
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
      .slice(0, MAX_SEAT_BOXES - 1)
  );

  return [...seatOrder.filter((id) => keep.has(id)), 'others'];
}
