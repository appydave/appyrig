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
 * Per-machine work is cached on the machine's snapshot object (a WeakMap): the hub resends only the
 * machines that changed, so an unchanged machine costs nothing on the next rebuild. A key carries
 * whatever else the value depends on (the clock bucket, the machine's liveness).
 */
const memo = new WeakMap<object, Map<string, unknown>>();
function cached<T>(snap: object, key: string, make: () => T): T {
  let m = memo.get(snap);
  if (!m) memo.set(snap, (m = new Map()));
  if (m.has(key)) return m.get(key) as T;
  const v = make();
  if (m.size > 300) m.clear(); // clock buckets pile up on a snapshot that never changes
  m.set(key, v);
  return v;
}

/**
 * Endpoint placement depends on every machine's seats (a name resolves on whichever machine has
 * it), so its cache is valid only while the fleet's seat lists are the same. `fleetSeatsSig` is
 * that fingerprint; a change drops every cached placement.
 */
let placementSig = '';
let placements = new WeakMap<object, Map<string, GroupKey | null>>();
const fleetSeatsSig = (all: FleetMachine[]) =>
  all
    .map(
      (m) =>
        `${m.machine.id}:${m.liveness}:` +
        m.snapshot.seats.map((s) => `${s.id}|${s.rig ?? ''}|${s.logicalId ?? ''}`).join(',') +
        ':' +
        m.snapshot.rigs.map((r) => r.name).join(',')
    )
    .join(';');

/**
 * The group a queue endpoint belongs to: the rig of the seat it names (on whichever machine it
 * resolves to), else that machine's loose group, else a `name@rig` suffix naming a rig on the
 * queue's own machine, else (MEDIUM-2) a `name@<machine id>` whose session is no longer a seat:
 * that machine's no-rig group, so a line between the columns is still drawn. David's mailbox
 * (`human@…`) and names no machine reports give null.
 */
export function endpointGroup(
  raw: string | null,
  home: FleetMachine,
  all: FleetMachine[]
): GroupKey | null {
  if (!raw || bare(raw) === 'human') return null;
  const sig = fleetSeatsSig(all);
  if (sig !== placementSig) {
    placementSig = sig;
    placements = new WeakMap();
  }
  let byRaw = placements.get(home.snapshot);
  if (!byRaw) placements.set(home.snapshot, (byRaw = new Map()));
  if (byRaw.has(raw)) return byRaw.get(raw) ?? null;
  const g = placeEndpoint(raw, home, all);
  byRaw.set(raw, g);
  return g;
}

const hasLoose = (fm: FleetMachine): boolean =>
  fm.snapshot.seats.some((s) => !s.rig || !fm.snapshot.rigs.some((r) => r.name === s.rig));

function placeEndpoint(raw: string, home: FleetMachine, all: FleetMachine[]): GroupKey | null {
  const ep = resolveEndpoint(raw, home, all);
  if (ep.seat && ep.machineId) {
    const fm = all.find((m) => m.machine.id === ep.machineId);
    const rig = ep.seat.rig;
    if (rig && fm?.snapshot.rigs.some((r) => r.name === rig)) return `${ep.machineId}:${rig}`;
    return looseKey(ep.machineId);
  }
  const rig = endpointRig(home, raw);
  if (rig && home.snapshot.rigs.some((r) => r.name === rig)) return `${home.machine.id}:${rig}`;
  // `openrig-orch@roamy` where that session is not a seat any more: its machine's no-rig group.
  const where = raw.includes('@') ? raw.slice(raw.lastIndexOf('@') + 1) : '';
  const there = where ? all.find((m) => m.machine.id === where) : undefined;
  if (there && hasLoose(there)) return looseKey(where);
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
  const machineIds = new Set(machines.map((m) => m.machine.id));
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
        .map(([name, count]) => ({
          name,
          count,
          kind: (machineIds.has(name) ? 'machine' : 'rig') as 'machine' | 'rig',
        })),
      byKind: {
        machine: [...names.entries()].reduce((n, [k, c]) => n + (machineIds.has(k) ? c : 0), 0),
        rig: [...names.entries()].reduce((n, [k, c]) => n + (machineIds.has(k) ? 0 : c), 0),
      },
    },
  };
}

/** Queue rows with an end no machine reports (a removed rig such as `ylo-thumbs`): counted, not drawn. */
export interface Unplaced {
  count: number;
  /** The rig (or machine) part of the names we could not place, most rows first. */
  names: { name: string; count: number; kind: 'machine' | 'rig' }[];
  /** The same rows counted by what the unplaced name is: a machine we know, or a rig no machine reports. */
  byKind: { machine: number; rig: number };
}

const POD_ORDER = ['orch', 'lead', 'dev', 'build', 'qa', 'review', 'research'];
const podRank = (p: string) => {
  const i = POD_ORDER.indexOf(p);
  return i === -1 ? POD_ORDER.length : i;
};

