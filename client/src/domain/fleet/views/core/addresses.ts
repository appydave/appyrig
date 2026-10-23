import { type Seat } from '@appydave/shared';

/**
 * The ways a queue address can name a seat: its session id, its OpenRig logical id (`desk.planner`,
 * which the daemon reports without a rig), or logical id plus rig (`desk.planner@ylo-desk`).
 * One helper for every caller so the forms cannot drift apart.
 */
function seatAddresses(seat: Seat): string[] {
  return [seat.id, ...logicalAddresses(seat)];
}

/** Logical forms only (no session id): `desk.planner` and `desk.planner@ylo-desk`. */
export function logicalAddresses(seat: Seat): string[] {
  return seat.logicalId ? [seat.logicalId, `${seat.logicalId}@${seat.rig}`] : [];
}

export function seatAnswersTo(seat: Seat, raw: string): boolean {
  return seatAddresses(seat).includes(raw);
}

export const bare = (raw: string | null) => (raw ?? '').split('@')[0] ?? '';

export const suffix = (id: string | null) => (id ? id.slice(id.lastIndexOf('@') + 1) : '');
