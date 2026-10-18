import type { FleetMachine, QueueItem, Seat } from '@appydave/shared';
import { modelChip, pipFor, seatKey, seatName, type PipKey } from '../../../fleet/model.js';
import {
  buildRigMap,
  endpointRig,
  isOpen,
  listRigs,
  resolveEndpoint,
  STALE_MS,
  type MapEdge,
  type MapPod,
  type MapSeat,
  type RigRef,
} from '../../../fleet/views.js';

/**
 * v2 Graph (C41/C42): every rig on every machine on one page, and the traffic BETWEEN rigs.
 * Pure: a function of the fleet and a time, built on the shared data layer (buildRigMap,
 * resolveEndpoint, endpointRig) read-only. The page draws what this returns.
 */

/** A node the cross-rig lines join: a rig, or one machine's sessions that belong to no rig. */
export type GroupKey = string;

/** `m2:~loose`: the sessions on a machine that are in no rig (orchestrators, research seats). */
export const LOOSE = '~loose';
export const looseKey = (machineId: string): GroupKey => `${machineId}:${LOOSE}`;
export const isLoose = (key: GroupKey) => key.endsWith(`:${LOOSE}`);

/** What the filter buttons (C22) look for, on a seat. */
export interface SeatFlags {
  /** Blocked, or it asked David something that is still open and fresh. */
  needsMe: boolean;
  /** Work addressed to it has sat open longer than STALE_MS. */
  stuck: boolean;
  /** Down (stopped / unknown) while its rig is running, or OpenRig left recovery guidance. */
  failing: boolean;
}

export interface GraphSeat extends MapSeat {
  flags: SeatFlags;
  pod: string;
}

export interface GraphPod extends Omit<MapPod, 'seats'> {
  seats: GraphSeat[];
}

export interface GraphRig {
  key: GroupKey;
  machineId: string;
  machineLabel: string;
  name: string;
  /** Null for the loose group. */
  ref: RigRef | null;
  /** RigState for a rig; the loose group reads 'idle' / 'working' / 'attention' from its seats. */
  state: RigRef['state'];
  pods: GraphPod[];
  agents: number;
  /** Seats working or blocked right now. */
  active: number;
  /** Real handoff lines inside the rig (both ends are its seats), counts from the queue. */
  edges: MapEdge[];
  /** Planned lines from the rig spec (dotted); null: the collector did not send the spec's edges. */
  planned: MapEdge[] | null;
  /** Items this rig handed to, and took from, other rigs. */
  crossOut: number;
  crossIn: number;
  flags: { needsMe: number; stuck: number; failing: number };
}

export interface GraphMachine {
  id: string;
  label: string;
  liveness: FleetMachine['liveness'];
  rigs: GraphRig[];
  /** The machine's sessions in no rig, or null when it has none. */
  loose: GraphRig | null;
}

/** Traffic from one rig (or loose group) to another, counted from queue rows. */
export interface CrossEdge {
  from: GroupKey;
  to: GroupKey;
  count: number;
  /** Open and fresh. */
  open: number;
  /** Open but older than STALE_MS. */
  stale: number;
  /** Oldest first. */
  items: QueueItem[];
}

export interface Graph {
  machines: GraphMachine[];
  cross: CrossEdge[];
  unplaced: Unplaced;
  totals: { rigs: number; agents: number; active: number };
}

const ms = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

const bare = (raw: string | null) => (raw ?? '').split('@')[0] ?? '';

/**
 * The group a queue endpoint belongs to: the rig of the seat it names (on whichever machine it
 * resolves to), else that machine's loose group, else a `name@rig` suffix naming a rig on the
 * queue's own machine. David's mailbox (`human@…`) and names no machine reports give null.
 */
export function endpointGroup(
  raw: string | null,
  home: FleetMachine,
  all: FleetMachine[]
): GroupKey | null {
  if (!raw || bare(raw) === 'human') return null;
  const ep = resolveEndpoint(raw, home, all);
  if (ep.seat && ep.machineId) {
    const fm = all.find((m) => m.machine.id === ep.machineId);
    const rig = ep.seat.rig;
    if (rig && fm?.snapshot.rigs.some((r) => r.name === rig)) return `${ep.machineId}:${rig}`;
    return looseKey(ep.machineId);
  }
  const rig = endpointRig(home, raw);
  if (rig && home.snapshot.rigs.some((r) => r.name === rig)) return `${home.machine.id}:${rig}`;
  return null;
}

