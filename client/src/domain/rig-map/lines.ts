import type { QueueItem } from '@appydave/shared';
import { plannedWord, type MapEdge, type RigMap } from '@client/domain/fleet/views.js';
import {
  mergePairs,
  podRail,
  type LinePair,
  type RawEdge,
} from '@client/domain/lines/handoffLines.js';

/**
 * The Rig Map v2's line model: ONE line per pair of agents (both directions together), and ONE
 * rail per pair of pods for the lines that cannot stay in a row (a wrapped pod, another lane). All
 * the counting and merging is the kit's; this file only decides which pairs draw as arcs and which
 * fold into a rail, from measured positions. Pure, so it is tested without a browser.
 */

/** A pair of agents with the queue items on it, from a rig map. */
export interface MapPair extends LinePair {
  /** The spec edge kinds in words ("observes · delegates") when the pair is planned only. */
  plannedWords: string | null;
  items: QueueItem[];
}

/** Both directions of every seat pair, plus planned-only pairs, as one entry each. */
export function mapPairs(map: RigMap): MapPair[] {
  const raw: RawEdge[] = [
    ...map.edges
      .filter((e) => !e.self)
      .map((e) => ({ from: e.from, to: e.to, count: e.count, open: e.open, stale: e.stale })),
    ...(map.planned ?? []).map((e) => ({ from: e.from, to: e.to, count: 0, planned: true })),
  ];
  const kinds = new Map<string, string[]>();

  for (const e of map.planned ?? []) {
    const k = e.from < e.to ? `${e.from}\u0000${e.to}` : `${e.to}\u0000${e.from}`;
    const word = plannedWord(e.planned ?? '');

    kinds.set(k, [...new Set([...(kinds.get(k) ?? []), word])]);
  }

  return mergePairs(raw).map((p) => {
    const items = map.edges
      .filter(
        (e) => !e.self && ((e.from === p.a && e.to === p.b) || (e.from === p.b && e.to === p.a))
      )
      .flatMap((e) => e.items)
      .sort((x, y) => x.createdAt.localeCompare(y.createdAt));

    return {
      ...p,
      plannedWords: p.planned ? (kinds.get(`${p.a}\u0000${p.b}`) ?? []).join(' · ') : null,
      items,
    };
  });
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the planner needs to know about the measured layout. */
export interface PlanLook {
  card: (key: string) => Box | null;
  /** An id for the pod a seat sits in (unique across lanes), or '' when unknown. */
  pod: (key: string) => string;
}

/** One line to draw: an arc between two agents, or a rail between two pods. */
export interface PlannedLine {
  /** `${from}→${to}` of the synthetic edge handed to the router; unique per line. */
  key: string;
  /** The two cards the line is drawn between (for a rail, its busiest pair's cards). */
  a: string;
  b: string;
  /** Every agent whose focus lights this line. */
  members: string[];
  /** Handoffs a→b and b→a (for a rail: pod A's agents to pod B's, and back). */
  aToB: number;
  bToA: number;
  total: number;
  waiting: number;
  leftOpen: number;
  /** Planned only: the words ("observes"); null for a line with handoffs. */
  planned: string | null;
  rail: boolean;
  /** How many agent pairs a rail folds together (1 for an arc). */
  pairs: number;
  items: QueueItem[];
}

const sameRow = (a: Box, b: Box) => Math.abs(a.y - b.y) < 20;

/**
 * Arcs for pairs that sit in one row; for the rest, ONE rail per pair of pods with the total.
 * Planned-only pairs are never folded (each keeps its own word).
 */
export function planLines(pairs: MapPair[], look: PlanLook): PlannedLine[] {
  const out: PlannedLine[] = [];
  const rails = new Map<string, { pod: [string, string]; members: MapPair[] }>();

  for (const p of pairs) {
    const ca = look.card(p.a);
    const cb = look.card(p.b);

    if (!ca || !cb) {
      continue;
    }

    const pa = look.pod(p.a);
    const pb = look.pod(p.b);

    if (sameRow(ca, cb) || p.planned || !pa || !pb || pa === pb) {
      out.push({
        key: `${p.a}→${p.b}`,
        a: p.a,
        b: p.b,
        members: [p.a, p.b],
        aToB: p.aToB,
        bToA: p.bToA,
        total: p.total,
        waiting: p.waiting,
        leftOpen: p.leftOpen,
        planned: p.planned ? p.plannedWords || 'planned' : null,
        rail: false,
        pairs: 1,
        items: p.items,
      });
      continue;
    }

    const [x, y] = pa < pb ? [pa, pb] : [pb, pa];
    const k = `${x}\u0000${y}`;
    const r = rails.get(k) ?? { pod: [x, y] as [string, string], members: [] };

    r.members.push(p);
    rails.set(k, r);
  }

  for (const { pod, members } of rails.values()) {
    const rep = [...members].sort((m, n) => n.total - m.total)[0]!;
    // the kit merges the members into ONE rail between the two pods, with the totals each way
    const rail = podRail(
      members.flatMap((m) => [
        {
          fromPod: look.pod(m.a),
          toPod: look.pod(m.b),
          count: m.aToB,
          open: m.waiting,
          stale: m.leftOpen,
        },
        { fromPod: look.pod(m.b), toPod: look.pod(m.a), count: m.bToA },
      ])
    )[0]!;
    const { aToB, bToA } = rail;
    // draw it from pod[0]'s card of the representative pair to pod[1]'s
    const [from, to] = look.pod(rep.a) === pod[0] ? [rep.a, rep.b] : [rep.b, rep.a];

    out.push({
      key: `${from}→${to}`,
      a: from,
      b: to,
      members: [...new Set(members.flatMap((m) => [m.a, m.b]))],
      aToB,
      bToA,
      total: aToB + bToA,
      waiting: rail.waiting,
      leftOpen: rail.leftOpen,
      planned: null,
      rail: true,
      pairs: members.length,
      items: members.flatMap((m) => m.items).sort((u, v) => u.createdAt.localeCompare(v.createdAt)),
    });
  }

  return out;
}

/** The synthetic edge the original router lays out for a line (it only reads from, to, count). */
export function routerEdge(l: PlannedLine): MapEdge {
  return {
    from: l.a,
    to: l.b,
    count: l.total,
    open: l.waiting,
    stale: l.leftOpen,
    self: false,
    items: [],
    ...(l.planned ? { planned: l.planned } : {}),
  };
}
