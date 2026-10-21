import type { FleetMachine, QueueItem, Seat } from '@appydave/shared';
import { pipFor, seatName, type PipKey } from '../fleet/model.js';
import { mergePairs, pairKey, type LinePair } from '../lines/handoffLines.js';
import {
  endpointRig,
  isOpen,
  listRigs,
  resolveEndpoint,
  rigQueue,
  STALE_MS,
  type RigRef,
} from '../fleet/views.js';

/**
 * v2 Graph (the fleet overview): every rig as ONE box, grouped by machine, and the traffic BETWEEN
 * rigs. Pure: a function of the fleet and a time, built on the shared data layer read-only. It draws
 * no agents and no handoffs inside a rig: that is the Rig Map's job.
 */

/** What the filter buttons look for, on a rig. */
export interface RigFlags {
  /** Seats blocked, or that asked David something still open and fresh. */
  needsMe: number;
  /** Seats with work addressed to them open longer than STALE_MS. */
  stuck: number;
  /** Seats down while their rig is running, or with OpenRig recovery guidance. */
  failing: number;
}

/** The newest handoff that touched a rig, in parts (the page words it against the clock). */
export interface LastHandoff {
  from: string;
  to: string;
  summary: string | null;
  at: string;
}

export interface GraphRig {
  key: GroupKey;
  machineId: string;
  machineLabel: string;
  name: string;
  /** Null for the machine's no-rig group. */
  ref: RigRef | null;
  state: RigRef['state'];
  agents: number;
  /** Seats working or blocked right now. */
  active: number;
  /** Agent names, for the one-line list of an expanded box. */
  agentNames: string[];
  flags: RigFlags;
  last: LastHandoff | null;
  /** Items this rig handed to, and took from, other rigs. */
  crossOut: number;
  crossIn: number;
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

/** One line per rig PAIR (the kit's LinePair: both directions together) with the queue items behind it. */
export interface PairEdge extends LinePair {
  items: QueueItem[];
}

export interface Graph {
  machines: GraphMachine[];
  /** One line per rig pair. */
  pairs: PairEdge[];
  /** Directed traffic as counted (the same rows, per direction). */
  cross: CrossEdge[];
  unplaced: Unplaced;
  totals: { rigs: number; agents: number; active: number };
}

/** A node the cross-rig lines join: a rig, or one machine's sessions that belong to no rig. */
export type GroupKey = string;

/** `m2:~loose`: the sessions on a machine that are in no rig (orchestrators, research seats). */
export const LOOSE = '~loose';
export const looseKey = (machineId: string): GroupKey => `${machineId}:${LOOSE}`;
export const isLoose = (key: GroupKey) => key.endsWith(`:${LOOSE}`);

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
  if (!m) {
    memo.set(snap, (m = new Map()));
  }
  if (m.has(key)) {
    return m.get(key) as T;
  }
  const v = make();
  if (m.size > 300) {
    m.clear();
  } // clock buckets pile up on a snapshot that never changes
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
  if (!raw || bare(raw) === 'human') {
    return null;
  }
  const sig = fleetSeatsSig(all);
  if (sig !== placementSig) {
    placementSig = sig;
    placements = new WeakMap();
  }
  let byRaw = placements.get(home.snapshot);
  if (!byRaw) {
    placements.set(home.snapshot, (byRaw = new Map()));
  }
  if (byRaw.has(raw)) {
    return byRaw.get(raw) ?? null;
  }
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
    if (rig && fm?.snapshot.rigs.some((r) => r.name === rig)) {
      return `${ep.machineId}:${rig}`;
    }