/** Cross-rig traffic over every machine's queue; an item seen on two machines counts once. */
export function crossRigEdges(
  machines: FleetMachine[],
  now: number
): { edges: CrossEdge[]; unplaced: Unplaced } {
  const seen = new Set<string>();
  const map = new Map<string, CrossEdge>();
  let unplaced = 0;
  const names = new Map<string, number>();
  for (const home of machines) {
    for (const q of home.snapshot.queue) {
      if (seen.has(q.id)) continue;
      seen.add(q.id);
      if (!q.source || !q.destination) continue;
      if (bare(q.source) === 'human' || bare(q.destination) === 'human') continue;
      const from = endpointGroup(q.source, home, machines);
      const to = endpointGroup(q.destination, home, machines);
      if (!from || !to) {
        unplaced += 1;
        const missing = new Set<string>();
        for (const [raw, g] of [
          [q.source, from],
          [q.destination, to],
        ] as const) {
          if (!g) missing.add(raw.includes('@') ? raw.slice(raw.lastIndexOf('@') + 1) : raw);
        }
        for (const where of missing) names.set(where, (names.get(where) ?? 0) + 1);
        continue;
      }
      if (from === to) continue;
      const k = `${from}→${to}`;
      const e = map.get(k) ?? { from, to, count: 0, open: 0, stale: 0, items: [] };
      e.count += 1;
      e.items.push(q);
      if (isOpen(q)) {
        if (now - ms(q.createdAt) > STALE_MS) e.stale += 1;
        else e.open += 1;
      }
      map.set(k, e);
    }
  }
  const edges = [...map.values()]
    .map((e) => ({
      ...e,
      items: [...e.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    }))
    .sort((a, b) => b.count - a.count || `${a.from}${a.to}`.localeCompare(`${b.from}${b.to}`));
  return {
    edges,
    unplaced: {
      count: unplaced,
      names: [...names.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([name, count]) => ({ name, count })),
    },
  };
}

/** Queue rows with an end no machine reports (a removed rig such as `ylo-thumbs`): counted, not drawn. */
export interface Unplaced {
  count: number;
  /** The rig (or machine) part of the names we could not place, most rows first. */
  names: { name: string; count: number }[];
}

const POD_ORDER = ['orch', 'lead', 'dev', 'build', 'qa', 'review', 'research'];
const podRank = (p: string) => {
  const i = POD_ORDER.indexOf(p);
  return i === -1 ? POD_ORDER.length : i;
};

/** Open items each seat addressed to David's mailbox, still fresh. */
function askedDavid(fm: FleetMachine, now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const q of fm.snapshot.queue) {
    if (bare(q.destination) !== 'human' || !q.source || !isOpen(q)) continue;
    if (now - ms(q.createdAt) > STALE_MS) continue;
    const seat = fm.snapshot.seats.find((s) => s.id === q.source || s.logicalId === q.source);
    if (seat) out.set(seat.id, (out.get(seat.id) ?? 0) + 1);
  }
  return out;
}

function flagsOf(seat: Seat, ms: MapSeat, rigRunning: boolean, asked: number): SeatFlags {
  const down: PipKey[] = ['stopped', 'unknown'];
  return {
    needsMe: ms.pip === 'blocked' || asked > 0,
    stuck: ms.stale > 0,
    failing:
      ms.pip !== 'asleep' && ((rigRunning && down.includes(ms.pip)) || !!seat.recoveryGuidance),
  };
}

const countFlags = (pods: GraphPod[]) => {
  const seats = pods.flatMap((p) => p.seats);
  return {
    needsMe: seats.filter((s) => s.flags.needsMe).length,
    stuck: seats.filter((s) => s.flags.stuck).length,
    failing: seats.filter((s) => s.flags.failing).length,
  };
};

const isActive = (s: MapSeat) => s.pip === 'working' || s.pip === 'blocked';

function sortPods(pods: GraphPod[]): GraphPod[] {
  return pods.sort((a, b) => podRank(a.name) - podRank(b.name) || a.name.localeCompare(b.name));
}

/** One machine's sessions in no rig, as a group with one "sessions" pod. */
function looseGroup(fm: FleetMachine, asked: Map<string, number>): GraphRig | null {
  const seats = fm.snapshot.seats.filter(
    (s) => !s.rig || !fm.snapshot.rigs.some((r) => r.name === s.rig)
  );
  if (!seats.length) return null;
  const gs: GraphSeat[] = seats.map((seat) => {
    const m: MapSeat = {
      key: seatKey(fm.machine.id, seat.id),
      name: seatName(seat),
      model: modelChip(seat),
      pip: pipFor(seat, fm),
      skills: seat.skillCount,
      address: seat.id,
      rig: null,
      source: seat.source,
      runtime: seat.runtime,
      modelRaw: seat.model,
      contextPct: seat.contextUsedPct,
      contextTokens: seat.contextTokens ?? null,
      activity: seat.activity?.display ?? null,
      open: 0,
      stale: 0,
      oldestStaleMs: null,
    };
    return {
      ...m,
      pod: 'sessions',
      flags: flagsOf(seat, m, false, asked.get(seat.id) ?? 0),
    };
  });
  const pods = [{ name: 'sessions', seats: gs }];
  const active = gs.filter(isActive).length;
  return {
    key: looseKey(fm.machine.id),
    machineId: fm.machine.id,
    machineLabel: fm.machine.label,
    name: 'no rig',
    ref: null,
    state:
      fm.liveness === 'asleep'
        ? 'asleep'
        : gs.some((s) => s.pip === 'blocked')
          ? 'attention'
          : active
            ? 'working'
            : 'idle',
    pods,
    agents: gs.length,
    active,
    edges: [],
    planned: [],
    crossOut: 0,
    crossIn: 0,
    flags: countFlags(pods),
  };
}

