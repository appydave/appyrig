import { type FleetMachine, type Seat } from '@appydave/shared';
import { seatKey, seatName } from '@client/domain/fleet/model.js';
import { type Endpoint } from '@client/domain/fleet/views/core/types.js';
import { logicalAddresses } from '@client/domain/fleet/views/core/addresses.js';

/**
 * `dev-qa@fliedit-team` is a seat id on the machine whose queue holds it. `openrig-orch@roamy` names
 * another machine: the seat `openrig-orch` there (a plain tmux session). Anything else stays unplaced.
 */
export function resolveEndpoint(raw: string, home: FleetMachine, all: FleetMachine[]): Endpoint {
  const own = home.snapshot.seats.find((s) => s.id === raw);

  if (own) {
    return endpointOf(raw, home, own);
  }

  const hits = logicalHits(raw, home, all);

  if (!hits) {
    return unplacedEndpoint(raw);
  }

  return placeLogical(raw, home, hits) ?? placeByMachine(raw, all) ?? unplacedEndpoint(raw);
}

interface SeatHit {
  fm: FleetMachine;
  seat: Seat;
}

function unplacedEndpoint(raw: string): Endpoint {
  return { key: `?/${raw}`, raw, name: raw.split('@')[0] || raw, machineId: null, seat: null };
}

/**
 * The seats that answer to a logical id (`desk.planner@ylo-desk`), home machine first. It resolves
 * to the same key as the session-name form, so edges merge. Session ids are matched on the home
 * machine only (the caller does that): elsewhere `name@machineId` keeps its meaning, so this loop
 * matches logical forms only. Null when two seats on the home machine answer to the same logical id:
 * ambiguous, so we do not guess.
 */
function logicalHits(raw: string, home: FleetMachine, all: FleetMachine[]): SeatHit[] | null {
  const hits: SeatHit[] = [];

  for (const fm of [home, ...all.filter((m) => m !== home)]) {
    const found = fm.snapshot.seats.filter((x) => logicalAddresses(x).includes(raw));

    if (found.length > 1 && fm === home) {
      return null;
    }

    hits.push(...found.map((seat) => ({ fm, seat })));
  }

  return hits;
}

/**
 * A logical id is unique only per rig, so pick deterministically: home wins; else the single machine
 * that has it; else the single live one; else several candidates mean we do not guess (unplaced). A
 * full logical-id match beats the `name@machineId` reading. Null when nothing answered.
 */
function placeLogical(raw: string, home: FleetMachine, hits: SeatHit[]): Endpoint | null {
  const homeHit = hits.find((h) => h.fm === home);

  if (homeHit) {
    return endpointOf(raw, homeHit.fm, homeHit.seat);
  }

  const live = hits.filter((h) => h.fm.liveness === 'live');
  const pick = hits.length === 1 ? hits : live;

  if (pick.length === 1) {
    return endpointOf(raw, pick[0]!.fm, pick[0]!.seat);
  }

  return hits.length > 1 ? unplacedEndpoint(raw) : null;
}

/** `name@machineId`: the seat `name` on that machine, or null. */
function placeByMachine(raw: string, all: FleetMachine[]): Endpoint | null {
  const at = raw.lastIndexOf('@');

  if (at <= 0) {
    return null;
  }

  const name = raw.slice(0, at);
  const fm = all.find((m) => m.machine.id === raw.slice(at + 1));
  const seat = fm?.snapshot.seats.find((s) => s.id === name || s.id.split('@')[0] === name);

  return fm && seat ? endpointOf(raw, fm, seat) : null;
}

function endpointOf(raw: string, fm: FleetMachine, seat: Seat): Endpoint {
  return {
    key: seatKey(fm.machine.id, seat.id),
    raw,
    name: seatName(seat),
    machineId: fm.machine.id,
    seat,
  };
}