    return looseKey(ep.machineId);
  }
  const rig = endpointRig(home, raw);
  if (rig && home.snapshot.rigs.some((r) => r.name === rig)) {
    return `${home.machine.id}:${rig}`;
  }
  // `openrig-orch@roamy` where that session is not a seat any more: its machine's no-rig group.
  const where = raw.includes('@') ? raw.slice(raw.lastIndexOf('@') + 1) : '';
  const there = where ? all.find((m) => m.machine.id === where) : undefined;
  if (there && hasLoose(there)) {
    return looseKey(where);
  }

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
      if (seen.has(q.id)) {
        continue;
      }
      seen.add(q.id);
      if (!q.source || !q.destination) {
        continue;
      }
      if (bare(q.source) === 'human' || bare(q.destination) === 'human') {
        continue;
      }
      const from = endpointGroup(q.source, home, machines);
      const to = endpointGroup(q.destination, home, machines);
      if (!from || !to) {
        unplaced += 1;
        const missing = new Set<string>();
        for (const [raw, g] of [
          [q.source, from],
          [q.destination, to],
        ] as const) {
          if (!g) {
            missing.add(raw.includes('@') ? raw.slice(raw.lastIndexOf('@') + 1) : raw);
          }
        }
        for (const where of missing) {
          names.set(where, (names.get(where) ?? 0) + 1);
        }
        continue;
      }
      if (from === to) {
        continue;
      }
      const k = `${from}→${to}`;
      const e = map.get(k) ?? { from, to, count: 0, open: 0, stale: 0, items: [] };
      e.count += 1;
      e.items.push(q);
      if (isOpen(q)) {
        if (now - ms(q.createdAt) > STALE_MS) {
          e.stale += 1;
        } else {
          e.open += 1;
        }
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

/** Open items each seat addressed to David's mailbox, still fresh. */
const askedDavid = (fm: FleetMachine, now: number): Map<string, number> =>
  cached(fm.snapshot, `asked:${now}`, () => askedDavidOf(fm, now));

function askedDavidOf(fm: FleetMachine, now: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const q of fm.snapshot.queue) {
    if (bare(q.destination) !== 'human' || !q.source || !isOpen(q)) {
      continue;
    }
    if (now - ms(q.createdAt) > STALE_MS) {
      continue;
    }
    const seat = fm.snapshot.seats.find((s) => s.id === q.source || s.logicalId === q.source);
    if (seat) {
      out.set(seat.id, (out.get(seat.id) ?? 0) + 1);
    }
  }

  return out;
}

function flagsOf(seat: Seat, pip: PipKey, rigRunning: boolean, asked: number, stale: boolean) {
  const down: PipKey[] = ['stopped', 'unknown'];

  return {
    needsMe: pip === 'blocked' || asked > 0,
    stuck: stale,
    failing: pip !== 'asleep' && ((rigRunning && down.includes(pip)) || !!seat.recoveryGuidance),
  };
}

/** Seats with open work addressed to them older than STALE_MS, by seat id. */
const staleSeats = (fm: FleetMachine, now: number): Set<string> =>
  cached(fm.snapshot, `stale:${now}`, () => {
    const out = new Set<string>();
    for (const q of fm.snapshot.queue) {
      if (!q.destination || !isOpen(q) || now - ms(q.createdAt) <= STALE_MS) {
        continue;
      }
      const seat = fm.snapshot.seats.find(
        (s) => s.id === q.destination || s.logicalId === q.destination
      );
      if (seat) {
        out.add(seat.id);
      }
    }

    return out;
  });

const isActive = (pip: PipKey) => pip === 'working' || pip === 'blocked';

function boxOf(
  fm: FleetMachine,
  key: GroupKey,
  name: string,
  ref: RigRef | null,
  seats: Seat[],
  now: number,
  last: LastHandoff | null,
  crossOut: number,
  crossIn: number
): GraphRig {
  const asked = askedDavid(fm, now);
  const stale = staleSeats(fm, now);
  const running = ref?.status === 'running';
  const pips = seats.map((s) => pipFor(s, fm));
  const flags = seats.reduce(
    (acc, s, i) => {
      const f = flagsOf(s, pips[i]!, !!running, asked.get(s.id) ?? 0, stale.has(s.id));

      return {
        needsMe: acc.needsMe + (f.needsMe ? 1 : 0),
        stuck: acc.stuck + (f.stuck ? 1 : 0),
        failing: acc.failing + (f.failing ? 1 : 0),
      };
    },
    { needsMe: 0, stuck: 0, failing: 0 }
  );
  const active = pips.filter(isActive).length;

  return {
    key,
    machineId: fm.machine.id,
    machineLabel: fm.machine.label,
    name,
    ref,
    state: ref
      ? ref.state
      : fm.liveness === 'asleep'
        ? 'asleep'
        : pips.includes('blocked')
          ? 'attention'
          : active
            ? 'working'
            : 'idle',
    agents: seats.length,
    active,
    agentNames: seats.map((s) => seatName(s)),
    flags,
    last,
    crossOut,
    crossIn,
  };
}

/** The newest queue row that touches the rig, as a handoff in parts. */
function lastHandoff(fm: FleetMachine, rig: string): LastHandoff | null {
  const items = rigQueue(fm, rig);
  let best: QueueItem | null = null;
  for (const q of items) {
    if (!best || q.updatedAt > best.updatedAt) {
      best = q;
    }
  }

  return best
    ? {
        from: bare(best.source) || '?',
        to: bare(best.destination) || '?',
        summary: best.summary,
        at: best.updatedAt,
      }
    : null;
}

