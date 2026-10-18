import type { FleetMachine, Seat } from '@appydave/shared';
import { agentActivityOf, groupSeats, pipFor } from '../../../fleet/model.js';

/** C22: the three "look here" filters, in AppyRig's own status words. */
export type WallFilter = 'all' | 'needs' | 'stuck' | 'failing';

/** A seat with work waiting that has done nothing for this long is "stuck". */
export const STUCK_AFTER_MS = 10 * 60_000;

export interface SeatFlags {
  /** Blocked on a person: a permission prompt or a question. */
  needs: boolean;
  /** Up, but OpenRig flags it for attention, or it has a blocked item, or work waits and its agent has been quiet for STUCK_AFTER_MS. */
  stuck: boolean;
  /** Stopped while its rig is running, or stopped and flagged by OpenRig. */
  failing: boolean;
}

export function seatFlags(seat: Seat, fm: FleetMachine, now: number): SeatFlags {
  if (fm.liveness === 'asleep') return { needs: false, stuck: false, failing: false };
  const pip = pipFor(seat, fm);
  const rig = seat.rig ? fm.snapshot.rigs.find((r) => r.name === seat.rig) : undefined;
  const attention = seat.lifecycleState === 'attention_required';
  // Failing is a seat that is down (stopped while its rig runs, or stopped and flagged by OpenRig).
  // A running seat OpenRig flags for attention is "stuck": it is up but needs a look.
  const failing = seat.status === 'stopped' && (attention || rig?.status === 'running');
  const open = seat.work.pending + seat.work.inProgress + seat.work.blocked;
  const at = agentActivityOf(seat);
  const quiet = at ? now - Date.parse(at) > STUCK_AFTER_MS : false;
  const stuck =
    pip !== 'blocked' &&
    pip !== 'stopped' &&
    (attention || seat.work.blocked > 0 || (pip !== 'working' && open > 0 && quiet));
  return { needs: pip === 'blocked', stuck, failing };
}

const matches = (f: WallFilter, flags: SeatFlags) =>
  f === 'all' ||
  (f === 'needs' && flags.needs) ||
  (f === 'stuck' && flags.stuck) ||
  (f === 'failing' && flags.failing);

export interface Team {
  key: string;
  name: string;
  where: string;
  machineId: string;
  seats: number;
}

/** The teams (rigs, per machine) the picker offers, in the Wall's own order. */
export function teamsOf(machines: FleetMachine[]): Team[] {
  return groupSeats(machines, 'rig').map((g) => ({
    key: g.key,
    name: g.rig?.displayName ?? g.name,
    where: g.where,
    machineId: g.tiles[0]?.machine.machine.id ?? '',
    seats: g.tiles.length,
  }));
}

const teamKeyOf = (fm: FleetMachine, seat: Seat) => `${fm.machine.id}:${seat.rig ?? '~tmux'}`;

export interface WallScope {
  hideStopped: boolean;
  /** Team keys the viewer switched off. */
  hiddenTeams: ReadonlySet<string>;
  filter: WallFilter;
}

export interface WallView {
  machines: FleetMachine[];
  /** Counts over the seats that pass the team and stopped choices (so the chips never read 0 because one is on). */
  counts: { all: number; needs: number; stuck: number; failing: number };
  stoppedHidden: number;
}

/** Seats the v2 Wall draws: team picker, Hide stopped, then the status filter. A machine left with no seats is dropped. */
export function wallView(machines: FleetMachine[], scope: WallScope, now: number): WallView {
  const counts = { all: 0, needs: 0, stuck: 0, failing: 0 };
  let stoppedHidden = 0;
  const out: FleetMachine[] = [];
  for (const fm of machines) {
    const kept: Seat[] = [];
    for (const seat of fm.snapshot.seats) {
      if (scope.hiddenTeams.has(teamKeyOf(fm, seat))) continue;
      const flags = seatFlags(seat, fm, now);
      // Hide stopped never hides a failing seat: a seat that is down while its rig runs is the news.
      if (scope.hideStopped && pipFor(seat, fm) === 'stopped' && !flags.failing) {
        stoppedHidden += 1;
        continue;
      }
      counts.all += 1;
      if (flags.needs) counts.needs += 1;
      if (flags.stuck) counts.stuck += 1;
      if (flags.failing) counts.failing += 1;
      if (matches(scope.filter, flags)) kept.push(seat);
    }
    if (kept.length > 0) out.push({ ...fm, snapshot: { ...fm.snapshot, seats: kept } });
  }
  return { machines: out, counts, stoppedHidden };
}
