import type { FleetMachine, Seat, SeatStatus } from '@appydave/shared';
import { seatKey, type TileRef } from '@client/domain/fleet/model.js';
import { stripAnsi } from '@client/domain/fleet/terminal.js';

/** Seat counts and the blocked-seat readings the Fleet Strip, Wall and Needs-you pages show. */

export interface FleetCounts {
  seats: number;
  byStatus: Record<SeatStatus, number>;
  /** Seats on asleep machines: paused, not counted as working or idle. */
  paused: number;
}

export function countSeats(machines: FleetMachine[]): FleetCounts {
  const byStatus: Record<SeatStatus, number> = {
    working: 0,
    idle: 0,
    blocked: 0,
    stopped: 0,
    unknown: 0,
  };
  let seats = 0;
  let paused = 0;

  for (const fm of machines) {
    for (const seat of fm.snapshot.seats) {
      seats += 1;
      if (fm.liveness === 'asleep') {
        paused += 1;
      } else {
        byStatus[seat.status] += 1;
      }
    }
  }

  return { seats, byStatus, paused };
}

/** Blocked seats on live machines, the thing S1 has to surface in under 5 s. */
export function blockedSeats(machines: FleetMachine[]): TileRef[] {
  const out: TileRef[] = [];

  for (const fm of machines) {
    if (fm.liveness === 'asleep') {
      continue;
    }

    for (const seat of fm.snapshot.seats) {
      if (seat.status === 'blocked') {
        out.push({ key: seatKey(fm.machine.id, seat.id), machine: fm, seat });
      }
    }
  }

  return out;
}

export function findSeat(machines: Record<string, FleetMachine>, key: string): TileRef | null {
  const slash = key.indexOf('/');
  const fm = machines[key.slice(0, slash)];
  const seat = fm?.snapshot.seats.find((s) => s.id === key.slice(slash + 1));

  return fm && seat ? { key, machine: fm, seat } : null;
}

/** Plain-words reason for a blocked seat, best source first. */
export function blockedBecause(seat: Seat): string {
  return seat.blockedReason ?? seat.activity?.needsInputReason ?? 'needs input (no reason given)';
}

/**
 * S4: the question the terminal is showing, when the collector found it ("Allow this read outside
 * the working directories?"). Optional in the contract; blank or missing reads as none.
 */
export function blockedDetail(seat: Seat): string | null {
  // r1 L2: plain text only, whatever the collector sends: escape sequences out, then any stray
  // control byte (a lone ESC, BEL, CR…) becomes a space.
  // eslint-disable-next-line no-control-regex
  const text = stripAnsi(seat.blockedDetail ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ');

  return text.replace(/\s+/g, ' ').trim() || null;
}

/** "permission prompt — Allow this read outside the working directories?" (reason alone if no detail). */
export function blockedLine(seat: Seat): string {
  const detail = blockedDetail(seat);

  return detail ? `${blockedBecause(seat)} — ${detail}` : blockedBecause(seat);
}
