import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { HandoffGetOutput } from '@appydave/shared';
import type { FleetSocket } from '../../../fleet/useFleet.js';
import HandoffPanel from '../../../components/HandoffPanel.js';
import FollowWork from '../../../components/FollowWork.js';
import type { WorkChain } from '../../../fleet/timeline.js';
import { routeLines, type Placed } from '../../../components/RigMap.js';
import { mapPairs, planLines, routerEdge, type PlannedLine } from './lines.js';
import {
  HandoffLegend,
  LeftOpenBadgeSvg,
  WaitingBadgeSvg,
  labelClass,
  lineClass,
  lineWidth,
  pairLabel,
  useLineFocus,
  type LineFocusState,
} from '../../kit/index.js';
import { ago, PIP } from '../../../fleet/model.js';
import type { MapEdge, RigMap as RigMapView } from '../../../fleet/views.js';
import SkillPill from '../../../components/SkillPill.js';
import {
  Address,
  ContextLine,
  CopyAttach,
  harnessOf,
  HarnessMark,
  pctText,
  RoleTag,
  tokensText,
} from '../../../components/SeatCardLines.js';
import type { MapSeat } from '../../../fleet/views.js';
import { attachLine } from '../../../components/WaitingOnDavid.js';
import { callVerb } from '../../../fleet/coreCall.js';
import type { RigWaitingOutput } from '@appydave/shared';

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

/** v15 UI-A: a seat's detail card, anchored under its node in canvas coordinates. */
interface Detail {
  key: string;
  x: number;
  y: number;
  /** Opens upward (its y is the node's top) when there is no room below inside the canvas. */
  above: boolean;
}

/** The detail card's width, and the room it needs below a node before it opens upward instead. */
const DETAIL_W = 290;
const DETAIL_H = 230;

/** The least room above and below a row of cards, arcs or not. */
const ARC_MIN = 24;
/** C6-A: the gutter left of every lane that lines between lanes run down. */
const GUTTER = 26;
/** Each further outside lane steps right, so a line to the rig never runs through another card. */
const LANE_STEP = 300;

/** A routed line with the model line it draws and the width its label needs. */
type PlacedLine = Placed & { line: PlannedLine; w: number };

const LABEL_H = 18;
/** "14 ⇄ 8" is wider than one number; a planned word is as wide as its text. */
const labelWidth = (l: PlannedLine) => {
  const text = l.planned ?? pairLabel(l);
  return Math.max(26, Math.round(text.length * 7 + 14));
};

/** A point along the cubic bezier P0..P3 at t. */
const bez = (t: number, p0: number, p1: number, p2: number, p3: number) =>
  (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;

/**
 * A label that would sit on another is slid along its own line to the first spot where it overlaps
 * none (the original's rule, with each label's own width).
 */
function spreadLabels<T extends { lx: number; ly: number; w: number; c: Placed['c'] }>(
  items: T[]
): T[] {
  const taken: { x: number; y: number; w: number }[] = [];
  return items.map((p) => {
    const clear = (x: number, y: number) =>
      taken.every(
        (t) => Math.abs(t.x - x) >= (t.w + p.w) / 2 + 2 || Math.abs(t.y - y) >= LABEL_H + 2
      );
    let best = { x: p.lx, y: p.ly, w: p.w };
    if (!clear(best.x, best.y)) {
      const [x0, y0, x1, y1, x2, y2, x3, y3] = p.c;
      for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78, 0.15, 0.85]) {
        const x = bez(t, x0, x1, x2, x3);
        const y = bez(t, y0, y1, y2, y3);
        if (clear(x, y)) {
          best = { x, y, w: p.w };
          break;
        }
      }
    }
    taken.push(best);
    return { ...p, lx: best.x, ly: best.y };
  });
}

interface End {
  x: number;
  y: number;
  /** Unit vector pointing out of the line at this end. */
  dx: number;
  dy: number;
}

/** Where a routed path starts and ends, and which way each end points (for arrowheads). */
function arrowEnds(d: string): { start: End; end: End } {
  const n = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const pts: [number, number][] = [];
  for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i]!, n[i + 1]!]);
  const unit = (from: [number, number], to: [number, number]) => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy) || 1;
    return { dx: dx / len, dy: dy / len };
  };
  const first = pts[0] ?? [0, 0];
  const last = pts[pts.length - 1] ?? [0, 0];
  // a cubic has handles at 1 and 2; a polyline's neighbours are the next and previous points
  const next = pts.find((q) => q[0] !== first[0] || q[1] !== first[1]) ?? first;
  const prev = [...pts].reverse().find((q) => q[0] !== last[0] || q[1] !== last[1]) ?? last;
  return {
    start: { x: first[0], y: first[1], ...unit(next, first) },
    end: { x: last[0], y: last[1], ...unit(prev, last) },
  };
}

