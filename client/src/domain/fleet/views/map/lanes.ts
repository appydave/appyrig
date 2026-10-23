import { type FleetMachine } from '@appydave/shared';
import { type Endpoint, type RigRef } from '@client/domain/fleet/views/core/types.js';
import {
  type HandoffScan,
  type MapLane,
  type MapPod,
  type MapSeat,
  type OpenCount,
  type OutsideEnd,
} from '@client/domain/fleet/views/map/types.js';

const POD_ORDER = ['orch', 'lead', 'dev', 'build', 'qa', 'review', 'research'];

const podRank = (p: string) => {
  const i = POD_ORDER.indexOf(p);

  return i === -1 ? POD_ORDER.length : i;
};

export const NONE: OpenCount = { open: 0, stale: 0, oldestStaleMs: null };

const comparePods = (a: MapPod, b: MapPod) =>
  podRank(a.name) - podRank(b.name) || a.name.localeCompare(b.name);

/** The pod of that name in the list, added at the end on first use. */
function podIn(pods: MapPod[], name: string): MapPod {
  const found = pods.find((p) => p.name === name);

  if (found) {
    return found;
  }

  const pod: MapPod = { name, seats: [] };

  pods.push(pod);

  return pod;
}

export function homeLane(scan: HandoffScan, rig: RigRef): MapLane {
  const { home } = scan;
  const pods: MapPod[] = [];

  for (const seat of home.snapshot.seats.filter((s) => s.rig === scan.rigName)) {
    podIn(pods, seat.pod ?? 'seats').seats.push(scan.seatOf(home, seat));
  }

  return {
    machineId: home.machine.id,
    label: home.machine.label,
    liveness: home.liveness,
    subtitle: `rig ${scan.rigName} · ${rig.status}`,
    pods: pods.sort(comparePods),
  };
}

/** Outside endpoints: grouped by their machine (or "not placed" when we cannot find them). */
export function outsideLanes(scan: HandoffScan): MapLane[] {
  const lanes = new Map<string, MapLane>();

  for (const { fm, ep } of scan.outside.values()) {
    // Group by the seat's real pod; 'seats' is only the fallback when the pod is unknown.
    const pod = podIn(outsideLane(lanes, scan.home, fm).pods, ep.seat?.pod ?? 'seats');

    pod.seats.push(outsideSeat(scan, { fm, ep }));
  }

  for (const lane of lanes.values()) {
    lane.pods.sort(comparePods);
  }

  return [...lanes.values()];
}

function outsideLane(
  lanes: Map<string, MapLane>,
  home: FleetMachine,
  fm: FleetMachine | null
): MapLane {
  const id = fm?.machine.id ?? '?';
  const sameMachine = id === home.machine.id;
  const laneKey = sameMachine ? `${id}:other` : id;
  const found = lanes.get(laneKey);

  if (found) {
    return found;
  }

  const lane: MapLane = {
    machineId: laneKey,
    label: outsideLabel(fm, sameMachine),
    liveness: fm?.liveness ?? 'asleep',
    subtitle: fm ? 'talks to this rig' : 'queue names with no seat we can see',
    pods: [],
  };

  lanes.set(laneKey, lane);

  return lane;
}

function outsideLabel(fm: FleetMachine | null, sameMachine: boolean): string {
  if (!fm) {
    return 'Not placed';
  }

  return sameMachine ? `${fm.machine.label} · other rigs` : fm.machine.label;
}

function outsideSeat(scan: HandoffScan, { fm, ep }: OutsideEnd): MapSeat {
  return fm && ep.seat
    ? scan.seatOf(fm, ep.seat)
    : unplacedSeat(ep, scan.openAt.get(ep.key) ?? NONE);
}

function unplacedSeat(ep: Endpoint, c: OpenCount): MapSeat {
  return {
    key: ep.key,
    name: ep.raw,
    model: { text: 'unplaced', family: 'other' },
    pip: 'unknown',
    address: ep.raw,
    rig: null,
    source: 'tmux' as const,
    runtime: null,
    modelRaw: null,
    contextPct: null,
    contextTokens: null,
    activity: null,
    ...c,
  };
}