/** Open items each seat addressed to David's mailbox, still fresh. */
const askedDavid = (fm: FleetMachine, now: number): Map<string, number> =>
  cached(fm.snapshot, `asked:${now}`, () => askedDavidOf(fm, now));

function askedDavidOf(fm: FleetMachine, now: number): Map<string, number> {
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

/** One rig's map from a view of its own machine only: a rig's in-rig lines never need the others. */
function rigMapOf(fm: FleetMachine, ref: RigRef, now: number) {
  return cached(fm.snapshot, `map:${ref.name}:${fm.liveness}:${now}`, () => {
    // buildRigMap lists every rig of the machines it is given; handing it this rig alone keeps a
    // 23-rig fleet from listing 23 rigs 23 times. The seats stay whole (name resolution needs them).
    const slim: FleetMachine = cached(fm.snapshot, `slim:${ref.name}:${fm.liveness}`, () => ({
      ...fm,
      snapshot: {
        ...fm.snapshot,
        rigs: fm.snapshot.rigs.filter((r) => r.name === ref.name),
      },
    }));
    return buildRigMap([slim], ref.key, now);
  });
}

/** The whole fleet as a graph: machines, their rigs (pods, seats, in-rig lines) and cross-rig lines. */
export function buildGraph(machines: FleetMachine[], now: number = Date.now()): Graph {
  // Each machine's rig list once; listRigs on one machine is the same rows, in the same order.
  const refsOf = (fm: FleetMachine) =>
    cached(fm.snapshot, `refs:${fm.liveness}`, () => listRigs([fm]));
  const { edges: cross, unplaced } = crossRigEdges(machines, now);
  const out: Map<string, number> = new Map();
  const into: Map<string, number> = new Map();
  for (const e of cross) {
    out.set(e.from, (out.get(e.from) ?? 0) + e.count);
    into.set(e.to, (into.get(e.to) ?? 0) + e.count);
  }
  let rigCount = 0;
  const built: GraphMachine[] = machines.map((fm) => {
    const asked = askedDavid(fm, now);
    const refs = refsOf(fm);
    rigCount += refs.length;
    const rigs: GraphRig[] = refs.map((ref) => {
      const crossOut = out.get(ref.key) ?? 0;
      const crossIn = into.get(ref.key) ?? 0;
      // The same object while nothing it is made of has changed, so memo(RigFrame) can skip it.
      return cached(
        fm.snapshot,
        `rig:${ref.key}:${fm.liveness}:${now}:${crossOut}:${crossIn}:${ref.state}`,
        () => {
          const map = rigMapOf(fm, ref, now);
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
            crossOut,
            crossIn,
            flags: countFlags(pods),
          } satisfies GraphRig;
        }
      );
    });
    const loose = cached(
      fm.snapshot,
      `loose:${fm.liveness}:${now}:${out.get(looseKey(fm.machine.id)) ?? 0}:${into.get(looseKey(fm.machine.id)) ?? 0}`,
      () => {
        const l = looseGroup(fm, asked);
        if (l) {
          l.crossOut = out.get(l.key) ?? 0;
          l.crossIn = into.get(l.key) ?? 0;
        }
        return l;
      }
    );
    return { id: fm.machine.id, label: fm.machine.label, liveness: fm.liveness, rigs, loose };
  });
  const all = built.flatMap((m) => [...m.rigs, ...(m.loose ? [m.loose] : [])]);
  return {
    machines: built,
    cross,
    unplaced,
    totals: {
      rigs: rigCount,
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

/** A machine with more rigs than this starts its running rigs folded (UX ruling 2). */
export const CROWDED_RIGS = 8;

const flagged = (r: GraphRig) =>
  r.flags.needsMe > 0 || r.flags.stuck > 0 || r.flags.failing > 0 || r.state === 'attention';

/**
 * Rigs open by default: running ones on a machine that is awake, and the picked one. On a crowded
 * machine (more than CROWDED_RIGS rigs) only the picked and the flagged ones, so the page stays
 * short enough to read.
 */
export function openByDefault(rig: GraphRig, picked: string | null, crowded = false): boolean {
  if (rig.key === picked) return true;
  if (!rig.ref) return false;
  if (crowded) return rig.ref.status === 'running' && rig.state !== 'asleep' && flagged(rig);
  return rig.ref.status === 'running' && rig.state !== 'asleep';
}

/** True for a rig on a machine holding more than CROWDED_RIGS rigs. */
export const isCrowded = (g: Graph, rig: GraphRig): boolean =>
  (g.machines.find((m) => m.id === rig.machineId)?.rigs.length ?? 0) > CROWDED_RIGS;

/** A rig shows under a flag filter when a seat in it carries the flag (or, for Needs me, OpenRig flags the rig). */
export function rigMatches(r: GraphRig, f: FlagFilter | null): boolean {
  if (!f) return true;
  if (f === 'needsMe' && r.ref && r.state === 'attention') return true;
  return r.pods.some((p) => p.seats.some((s) => s.flags[f]));
}