/** A small filled triangle at a line's end, pointing out along it. */
function arrowHead(e: End): string {
  const len = 9;
  const half = 4.5;
  const bx = e.x - e.dx * len;
  const by = e.y - e.dy * len;
  return `${e.x},${e.y} ${bx - e.dy * half},${by + e.dx * half} ${bx + e.dy * half},${by - e.dx * half}`;
}

/**
 * Concept 3 · Rig Map: machines as lanes, pods as bands, seats as cards. The lines are real queue
 * traffic (who handed work to whom, and how often), drawn over the cards from measured positions.
 */
export default function RigMapV2({
  map,
  onOpen,
  onOpenSkills,
  socket,
  keys = true,
  chainOf,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<PlacedLine[]>([]);
  const lf = useLineFocus();
  const pairs = useMemo(() => (map ? mapPairs(map) : []), [map]);
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
  const [detail, setDetail] = useState<Detail | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepDetail = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const hideDetail = () => {
    keepDetail();
    hideTimer.current = setTimeout(() => setDetail(null), 220);
  };
  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    []
  );
  // Each machine's ssh target (AppyRig config, via rig.waiting) for the attach line; undefined = not asked yet.
  // Only answers the hub gave are kept: a refused or timed-out lookup is "unknown" (no button),
  // never "no ssh". Cleared when the rig changes, and an answer for an older rig is dropped.
  const [sshOf, setSshOf] = useState<Record<string, string | null>>({});
  const asking = useRef(new Set<string>());
  const generation = useRef(0);
  const askSsh = (machineId: string, rig: string | null) => {
    // The machine is asked about a rig that exists ON it: the seat's own. No rig, no lookup.
    if (!socket || !rig || asking.current.has(machineId)) return;
    asking.current.add(machineId);
    const gen = generation.current;
    void callVerb<RigWaitingOutput>(socket, 'rig.waiting', { machine: machineId, rig }).then(
      (a) => {
        if (gen !== generation.current) return;
        asking.current.delete(machineId); // a refusal can be asked again on the next hover
        if (a.ok) setSshOf((o) => ({ ...o, [machineId]: a.value.ssh }));
      }
    );
  };
  const showDetail = (key: string, node: HTMLElement, rig: string | null) => {
    keepDetail();
    const c = box.current;
    if (!c || document.querySelector('[data-explain-on]')) return;
    if (!key.startsWith('?/')) askSsh(key.slice(0, key.indexOf('/')), rig);
    const a = c.getBoundingClientRect();
    const r = node.getBoundingClientRect();
    const top = r.top - a.top + c.scrollTop;
    const bottom = r.bottom - a.top + c.scrollTop;
    // L4: never grow the scroll area: open upward when there is no room below inside the canvas.
    const above = bottom + 6 + DETAIL_H > c.scrollHeight && top - 6 - DETAIL_H > 0;
    setDetail({
      key,
      x: Math.max(0, Math.min(r.left - a.left + c.scrollLeft, c.scrollWidth - DETAIL_W - 6)),
      y: above ? top - 6 : bottom + 6,
      above,
    });
  };
  useEffect(() => {
    // Esc closes the card and is spent (capture + preventDefault, as the line drawer does), so the
    // screen's own Esc does not also go back. Turning Explain on hides the card too.
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setDetail(null);
    };
    window.addEventListener('keydown', onKey, true);
    const mo = new MutationObserver(() => {
      if (document.querySelector('[data-explain-on]')) setDetail(null);
    });
    mo.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-explain-on'],
    });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      mo.disconnect();
    };
  }, [detail]);
  const bodies = useRef(new Map<string, HandoffGetOutput>());
  const [follow, setFollow] = useState<string | null>(null);
  // r1 INFO-2: computed once per follow, not twice per render.
  const chain = useMemo(() => (follow && chainOf ? chainOf(follow) : null), [follow, chainOf]);
  useEffect(() => {
    setPinned(null);
    setCard(null);
    setDetail(null);
    setFollow(null);
    generation.current += 1;
    asking.current.clear();
    setSshOf({});
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
      const podId = new Map<string, string>(
        map.lanes.flatMap((l) =>
          l.pods.flatMap((pd) => pd.seats.map((x) => [x.key, `${l.machineId}|${pd.name}`] as const))
        )
      );
      // ONE line per pair; lines that cannot stay in a row fold into one rail per pair of pods
      const planned = planLines(pairs, { card: rect, pod: (key) => podId.get(key) ?? '' });
      const byKey = new Map(planned.map((l) => [l.key, l]));
      const {
        placed: out,
        roomTop,
        roomBottom,
      } = routeLines(planned.map(routerEdge), {
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
      setPlaced(
        spreadLabels(
          out.map((q) => {
            const line = byKey.get(`${q.edge.from}→${q.edge.to}`)!;
            return { ...q, line, w: labelWidth(line) };
          })
        )
      );
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
  }, [map, pairs]);

  if (!map) return <p className="empty">Pick a rig.</p>;
  const selfOf = new Map(map.edges.filter((e) => e.self).map((e) => [e.from, e.count]));
  const names = new Map(
    map.lanes.flatMap((l) => l.pods.flatMap((p) => p.seats.map((s) => [s.key, s.name] as const)))
  );
  const nameOf = (key: string) => names.get(key) ?? key;
  const podNames = new Map<string, string>(
    map.lanes.flatMap((l) => l.pods.flatMap((pd) => pd.seats.map((x) => [x.key, pd.name] as const)))
  );
  const edgeKey = (l: PlannedLine) => l.key;
  const cardAt = (ev: { clientX: number; clientY: number }, title: string, lines: string[]) =>
    setCard(
      document.querySelector('[data-explain-on]')
        ? null
        : { x: ev.clientX + 14, y: ev.clientY + 14, title, lines }
    );
  const plural = (n: number) => `${n} handoff${n === 1 ? '' : 's'}`;
  const edgeTitle = (l: PlannedLine) =>
    l.rail
      ? `pod ${podNames.get(l.a) ?? '?'} ⇄ pod ${podNames.get(l.b) ?? '?'} · ${plural(l.total)} over ${l.pairs} pair${l.pairs === 1 ? '' : 's'}`
      : `${nameOf(l.a)} ⇄ ${nameOf(l.b)} · ${plural(l.total)}`;
  const edgeCard = (l: PlannedLine, ev: { clientX: number; clientY: number }) => {
    const last = l.items[l.items.length - 1];
    cardAt(ev, edgeTitle(l), [
      ...(l.rail
        ? []
        : [
            `${nameOf(l.a)} → ${nameOf(l.b)}: ${l.aToB} · ${nameOf(l.b)} → ${nameOf(l.a)}: ${l.bToA}`,
          ]),
      ...(l.waiting ? [`${l.waiting} still waiting`] : []),
      ...(l.leftOpen ? [`${l.leftOpen} left open over 2 h`] : []),
      ...(last ? [`latest: ${last.summary ?? last.id}`] : []),
      'Click (or Enter) for the handoffs.',
    ]);
  };
  const seatsByKey = new Map<string, MapSeat>(
    map.lanes.flatMap((l) => l.pods.flatMap((p) => p.seats.map((x) => [x.key, x] as const)))
  );
  const detailSeat = detail ? seatsByKey.get(detail.key) : undefined;
  const edgesOf = (key: string) => {
    const touches = (e: MapEdge) => !e.self && (e.from === key || e.to === key);
    return `${map.edges.filter(touches).length} handed · ${(map.planned ?? []).filter(touches).length} planned`;
  };
  const renderDetail = () => {
    if (!detail || !detailSeat) return null;
    const machineId = detail.key.slice(0, detail.key.indexOf('/'));
    const ssh = sshOf[machineId];
    // Unknown (not asked, refused, timed out) means no button. A bare local line only when this
    // seat's machine is the rig's own AND its lookup succeeded with no ssh target; another
    // machine needs its ssh target or gets nothing. If in doubt, no button.
    const canAttach =
      !detail.key.startsWith('?/') &&
      ssh !== undefined &&
      (ssh !== null || machineId === map.rig.machineId) &&
      attachLine(detailSeat.address, ssh) !== null;
    return (
      <div
        className="seat-detail"
        data-testid="seat-detail"
        style={{
          left: detail.x,
          top: detail.y,
          transform: detail.above ? 'translateY(-100%)' : undefined,
        }}
        onPointerEnter={keepDetail}
        onPointerLeave={hideDetail}
        onFocus={keepDetail}
        onBlur={hideDetail}
      >
        <div className="seat-detail-head">
          <b>{detailSeat.name}</b>
          {canAttach && <CopyAttach session={detailSeat.address} ssh={ssh ?? null} />}
        </div>
        <dl className="mono">
          <dt>activity</dt>
          <dd data-testid="detail-activity">{detailSeat.activity ?? PIP[detailSeat.pip].label}</dd>
          <dt>session</dt>
          <dd data-testid="detail-session">{detailSeat.address}</dd>
          <dt>runtime</dt>
          <dd data-testid="detail-runtime">
            {harnessOf(detailSeat.runtime, detailSeat.modelRaw).label} ·{' '}
            {detailSeat.modelRaw ?? '—'}
          </dd>
          <dt>spec / role</dt>
          <dd data-testid="detail-role">{detailSeat.agentRole ?? '—'}</dd>
          <dt>edges</dt>
          <dd data-testid="detail-edges">{edgesOf(detailSeat.key)}</dd>
          <dt>tokens</dt>
          <dd data-testid="detail-tokens">
            {tokensText(detailSeat.contextTokens)} · {pctText(detailSeat.contextPct)}
          </dd>
        </dl>
      </div>
    );
  };
  const plannedTitle = (l: PlannedLine) =>
    `Planned: ${nameOf(l.a)} ${l.planned} ${nameOf(l.b)} (rig spec) · no handoff along it yet`;
  const plannedCard = (l: PlannedLine, ev: { clientX: number; clientY: number }) =>
    cardAt(ev, plannedTitle(l), [
      'From the rig spec in OpenRig. It turns into a solid line once a handoff goes this way.',
    ]);
  const pinnedEdge = pinned ? placed.find((q) => q.line.key === pinned.edge)?.line : undefined;
  const stateOf = (l: PlannedLine): LineFocusState => {
    if (lf.focus === null) return 'faint';
    if (lf.focus.startsWith('line:')) return lf.focus === `line:${l.key}` ? 'lit' : 'dimmed';
    return l.members.includes(lf.focus) ? 'lit' : 'dimmed';
  };
  const edgeHandlers = (l: PlannedLine) => ({
    tabIndex: 0,
    role: 'button',
    'aria-label': `${edgeTitle(l)}. Enter shows them.`,
    onPointerEnter: (ev: React.PointerEvent) => {
      lf.setFocus(`line:${l.key}`);
      edgeCard(l, ev);
    },
    onPointerMove: (ev: React.PointerEvent) => edgeCard(l, ev),
    onPointerLeave: () => {
      lf.setFocus(null);
      setCard(null);
    },
    onFocus: () => lf.setFocus(`line:${l.key}`),
    onBlur: () => lf.setFocus(null),
    onClick: () => {
      setCard(null);
      setPinned({ edge: edgeKey(l), itemId: null });
    },
    onKeyDown: (ev: React.KeyboardEvent) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        setPinned({ edge: edgeKey(l), itemId: null });
      }
    },
  });

  return (
    <section className="rigmap" data-testid="rig-map" aria-label={`Rig map of ${map.rig.name}`}>
      <p className="view-caption" data-explain="handoff">
        <b>{map.rig.name}</b> on {map.rig.machineLabel} · {map.handoffs} handoffs through the queue
        {map.outgoing ? ` (+ ${map.outgoing} sent to other rigs)` : ''}
        {map.planned === null ? (
          <span data-testid="rig-map-no-plan">
            {' '}
            · no planned lines: {map.rig.machineLabel}&apos;s collector did not send the rig
            spec&apos;s edges (an older collector, or the graph could not be read)
          </span>
        ) : null}
      </p>
      <HandoffLegend compact />
      <div className="rigmap-canvas" ref={box} style={{ ['--gutter' as string]: `${GUTTER}px` }}>
        <svg
          className="rigmap-edges"
          width={size.w}
          height={size.h}
          role="group"
          aria-label="Handoff lines: Tab to a line, Enter shows its handoffs"
          data-testid="rig-map-edges"
        >
          {placed.map((p) => {
            const l = p.line;
            const st = stateOf(l);
            const ends = arrowEnds(p.d);
            const body = (
              <>
                <path
                  d={p.d}
                  className={lineClass(st, !!l.planned)}
                  strokeWidth={l.planned ? lineWidth(0) : lineWidth(l.total)}
                />
                {(l.planned ? [ends.end] : [l.aToB > 0 && ends.end, l.bToA > 0 && ends.start]).map(
                  (a, i) =>
                    a && (
                      <polygon
                        key={i}
                        points={arrowHead(a)}
                        className={`rm2-arrow ${labelClass(st)}`}
                        data-testid="rig-map-arrow"
                      />
                    )
                )}
                <path d={p.d} className="hit" />
              </>
            );
            return l.planned ? (
              <g
                key={`planned:${l.key}`}
                data-testid="rig-map-planned"
                data-edge={l.key}
                data-state={st}
                role="img"
                aria-label={plannedTitle(l)}
                onPointerEnter={(ev) => plannedCard(l, ev)}
                onPointerMove={(ev) => plannedCard(l, ev)}
                onPointerLeave={() => setCard(null)}
              >
                {body}
              </g>
            ) : (
              <g
                key={`line:${l.key}`}
                data-testid="rig-map-edge"
                data-edge={l.key}
                data-rail={l.rail || undefined}
                data-state={st}
                data-selected={pinned?.edge === l.key || undefined}
                {...edgeHandlers(l)}
              >
                {body}
              </g>
            );
          })}
          {/* The labels sit above every line, so each line can be reached by its label. */}
          {placed.map((p) => {
            const l = p.line;
            const st = stateOf(l);
            const text = l.planned ?? pairLabel(l);
            return (
              <Fragment key={`label:${l.key}`}>
                <g
                  className={`rm2-label ${labelClass(st)}${l.planned ? ' planned' : ''}`}
                  data-testid={l.planned ? 'rig-map-planned-label' : 'rig-map-edge-label'}
                  data-edge={l.key}
                  data-selected={pinned?.edge === l.key || undefined}
                  {...(l.planned
                    ? { 'aria-hidden': true }
                    : { ...edgeHandlers(l), tabIndex: -1, 'aria-hidden': true })}
                >
                  <rect x={p.lx - p.w / 2} y={p.ly - 9} width={p.w} height={18} rx={9} />
                  <text x={p.lx} y={p.ly} className="rm2-count">
                    {text}
                  </text>
                </g>
                <g className={labelClass(st)}>
                  <WaitingBadgeSvg x={p.lx + p.w / 2 + 10} y={p.ly} n={l.waiting} />
                  <LeftOpenBadgeSvg
                    x={p.lx + p.w / 2 + (l.waiting ? 28 : 10)}
                    y={p.ly}
                    n={l.leftOpen}
                  />
                </g>
              </Fragment>
            );
          })}
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
                      <Fragment key={s.key}>
                        <button
                          type="button"
                          className="node"
                          data-node-key={s.key}
                          data-testid="rig-map-node"
                          data-pip={s.pip}
                          onClick={() => !s.key.startsWith('?/') && onOpen(s.key)}
                          onPointerEnter={(ev) => {
                            lf.setFocus(s.key);
                            showDetail(s.key, ev.currentTarget, s.rig);
                          }}
                          onFocus={(ev) => {
                            lf.setFocus(s.key);
                            showDetail(s.key, ev.currentTarget, s.rig);
                          }}
                          onPointerLeave={() => {
                            lf.setFocus(null);
                            hideDetail();
                          }}
                          onBlur={() => {
                            lf.setFocus(null);
                            hideDetail();
                          }}
                          aria-label={
                            s.key.startsWith('?/')
                              ? `${s.name}: not a seat any machine reports`
                              : `${s.name}: open agent panel`
                          }
                          data-explain="seat"
                          // QA W3 MEDIUM-1: key skill chips made a node twice as tall and pushed the
                          // map below the fold (W0); the node shows the role, the skills sit in its title.
                          title={
                            s.keySkills?.length
                              ? `Key skills: ${s.keySkills.join(', ')}`
                              : undefined
                          }
                          data-explain-ctx={`${s.name} · ${s.model.text} · ${PIP[s.pip].label}`}
                        >
                          <span className="node-top">
                            <HarnessMark runtime={s.runtime} model={s.modelRaw} />
                            <span
                              className="chip"
                              data-family={s.model.family}
                              data-explain="model"
                            >
                              {s.model.text}
                            </span>
                          </span>
                          <b>{s.name}</b>
                          {s.source === 'openrig' && <Address id={s.address} />}
                          <RoleTag agentRole={s.agentRole} />
                          <ContextLine pct={s.contextPct} tokens={s.contextTokens} />
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
                        {detail?.key === s.key && renderDetail()}
                      </Fragment>
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
                const order = placed.filter((p) => !p.line.planned).map((p) => p.line.key);
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
