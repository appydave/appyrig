import { useLayoutEffect, useRef, useState } from 'react';
import { ago, PIP } from '../fleet/model.js';
import type { MapEdge, RigMap as RigMapView } from '../fleet/views.js';
import SkillPill from './SkillPill.js';

interface Props {
  map: RigMapView | null;
  onOpen: (key: string) => void;
  /** v1.5 · L1: the skill-count pill opens the seat's Loadout debug view. */
  onOpenSkills?: (key: string) => void;
}

/** Highest an arc may rise above (or dip below) its row; .pod-seats pads for it. */
const ARC_MAX = 64;
/** Each further outside lane steps right, so a line to the rig never runs through another card. */
const LANE_STEP = 240;

/** A point along the cubic bezier P0..P3 at t. */
const bez = (t: number, p0: number, p1: number, p2: number, p3: number) =>
  (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3;

interface Placed {
  edge: MapEdge;
  d: string;
  lx: number;
  ly: number;
}

/**
 * Concept 3 · Rig Map: machines as lanes, pods as bands, seats as cards. The lines are real queue
 * traffic (who handed work to whom, and how often), drawn over the cards from measured positions.
 */
export default function RigMap({ map, onOpen, onOpenSkills }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

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
      const out: Placed[] = [];
      map.edges
        .filter((e) => !e.self)
        .forEach((edge) => {
          const a = rect(edge.from);
          const b = rect(edge.to);
          if (!a || !b) return;
          const acx = a.x + a.w / 2;
          const bcx = b.x + b.w / 2;
          if (Math.abs(a.y - b.y) < 20) {
            // Same row: left→right arcs over the top, right→left arcs under, so a pair never overlaps.
            const over = bcx > acx;
            const sy = over ? a.y : a.y + a.h;
            const ey = over ? b.y : b.y + b.h;
            const sx = acx + (over ? 12 : -12);
            const ex = bcx + (over ? -12 : 12);
            const lift = (over ? -1 : 1) * Math.min(ARC_MAX, 22 + Math.abs(ex - sx) * 0.12);
            out.push({
              edge,
              d: `M${sx},${sy} C${sx},${sy + lift} ${ex},${ey + lift} ${ex},${ey}`,
              lx: (sx + ex) / 2,
              ly: (sy + ey) / 2 + lift * 0.75,
            });
            return;
          }
          // Different rows (another pod line or another machine): leave from the facing edge.
          const down = b.y > a.y;
          const sx = acx + (down ? 10 : -10);
          const ex = bcx + (down ? 10 : -10);
          const sy = down ? a.y + a.h : a.y;
          const ey = down ? b.y : b.y + b.h;
          const mid = (sy + ey) / 2;
          // The label sits near the start, clear of the lane headings halfway down.
          const t = 0.22;
          out.push({
            edge,
            d: `M${sx},${sy} C${sx},${mid} ${ex},${mid} ${ex},${ey}`,
            lx: bez(t, sx, sx, ex, ex) + 10,
            ly: bez(t, sy, mid, mid, ey),
          });
        });
      setPlaced(out);
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

  return (
    <section className="rigmap" data-testid="rig-map" aria-label={`Rig map of ${map.rig.name}`}>
      <p className="view-caption" data-explain="handoff">
        <b>{map.rig.name}</b> on {map.rig.machineLabel} · {map.handoffs} handoffs through the queue
        · line width = how often one seat handed work to another · amber = still waiting · dashed =
        left open over 2 h
      </p>
      <div className="rigmap-canvas" ref={box}>
        <svg
          className="rigmap-edges"
          width={size.w}
          height={size.h}
          aria-hidden="true"
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
          {placed.map((p) => (
            <g
              key={`${p.edge.from}→${p.edge.to}`}
              data-testid="rig-map-edge"
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
              <text x={p.lx} y={p.ly} className="rigmap-count">
                {p.edge.count}
              </text>
            </g>
          ))}
        </svg>
        {map.lanes.map((lane, i) => (
          <div
            className="lane"
            key={lane.machineId}
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
                        aria-label={
                          s.key.startsWith('?/')
                            ? `${s.name}: not a seat any machine reports`
                            : `${s.name}: open in focus`
                        }
                        data-explain="seat"
                        data-explain-ctx={`${s.name} · ${s.model.text} · ${PIP[s.pip].label}`}
                      >
                        <span className="chip" data-family={s.model.family} data-explain="model">
                          {s.model.text}
                        </span>
                        <b>{s.name}</b>
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
    </section>
  );
}
