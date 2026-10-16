import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HandoffGetOutput } from '@appydave/shared';
import type { FleetSocket } from '../fleet/useFleet.js';
import HandoffPanel from './HandoffPanel.js';
import FollowWork from './FollowWork.js';
import type { WorkChain } from '../fleet/timeline.js';
import { ago, PIP } from '../fleet/model.js';
import { plannedWord, type MapEdge, type RigMap as RigMapView } from '../fleet/views.js';
import SkillPill from './SkillPill.js';
import { RoleTag } from './SeatCardLines.js';

interface Props {
  map: RigMapView | null;
  onOpen: (key: string) => void;
  /** v1.5 · L1: the skill-count pill opens the seat's Loadout debug view. */
  onOpenSkills?: (key: string) => void;
  /** C6a: reads a handoff's message for the details drawer. */
  socket?: FleetSocket;
  /** C6a: false while something sits on top (Esc is theirs). */
  keys?: boolean;
  /** Views V2: the chain a handoff on this rig belongs to (Follow this work). */
  chainOf?: (itemId: string) => WorkChain | null;
}

/** C6a: a floating card for what is under the pointer (never in the layout, never takes the pointer). */
interface Card {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

/** C6-A: the lowest arc's height above (or below) the row, and the step between stacked arcs. */
const ARC_BASE = 16;
const ARC_STEP = 11;
/** Room a label needs above its arc's peak. */
const ARC_LABEL = 14;
/** The least room above and below a row of cards, arcs or not. */
const ARC_MIN = 24;
/** C6-A: the gutter left of every lane that lines between lanes run down. */
const GUTTER = 26;
/** Each further outside lane steps right, so a line to the rig never runs through another card. */
const LANE_STEP = 240;

/** A point along the cubic bezier P0..P3 at t. */
const bez = (t: number, p0: number, p1: number, p2: number, p3: number) =>
  (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed {
  edge: MapEdge;
  d: string;
  lx: number;
  ly: number;
  /** The cubic's control points, so a label can slide along its own line (C6a). */
  c: [number, number, number, number, number, number, number, number];
}

const LABEL_W = 22;
const LABEL_H = 18;
/** D09 W2: a planned line's label is its kind in words, so it is as wide as its text. */
const labelW = (edge?: MapEdge) =>
  edge?.planned ? Math.round(plannedWord(edge.planned).length * 6.6 + 14) : LABEL_W;

/**
 * C6a (F14 labels, B1-2): a count label that would sit on top of another is slid along its own
 * line to the first spot where it overlaps none, so every line's label can be pointed at.
 * Labels that find no free spot stay where they were (keyboard still reaches every line).
 */
export function spreadLabels<T extends { lx: number; ly: number; c: Placed['c']; edge?: MapEdge }>(
  items: T[]
): T[] {
  const taken: { x: number; y: number; w: number }[] = [];
  let w = LABEL_W;
  const clear = (x: number, y: number) =>
    taken.every((t) => Math.abs(t.x - x) >= (t.w + w) / 2 + 2 || Math.abs(t.y - y) >= LABEL_H + 2);
  return items.map((p) => {
    w = labelW(p.edge);
    let best = { x: p.lx, y: p.ly, w };
    if (!clear(best.x, best.y)) {
      const [x0, y0, x1, y1, x2, y2, x3, y3] = p.c;
      for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78, 0.15, 0.85]) {
        const x = bez(t, x0, x1, x2, x3);
        const y = bez(t, y0, y1, y2, y3);
        if (clear(x, y)) {
          best = { x, y, w };
          break;
        }
      }
    }
    taken.push(best);
    return { ...p, lx: best.x, ly: best.y };
  });
}

/** What the router needs to know about the measured layout (content coordinates). */
export interface MapLook {
  card: (key: string) => Box | null;
  pod: (key: string) => Box | null;
  lane: (key: string) => string;
  /** Every card in the same pod as this seat (its own included): finds the rows when seats wrap. */
  podCards: (key: string) => Box[];
}

/** A line's slot (0–3): offsets its runs so lines sharing a corridor don't sit on one another.
 * From its ends, not its order, so a new line never shifts the others (r1 LOW-2). */