/** The whole fleet as a graph: machines, their rigs (pods, seats, in-rig lines) and cross-rig lines. */
export function buildGraph(machines: FleetMachine[], now: number = Date.now()): Graph {
  const refs = listRigs(machines);
  const { edges: cross, unplaced } = crossRigEdges(machines, now);
  const out: GraphMachine[] = machines.map((fm) => {
    const asked = askedDavid(fm, now);
    const rigs: GraphRig[] = refs
      .filter((r) => r.machineId === fm.machine.id)
      .map((ref) => {
        const map = buildRigMap(machines, ref.key, now);
        const home = map?.lanes[0];
        const running = ref.status === 'running';
        const pods: GraphPod[] = sortPods(
          (home?.pods ?? []).map((p) => ({
            name: p.name,
            seats: p.seats.map((s) => {
              const seat = fm.snapshot.seats.find((x) => seatKey(fm.machine.id, x.id) === s.key)!;
              return {
                ...s,
                pod: p.name,
                flags: flagsOf(seat, s, running, asked.get(seat.id) ?? 0),
              };
            }),
          }))
        );
        const mine = new Set(pods.flatMap((p) => p.seats.map((s) => s.key)));
        const seats = pods.flatMap((p) => p.seats);
        return {
          key: ref.key,
          machineId: fm.machine.id,
          machineLabel: fm.machine.label,
          name: ref.name,
          ref,
          state: ref.state,
          pods,
          agents: seats.length,
          active: seats.filter(isActive).length,
          edges: (map?.edges ?? []).filter((e) => mine.has(e.from) && mine.has(e.to)),
          planned: map?.planned ?? null,
          crossOut: cross.filter((e) => e.from === ref.key).reduce((n, e) => n + e.count, 0),
          crossIn: cross.filter((e) => e.to === ref.key).reduce((n, e) => n + e.count, 0),
          flags: countFlags(pods),
        };
      });
    const loose = looseGroup(fm, asked);
    if (loose) {
      loose.crossOut = cross.filter((e) => e.from === loose.key).reduce((n, e) => n + e.count, 0);
      loose.crossIn = cross.filter((e) => e.to === loose.key).reduce((n, e) => n + e.count, 0);
    }
    return { id: fm.machine.id, label: fm.machine.label, liveness: fm.liveness, rigs, loose };
  });
  const all = out.flatMap((m) => [...m.rigs, ...(m.loose ? [m.loose] : [])]);
  return {
    machines: out,
    cross,
    unplaced,
    totals: {
      rigs: refs.length,
      agents: all.reduce((n, r) => n + r.agents, 0),
      active: all.reduce((n, r) => n + r.active, 0),
    },
  };
}

export function allGroups(g: Graph): GraphRig[] {
  return g.machines.flatMap((m) => [...m.rigs, ...(m.loose ? [m.loose] : [])]);
}

/** C22: the three filters. */
export type FlagFilter = keyof SeatFlags;
export const FLAG_FILTERS: { key: FlagFilter; label: string; glyph: string; hint: string }[] = [
  {
    key: 'needsMe',
    label: 'Needs me',
    glyph: '▲',
    hint: 'Blocked, or asked David something still open',
  },
  {
    key: 'stuck',
    label: 'Stuck',
    glyph: '⌛',
    hint: 'Work addressed to it left open over 2 h',
  },
  {
    key: 'failing',
    label: 'Failing',
    glyph: '✕',
    hint: 'Down while its rig is running, or OpenRig left recovery guidance',
  },
];

/** Rigs open by default: running ones on a machine that is awake, and the picked one. */
export function openByDefault(rig: GraphRig, picked: string | null): boolean {
  if (rig.key === picked) return true;
  if (!rig.ref) return false;
  return rig.ref.status === 'running' && rig.state !== 'asleep';
}

/** A rig shows under a flag filter when a seat in it carries the flag (or, for Needs me, OpenRig flags the rig). */
export function rigMatches(r: GraphRig, f: FlagFilter | null): boolean {
  if (!f) return true;
  if (f === 'needsMe' && r.ref && r.state === 'attention') return true;
  return r.pods.some((p) => p.seats.some((s) => s.flags[f]));
}