/** Both directions of a rig pair as one line, merged by the kit; the items behind it ride along. */
export function pairEdges(cross: CrossEdge[]): PairEdge[] {
  const items = new Map<string, QueueItem[]>();
  for (const e of cross) {
    items.set(pairKey(e.from, e.to), [...(items.get(pairKey(e.from, e.to)) ?? []), ...e.items]);
  }

  return mergePairs(
    cross.map((e) => ({ from: e.from, to: e.to, count: e.count, open: e.open, stale: e.stale }))
  ).map((p) => ({
    ...p,
    items: [...(items.get(pairKey(p.a, p.b)) ?? [])].sort((x, y) =>
      x.createdAt.localeCompare(y.createdAt)
    ),
  }));
}

/** The whole fleet as an overview: one box per rig, grouped by machine, and the lines between rigs. */
export function buildGraph(machines: FleetMachine[], now: number = Date.now()): Graph {
  const { edges: cross, unplaced } = crossRigEdges(machines, now);
  const out = new Map<string, number>();
  const into = new Map<string, number>();
  for (const e of cross) {
    out.set(e.from, (out.get(e.from) ?? 0) + e.count);
    into.set(e.to, (into.get(e.to) ?? 0) + e.count);
  }
  let rigCount = 0;
  const built: GraphMachine[] = machines.map((fm) => {
    const refs = cached(fm.snapshot, `refs:${fm.liveness}`, () => listRigs([fm]));
    rigCount += refs.length;
    const rigs = refs.map((ref) => {
      const o = out.get(ref.key) ?? 0;
      const i = into.get(ref.key) ?? 0;

      // the same object while nothing it is made of changed, so the page can skip the box
      return cached(
        fm.snapshot,
        `rig:${ref.key}:${fm.liveness}:${now}:${o}:${i}:${ref.state}`,
        () =>
          boxOf(
            fm,
            ref.key,
            ref.name,
            ref,
            fm.snapshot.seats.filter((s) => s.rig === ref.name),
            now,
            lastHandoff(fm, ref.name),
            o,
            i
          )
      );
    });
    const loseKey = looseKey(fm.machine.id);
    const loose = cached(
      fm.snapshot,
      `loose:${fm.liveness}:${now}:${out.get(loseKey) ?? 0}:${into.get(loseKey) ?? 0}`,
      () => {
        const seats = fm.snapshot.seats.filter(
          (s) => !s.rig || !fm.snapshot.rigs.some((r) => r.name === s.rig)
        );

        return seats.length
          ? boxOf(
              fm,
              loseKey,
              'no rig',
              null,
              seats,
              now,
              null,
              out.get(loseKey) ?? 0,
              into.get(loseKey) ?? 0
            )
          : null;
      }
    );

    return { id: fm.machine.id, label: fm.machine.label, liveness: fm.liveness, rigs, loose };
  });
  const all = built.flatMap((m) => [...m.rigs, ...(m.loose ? [m.loose] : [])]);

  return {
    machines: built,
    pairs: pairEdges(cross),
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

/** The three filters. */
export type FlagFilter = keyof RigFlags;
export const FLAG_FILTERS: { key: FlagFilter; label: string; glyph: string; hint: string }[] = [
  {
    key: 'needsMe',
    label: 'Needs me',
    glyph: '▲',
    hint: 'A seat is blocked, or asked David something still open',
  },
  {
    key: 'stuck',
    label: 'Stuck',
    glyph: '⌛',
    hint: 'Work addressed to a seat left open over 2 h',
  },
  {
    key: 'failing',
    label: 'Failing',
    glyph: '✕',
    hint: 'A seat is down while its rig runs, or OpenRig left recovery guidance',
  },
];

/** A rig that is not running (stopped): hidden by default, like the Wall's stopped seats. */
export const isStopped = (r: GraphRig): boolean => !!r.ref && r.ref.status !== 'running';

/** A rig shows under a flag filter when one of its seats carries the flag (or, for Needs me, OpenRig flags the rig). */
export function rigMatches(r: GraphRig, f: FlagFilter | null): boolean {
  if (!f) {
    return true;
  }
  if (f === 'needsMe' && r.ref && r.state === 'attention') {
    return true;
  }

  return r.flags[f] > 0;
}