function slotOf(edge: MapEdge): number {
  let h = 0;
  for (const ch of `${edge.from}\u0000${edge.to}`) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % 4;
}

/**
 * C6-A: where every line goes, from measured boxes. Pure, so it can be tested without a browser:
 * same-row arcs packed into levels (labels at their own peaks), other lines down the left gutter
 * via the corridors below the pods. Returns the room each lane needs above and below its cards.
 */
export function routeLines(
  mapEdges: MapEdge[],
  look: MapLook
): { placed: Placed[]; roomTop: Map<string, number>; roomBottom: Map<string, number> } {
  const out: Placed[] = [];
  const edges = mapEdges.filter((e) => !e.self);

  // C6-A, same row: arcs are stacked by span, each at its own height (the shortest lowest), so
  // they don't bundle and each count label sits at its own arc's peak. Left-to-right go over the
  // row, right-to-left under it.
  type Arc = { edge: MapEdge; a: Box; b: Box; over: boolean; span: number; row: string };
  const arcs: Arc[] = [];
  const routed: { edge: MapEdge; a: Box; b: Box }[] = [];
  for (const edge of edges) {
    const a = look.card(edge.from);
    const b = look.card(edge.to);
    if (!a || !b) continue;
    if (Math.abs(a.y - b.y) < 20) {
      const over = b.x > a.x;
      arcs.push({
        edge,
        a,
        b,
        over,
        span: Math.abs(b.x - a.x),
        row: `${Math.round(a.y / 10)}:${over}`,
      });
    } else routed.push({ edge, a, b });
  }
  // Pack arcs into levels: an arc takes the lowest level where it overlaps no arc already there
  // (sideways, with a margin). Nested or overlapping arcs stack; disjoint ones share a level.
  // Room is counted per lane, above and below separately, so only rows that stack grow.
  const roomTop = new Map<string, number>();
  const roomBottom = new Map<string, number>();
  const rows = new Map<string, Arc[]>();
  for (const arc of arcs) rows.set(arc.row, [...(rows.get(arc.row) ?? []), arc]);
  for (const list of rows.values()) {
    list.sort((x, y) => x.span - y.span);
    const levels: [number, number][][] = [];
    for (const arc of list) {
      const { a, b, over, edge } = arc;
      const lo = Math.min(a.x, b.x) + Math.min(a.w, b.w) / 2 - 16;
      const hi = Math.max(a.x, b.x) + Math.min(a.w, b.w) / 2 + 16;
      let level = levels.findIndex((iv) => iv.every(([l, h]) => hi < l || lo > h));
      if (level === -1) {
        level = levels.length;
        levels.push([]);
      }
      levels[level]!.push([lo, hi]);
      const lift = (over ? -1 : 1) * (ARC_BASE + level * ARC_STEP);
      const need = ARC_BASE + level * ARC_STEP + ARC_LABEL;
      const lane = look.lane(edge.from);
      const side = over ? roomTop : roomBottom;
      side.set(lane, Math.max(side.get(lane) ?? 0, need));
      const sx = a.x + a.w / 2 + (over ? 12 : -12);
      const ex = b.x + b.w / 2 + (over ? -12 : 12);
      const sy = over ? a.y : a.y + a.h;
      const ey = over ? b.y : b.y + b.h;
      // a cubic with both handles at `lift` peaks at 3/4 of it
      const peak = (lift * 4) / 3;
      out.push({
        edge,
        d: `M${sx},${sy} C${sx},${sy + peak} ${ex},${ey + peak} ${ex},${ey}`,
        lx: (sx + ex) / 2,
        ly: (sy + ey) / 2 + lift,
        c: [sx, sy, sx, sy + peak, ex, ey + peak, ex, ey],
      });
    }
  }

  // C6-A, another row or lane: never straight across. Out of the card's bottom, along the
  // corridor just below its pod (between pod rows, or above the lane's bottom edge), down or up
  // the gutter left of every lane, along the corridor below the target's pod, and up into the
  // target's bottom. Always via the bottoms: a pod's heading sits at its top and spans its width,
  // so a line coming in from above would cross it.
  // C6-A.1 (r1 MEDIUM-1): when a pod's seats wrap, a card with a row below it leaves through its
  // own row gap, then down the pod's left padding (left of every card) to the corridor; two rows
  // of one pod join inside the pod, without the trip to the gutter.
  type Exit = { y: number; wrapped: boolean; corridor: number };
  routed.forEach(({ edge, a, b }) => {
    const pa = look.pod(edge.from);
    const pb = look.pod(edge.to);
    if (!pa || !pb) return;
    const s4 = slotOf(edge);
    // Where a card's line runs sideways: the middle of the gap under its row, or (last row) the
    // corridor under its pod. Each slot shifts it, so lines from one pod don't merge (LOW-1).
    const exitOf = (card: Box, pod: Box, key: string): Exit => {
      const below = look
        .podCards(key)
        .filter((o) => o.y >= card.y + card.h - 1)
        .map((o) => o.y);
      const corridor = pod.y + pod.h + 3 + s4 * 2.5;
      return below.length
        ? {
            y: (card.y + card.h + Math.min(...below)) / 2 + (s4 - 1.5) * 3,
            wrapped: true,
            corridor,
          }
        : { y: corridor, wrapped: false, corridor };
    };
    const xa = exitOf(a, pa, edge.from);
    const xb = exitOf(b, pb, edge.to);
    const sx = a.x + a.w - 22;
    const ex = b.x + b.w - 22;
    const sy = a.y + a.h;
    const ey = b.y + b.h;
    const padX = (pod: Box) => pod.x + 4 + s4 * 2; // inside the pod, left of its first card
    let pts: [number, number][];
    let label: Pick<Placed, 'lx' | 'ly' | 'c'>;
    if (pa.x === pb.x && pa.y === pb.y) {
      const px = padX(pa);
      pts = [
        [sx, sy],
        [sx, xa.y],
        [px, xa.y],
        [px, xb.y],
        [ex, xb.y],
        [ex, ey],
      ];
      label = {
        lx: (px + ex) / 2,
        ly: xb.y,
        c: [px + 14, xb.y, px + 14, xb.y, ex - 14, xb.y, ex - 14, xb.y],
      };
    } else {
      const gx = GUTTER - 6 - s4 * 4;
      const leg = (x: number, y: number, xit: Exit, pod: Box): [number, number][] =>
        xit.wrapped
          ? [
              [x, y],
              [x, xit.y],
              [padX(pod), xit.y],
              [padX(pod), xit.corridor],
            ]
          : [
              [x, y],
              [x, xit.corridor],
            ];
      const c1 = xa.corridor;
      const c2 = xb.corridor;
      pts = [...leg(sx, sy, xa, pa), [gx, c1], [gx, c2], ...leg(ex, ey, xb, pb).reverse()];
      label = {
        lx: gx + 12,
        ly: (c1 + c2) / 2,
        c: [gx + 12, c1 + 12, gx + 12, c1 + 12, gx + 12, c2 - 12, gx + 12, c2 - 12],
      };
    }
    out.push({ edge, d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' '), ...label });
  });
  return { placed: out, roomTop, roomBottom };
}

