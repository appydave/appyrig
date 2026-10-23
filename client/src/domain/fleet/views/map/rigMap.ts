import { type FleetMachine, type QueueItem, type Seat } from '@appydave/shared';
import { modelChip, pipFor, seatKey, seatName } from '@client/domain/fleet/model.js';
import { type Endpoint } from '@client/domain/fleet/views/core/types.js';
import { resolveEndpoint } from '@client/domain/fleet/views/core/endpoints.js';
import { isOpen, rigQueue } from '@client/domain/fleet/views/core/queue.js';
import { listRigs } from '@client/domain/fleet/views/core/rigList.js';
import {
  type HandoffScan,
  type MapEdge,
  type MapSeat,
  type OpenCount,
  type RigMap,
} from '@client/domain/fleet/views/map/types.js';
import { NONE, homeLane, outsideLanes } from '@client/domain/fleet/views/map/lanes.js';
import { oldestFirst, plannedEdges } from '@client/domain/fleet/views/map/edges.js';
import { STALE_MS, ms } from '@client/domain/fleet/views/core/time.js';

/** D09 W2: a spec edge kind in words, for the line's label ("delegates", "observes"). */
export function plannedWord(kind: string): string {
  if (kind.includes(',')) {
    return kind.split(',').map(plannedWord).join(' · ');
  }

  if (kind === 'delegates_to') {
    return 'delegates';
  }

  if (kind === 'can_observe') {
    return 'observes';
  }

  return kind.replace(/^can_/, '').replace(/_to$/, '').replace(/_/g, ' ');
}

function mapSeat(fm: FleetMachine, seat: Seat, c: OpenCount): MapSeat {
  return {
    key: seatKey(fm.machine.id, seat.id),
    name: seatName(seat),
    model: modelChip(seat),
    pip: pipFor(seat, fm),
    skills: seat.skillCount,
    address: seat.id,
    rig: seat.rig,
    source: seat.source,
    runtime: seat.runtime,
    modelRaw: seat.model,
    contextPct: seat.contextUsedPct,
    contextTokens: seat.contextTokens ?? null,
    activity: seat.activity?.display ?? null,
    ...(seat.agentRole !== undefined ? { agentRole: seat.agentRole } : {}),
    ...(seat.keySkills ? { keySkills: seat.keySkills } : {}),
    ...c,
  };
}

/**
 * One rig as lanes: its own machine first (pods as bands), then any other machine whose seats
 * exchanged queue items with it (e.g. Roamy's openrig-orch briefing the M2's lead).
 */
export function buildRigMap(
  machines: FleetMachine[],
  rigKey: string,
  now: number = Date.now()
): RigMap | null {
  const rig = listRigs(machines).find((r) => r.key === rigKey);
  const home = machines.find((m) => m.machine.id === rig?.machineId);

  if (!rig || !home) {
    return null;
  }

  const items = rigQueue(home, rig.name);
  const openAt = new Map<string, OpenCount>();
  const scan: HandoffScan = {
    machines,
    home,
    rigName: rig.name,
    now,
    edges: new Map<string, MapEdge>(),
    openAt,
    outside: new Map(),
    seatOf: (fm, seat): MapSeat =>
      mapSeat(fm, seat, openAt.get(seatKey(fm.machine.id, seat.id)) ?? NONE),
  };

  for (const q of items) {
    recordHandoff(scan, q);
  }

  return {
    rig,
    lanes: [homeLane(scan, rig), ...outsideLanes(scan)],
    edges: oldestFirst(scan.edges),
    handoffs: rig.handoffs,
    outgoing: items.length - rig.handoffs,
    planned: plannedEdges(home, rig.name, scan.edges),
  };
}

function recordHandoff(scan: HandoffScan, q: QueueItem): void {
  if (!q.source || !q.destination) {
    return;
  }

  const from = resolveEndpoint(q.source, scan.home, scan.machines);
  const to = resolveEndpoint(q.destination, scan.home, scan.machines);

  noteOutside(scan, from);
  noteOutside(scan, to);

  const e = edgeBetween(scan.edges, from, to);

  e.count += 1;
  e.items.push(q);

  if (isOpen(q)) {
    countOpen(scan, e, { toKey: to.key, age: scan.now - ms(q.createdAt) });
  }
}

function noteOutside(scan: HandoffScan, ep: Endpoint): void {
  const inRig = ep.machineId === scan.home.machine.id && ep.seat?.rig === scan.rigName;

  if (!inRig) {
    scan.outside.set(ep.key, {
      fm: scan.machines.find((m) => m.machine.id === ep.machineId) ?? null,
      ep,
    });
  }
}

/** The line from one endpoint to another, created (and remembered) on its first handoff. */
function edgeBetween(edges: Map<string, MapEdge>, from: Endpoint, to: Endpoint): MapEdge {
  const k = `${from.key}→${to.key}`;
  const e: MapEdge = edges.get(k) ?? {
    from: from.key,
    to: to.key,
    count: 0,
    open: 0,
    stale: 0,
    self: from.key === to.key,
    items: [],
  };

  edges.set(k, e);

  return e;
}

/** An open item counts on its line and against the receiving seat: fresh (waiting) or stale (left behind). */
function countOpen(scan: HandoffScan, e: MapEdge, open: { toKey: string; age: number }): void {
  const c = { ...(scan.openAt.get(open.toKey) ?? NONE) };

  if (open.age > STALE_MS) {
    e.stale += 1;
    c.stale += 1;
    c.oldestStaleMs = Math.max(c.oldestStaleMs ?? 0, open.age);
  } else {
    e.open += 1;
    c.open += 1;
  }

  scan.openAt.set(open.toKey, c);
}
