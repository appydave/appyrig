import { useLayoutEffect, useRef, useState } from 'react';
import { PIP } from '../fleet/model.js';
import type { MapEdge, RigMap as RigMapView } from '../fleet/views.js';

interface Props {
  map: RigMapView | null;
  onOpen: (key: string) => void;
}

/** Highest an arc may rise above (or dip below) its row; .pod-seats pads for it. */
const ARC_MAX = 64;

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
export default function RigMap({ map, onOpen }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !map) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const rect = (key: string) => {
        const n = el.querySelector<HTMLElement>(`[data-node-key="${CSS.escape(key)}"]`);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
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
          out.push({
            edge,
            d: `M${sx},${sy} C${sx},${mid} ${ex},${mid} ${ex},${ey}`,
            lx: (sx + ex) / 2 + 8,
            ly: mid,
          });
        });
      setPlaced(out);
      setSize({ w: el.scrollWidth, h: el.scrollHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);

  if (!map) return <p className="empty">Pick a rig.</p>;
  const max = Math.max(1, ...map.edges.map((e) => e.count));
  const selfOf = new Map(map.edges.filter((e) => e.self).map((e) => [e.from, e.count]));

  return (
    <section className="rigmap" data-testid="rig-map" aria-label={`Rig map of ${map.rig.name}`}>
      <p className="view-caption">
        <b>{map.rig.name}</b> on {map.rig.machineLabel} · {map.handoffs} handoffs through the queue
        · line width = how often one seat handed work to another · amber = still waiting
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
            >
              <path
                d={p.d}
                className={p.edge.open ? 'rigmap-edge open' : 'rigmap-edge'}
                strokeWidth={1.2 + (p.edge.count / max) * 5}
                markerEnd="url(#rm-arrow)"
              />
              <text x={p.lx} y={p.ly} className="rigmap-count">
                {p.edge.count}
              </text>
            </g>
          ))}
        </svg>
        {map.lanes.map((lane) => (
          <div
            className="lane"
            key={lane.machineId}
            data-testid="rig-map-lane"
            data-liveness={lane.liveness}
          >
            <div className="lane-head">
              <b>{lane.label}</b>
              <i>{lane.subtitle}</i>
            </div>
            <div className="lane-pods">
              {lane.pods.map((pod) => (
                <div className="pod" key={pod.name}>
                  <div className="pod-name">pod · {pod.name}</div>
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
                        title={
                          s.key.startsWith('?/')
                            ? 'Not a seat any machine reports'
                            : 'Open in focus'
                        }
                      >
                        <span className="chip" data-family={s.model.family}>
                          {s.model.text}
                        </span>
                        <b>{s.name}</b>
                        <span className="pip" data-pip={s.pip}>
                          <span className="pip-glyph">{PIP[s.pip].glyph}</span> {PIP[s.pip].label}
                        </span>
                        {s.open > 0 && <span className="node-wait">{s.open} waiting</span>}
                        {selfOf.get(s.key) ? (
                          <span className="node-self">↺ {selfOf.get(s.key)} to itself</span>
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