/**
 * Concept 3 · Rig Map: machines as lanes, pods as bands, seats as cards. The lines are real queue
 * traffic (who handed work to whom, and how often), drawn over the cards from measured positions.
 */
export default function RigMap({ map, onOpen, onOpenSkills, socket, keys = true, chainOf }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** C6-A: per lane, the room its stacked arcs need above and below the cards (JSON, for a stable compare). */
  const [arcRoom, setArcRoom] = useState('{"top":{},"bottom":{}}');
  const rooms = JSON.parse(arcRoom) as {
    top: Record<string, number>;
    bottom: Record<string, number>;
  };
  // C6a: lines and boxes answer hover (a floating card) and click (a details drawer for a line).
  const [card, setCard] = useState<Card | null>(null);
  const [pinned, setPinned] = useState<{ edge: string; itemId: string | null } | null>(null);
  const bodies = useRef(new Map<string, HandoffGetOutput>());
  const [follow, setFollow] = useState<string | null>(null);
  // r1 INFO-2: computed once per follow, not twice per render.
  const chain = useMemo(() => (follow && chainOf ? chainOf(follow) : null), [follow, chainOf]);
  useEffect(() => {
    setPinned(null);
    setCard(null);
    setFollow(null);
  }, [map?.rig.key]);
  useEffect(() => {
    if (!pinned) setFollow(null);
  }, [pinned]);
  useEffect(() => {
    // Views V2: while following work, Esc is FollowWork's (back to this drawer).
    if (!pinned || chain || !keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setPinned(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pinned, chain, keys]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !map) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      // Content coordinates: the edge layer scrolls with the cards, so add the canvas's own scroll
      // offset. Without it a sideways scroll of a wide map moved every line by scrollLeft (the
      // "connector detaches while scrolling" bug, reproduced at 173–215 px off).
      const rect = (key: string) => {
        const n = el.querySelector<HTMLElement>(`[data-node-key="${CSS.escape(key)}"]`);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return {
          x: r.left - base.left + el.scrollLeft,
          y: r.top - base.top + el.scrollTop,
          w: r.width,
          h: r.height,
        };
      };
      const boxOf = (n: Element) => {
        const r = n.getBoundingClientRect();
        return {
          x: r.left - base.left + el.scrollLeft,
          y: r.top - base.top + el.scrollTop,
          w: r.width,
          h: r.height,
        };
      };
      const podOf = (key: string) => {
        const n = el.querySelector<HTMLElement>(`[data-node-key="${CSS.escape(key)}"]`);
        const pod = n?.closest('.pod');
        return pod ? boxOf(pod) : null;
      };
      const laneOf = (key: string) =>
        el
          .querySelector<HTMLElement>(`[data-node-key="${CSS.escape(key)}"]`)
          ?.closest('.lane')
          ?.getAttribute('data-lane') ?? '';
      const {
        placed: out,
        roomTop,
        roomBottom,
      } = routeLines([...map.edges, ...(map.planned ?? [])], {
        card: rect,
        pod: podOf,
        lane: laneOf,
        podCards: (key) => {
          const pod = el.querySelector(`[data-node-key="${CSS.escape(key)}"]`)?.closest('.pod');
          return pod ? [...pod.querySelectorAll('[data-node-key]')].map(boxOf) : [];
        },
      });
      const nextRoom = JSON.stringify({
        top: Object.fromEntries(roomTop),
        bottom: Object.fromEntries(roomBottom),
      });
      setArcRoom((r) => (r === nextRoom ? r : nextRoom));
      setPlaced(spreadLabels(out));
      setSize({ w: el.scrollWidth, h: el.scrollHeight });
    };
    measure();
    // Re-measure when any card or lane changes size, not only the canvas: a card that grows in its
    // row (a "waiting" badge, a late web font) moves its neighbours without resizing the canvas.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll('[data-node-key], .lane').forEach((n) => ro.observe(n));
    let live = true;
    void document.fonts?.ready.then(() => live && measure());
    return () => {
      live = false;
      ro.disconnect();
    };
  }, [map]);

  if (!map) return <p className="empty">Pick a rig.</p>;
  const max = Math.max(1, ...map.edges.map((e) => e.count));
  const selfOf = new Map(map.edges.filter((e) => e.self).map((e) => [e.from, e.count]));
  const names = new Map(
    map.lanes.flatMap((l) => l.pods.flatMap((p) => p.seats.map((s) => [s.key, s.name] as const)))
  );
  const nameOf = (key: string) => names.get(key) ?? key;
  const edgeKey = (e: MapEdge) => `${e.from}→${e.to}`;
  const cardAt = (ev: { clientX: number; clientY: number }, title: string, lines: string[]) =>
    setCard(
      document.querySelector('[data-explain-on]')
        ? null
        : { x: ev.clientX + 14, y: ev.clientY + 14, title, lines }
    );
  const edgeTitle = (e: MapEdge) =>
    `${nameOf(e.from)} → ${nameOf(e.to)} · ${e.count} handoff${e.count === 1 ? '' : 's'}`;
  const edgeCard = (e: MapEdge, ev: { clientX: number; clientY: number }) => {
    const last = e.items[e.items.length - 1];
    cardAt(ev, edgeTitle(e), [
      ...(e.open ? [`${e.open} still waiting`] : []),
      ...(e.stale ? [`${e.stale} left open over 2 h`] : []),
      ...(last ? [`latest: ${last.summary ?? last.id}`] : []),
      'Click (or Enter) for the handoffs.',
    ]);
  };
  const seatCard = (key: string, ev: { clientX: number; clientY: number }) => {
    const ins = map.edges.filter((e) => e.to === key && !e.self).reduce((n, e) => n + e.count, 0);
    const outs = map.edges
      .filter((e) => e.from === key && !e.self)
      .reduce((n, e) => n + e.count, 0);
    const waiting = map.edges.filter((e) => e.to === key).reduce((n, e) => n + e.open, 0);
    cardAt(ev, nameOf(key), [
      `${ins} handed in · ${outs} handed out${waiting ? ` · ${waiting} waiting` : ''}`,
      'Click to open the seat.',
    ]);
  };
  const plannedTitle = (e: MapEdge) =>
    `Planned: ${nameOf(e.from)} ${plannedWord(e.planned ?? '')} ${nameOf(e.to)} (rig spec ${e.planned}) · no handoff along it yet`;
  const plannedCard = (e: MapEdge, ev: { clientX: number; clientY: number }) =>
    cardAt(ev, plannedTitle(e), [
      'From the rig spec in OpenRig. It turns into a solid line once a handoff goes this way.',
    ]);
  const pinnedEdge = pinned ? map.edges.find((e) => edgeKey(e) === pinned.edge) : undefined;
  const edgeHandlers = (e: MapEdge) => ({
    tabIndex: 0,
    role: 'button',
    'aria-label': `${edgeTitle(e)}. Enter shows them.`,
    onPointerEnter: (ev: React.PointerEvent) => edgeCard(e, ev),
    onPointerMove: (ev: React.PointerEvent) => edgeCard(e, ev),
    onPointerLeave: () => setCard(null),
    onClick: () => {
      setCard(null);
      setPinned({ edge: edgeKey(e), itemId: null });
    },
    onKeyDown: (ev: React.KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        setPinned({ edge: edgeKey(e), itemId: null });
      }
    },
  });

  return (
    <section className="rigmap" data-testid="rig-map" aria-label={`Rig map of ${map.rig.name}`}>
      <p className="view-caption" data-explain="handoff">
        <b>{map.rig.name}</b> on {map.rig.machineLabel} · {map.handoffs} handoffs through the queue
        {map.outgoing ? ` (+ ${map.outgoing} sent to other rigs)` : ''} · line width = how often one
        seat handed work to another · amber = still waiting · dashed = left open over 2 h
        {map.planned?.length
          ? ' · dotted with a word = planned in the rig spec, no handoff yet'
          : ''}
        {map.planned === null ? (
          <span data-testid="rig-map-no-plan">
            {' '}
            · no planned lines: {map.rig.machineLabel}&apos;s collector did not send the rig
            spec&apos;s edges (an older collector, or the graph could not be read)
          </span>
        ) : null}
      </p>
      <div className="rigmap-canvas" ref={box} style={{ ['--gutter' as string]: `${GUTTER}px` }}>
        <svg
          className="rigmap-edges"
          width={size.w}
          height={size.h}
          role="group"
          aria-label="Handoff lines: Tab to a line, Enter shows its handoffs"
          data-testid="rig-map-edges"
        >
          <defs>
            <marker
              id="rm-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="9"
              markerHeight="9"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 z" className="rigmap-arrowhead" />
            </marker>
          </defs>
          {placed.map((p) =>
            p.edge.planned ? (
              <g
                key={`planned:${edgeKey(p.edge)}`}
                data-testid="rig-map-planned"
                data-edge={edgeKey(p.edge)}
                data-kind={p.edge.planned}
                role="img"
                aria-label={plannedTitle(p.edge)}
                data-explain="planned"
                data-explain-ctx={plannedTitle(p.edge)}
                onPointerEnter={(ev) => plannedCard(p.edge, ev)}
                onPointerMove={(ev) => plannedCard(p.edge, ev)}
                onPointerLeave={() => setCard(null)}
              >
                <path d={p.d} className="rigmap-edge planned" markerEnd="url(#rm-arrow)" />
                <path d={p.d} className="hit" />
              </g>
            ) : (
              <g
                key={`${p.edge.from}→${p.edge.to}`}
                data-testid="rig-map-edge"
                data-edge={edgeKey(p.edge)}
                data-selected={pinned?.edge === edgeKey(p.edge) || undefined}
                {...edgeHandlers(p.edge)}
                data-open={p.edge.open > 0}
                data-stale={p.edge.stale > 0}
                data-explain={p.edge.open ? 'waiting' : p.edge.stale ? 'stale' : 'handoff'}
                data-explain-ctx={`${nameOf(p.edge.from)} → ${nameOf(p.edge.to)} · ${p.edge.count} handoff${p.edge.count === 1 ? '' : 's'}${p.edge.open ? ` · ${p.edge.open} waiting` : ''}${p.edge.stale ? ` · ${p.edge.stale} left open` : ''}`}
              >
                <path
                  d={p.d}
                  className={`rigmap-edge ${p.edge.open ? 'open' : p.edge.stale ? 'stale' : ''}`}
                  strokeWidth={1.2 + (p.edge.count / max) * 5}
                  markerEnd="url(#rm-arrow)"
                />
                <path d={p.d} className="hit" />
              </g>
            )
          )}
          {/* C6a (B1-2): the count labels sit above every line's hit area, so each line can be
              reached by its label even where other lines' wide hit areas cover its path. */}
          {placed.map((p) =>
            p.edge.planned ? (
              <g
                key={`plabel:${edgeKey(p.edge)}`}
                className="rigmap-label planned"
                data-testid="rig-map-planned-label"
                data-edge={edgeKey(p.edge)}
                aria-hidden="true"
              >
                <rect
                  x={p.lx - labelW(p.edge) / 2}
                  y={p.ly - 9}
                  width={labelW(p.edge)}
                  height={18}
                  rx={9}
                />
                <text x={p.lx} y={p.ly} className="rigmap-count">
                  {plannedWord(p.edge.planned)}
                </text>
              </g>
            ) : (
              <g
                key={`label:${edgeKey(p.edge)}`}
                className="rigmap-label"
                data-testid="rig-map-edge-label"
                data-edge={edgeKey(p.edge)}
                data-selected={pinned?.edge === edgeKey(p.edge) || undefined}
                {...edgeHandlers(p.edge)}
                tabIndex={-1}
                aria-hidden="true"
              >
                <rect x={p.lx - 11} y={p.ly - 9} width={22} height={18} rx={4} />
                <text x={p.lx} y={p.ly} className="rigmap-count">
                  {p.edge.count}
                </text>
              </g>
            )
          )}
        </svg>
        {map.lanes.map((lane, i) => (
          <div
            className="lane"
            key={lane.machineId}
            data-lane={lane.machineId}
            style={{
              ['--arc-top' as string]: `${Math.max(ARC_MIN, rooms.top[lane.machineId] ?? 0)}px`,
              ['--arc-bottom' as string]: `${Math.max(ARC_MIN, rooms.bottom[lane.machineId] ?? 0)}px`,
            }}
            data-testid="rig-map-lane"
            data-liveness={lane.liveness}
          >
            <div className="lane-head" data-explain={i === 0 ? 'rig' : 'outside-lane'}>
              <b>{lane.label}</b>
              <i>{lane.subtitle}</i>
            </div>
            <div
              className="lane-pods"
              style={i > 1 ? { paddingLeft: (i - 1) * LANE_STEP } : undefined}
            >
              {lane.pods.map((pod) => (
                <div className="pod" key={pod.name}>
                  <div className="pod-name" data-explain="pod">
                    pod · {pod.name}
                  </div>
                  <div className="pod-seats">
                    {pod.seats.map((s) => (
                      <button
                        type="button"
                        key={s.key}
                        className="node"
                        data-node-key={s.key}
                        data-testid="rig-map-node"
                        data-pip={s.pip}
                        onClick={() => !s.key.startsWith('?/') && onOpen(s.key)}
                        onPointerEnter={(ev) => seatCard(s.key, ev)}
                        onPointerMove={(ev) => seatCard(s.key, ev)}
                        onPointerLeave={() => setCard(null)}
                        aria-label={
                          s.key.startsWith('?/')
                            ? `${s.name}: not a seat any machine reports`
                            : `${s.name}: open in focus`
                        }
                        data-explain="seat"
                        // QA W3 MEDIUM-1: key skill chips made a node twice as tall and pushed the
                        // map below the fold (W0); the node shows the role, the skills sit in its title.
                        title={
                          s.keySkills?.length ? `Key skills: ${s.keySkills.join(', ')}` : undefined
                        }
                        data-explain-ctx={`${s.name} · ${s.model.text} · ${PIP[s.pip].label}`}
                      >
                        <span className="chip" data-family={s.model.family} data-explain="model">
                          {s.model.text}
                        </span>
                        <b>{s.name}</b>
                        <RoleTag agentRole={s.agentRole} />
                        <span className="pip" data-pip={s.pip} data-explain={`status-${s.pip}`}>
                          <span className="pip-glyph">{PIP[s.pip].glyph}</span> {PIP[s.pip].label}
                        </span>
                        {!s.key.startsWith('?/') && (
                          <SkillPill
                            count={s.skills}
                            onOpen={onOpenSkills ? () => onOpenSkills(s.key) : undefined}
                          />
                        )}
                        {s.open > 0 && (
                          <span className="node-wait" data-explain="waiting">
                            {s.open} waiting
                          </span>
                        )}
                        {s.stale > 0 && (
                          <span className="node-stale" data-explain="stale">
                            {s.stale} left open · {ago(s.oldestStaleMs ?? 0)}
                          </span>
                        )}
                        {selfOf.get(s.key) ? (
                          <span className="node-self" data-explain="self-handoff">
                            ↺ {selfOf.get(s.key)} to itself
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {card && (
        <div
          className="hover-card"
          role="tooltip"
          data-testid="map-hover-card"
          style={{ left: card.x, top: card.y }}
        >
          <b>{card.title}</b>
          {card.lines.map((l, i) => (
            <span key={i} style={{ display: 'block' }}>
              {l}
            </span>
          ))}
        </div>
      )}
      {pinnedEdge && (
        <div className="map-drawer" data-testid="map-drawer">
          {follow && chain ? (
            <FollowWork
              machineId={map.rig.machineId}
              chain={chain}
              fromId={follow}
              socket={socket}
              cache={bodies.current}
              onClose={() => setFollow(null)}
              keys={keys}
            />
          ) : (
            <HandoffPanel
              machineId={map.rig.machineId}
              selection={{
                edge: pinned!.edge,
                title: edgeTitle(pinnedEdge),
                items: pinnedEdge.items,
                itemId:
                  pinned!.itemId && pinnedEdge.items.some((q) => q.id === pinned!.itemId)
                    ? pinned!.itemId
                    : (pinnedEdge.items[pinnedEdge.items.length - 1]?.id ?? ''),
              }}
              mode="pinned"
              pinned
              socket={socket}
              cache={bodies.current}
              showMode={false}
              onPick={(id) => setPinned({ edge: pinned!.edge, itemId: id })}
              onMode={() => {}}
              onClose={() => setPinned(null)}
              onFollow={chainOf ? setFollow : undefined}
              keys={keys}
              onLine={(dir) => {
                // Views K: ] / [ = next / previous line, in drawing (Tab) order; opens its newest.
                // r1 W2 MEDIUM-1: planned lines have no handoffs (no drawer), so ] / [ skip them.
                const order = placed.filter((p) => !p.edge.planned).map((p) => edgeKey(p.edge));
                if (!order.length) return;
                const i = order.indexOf(pinned!.edge);
                setPinned({ edge: order[(i + dir + order.length) % order.length]!, itemId: null });
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}
