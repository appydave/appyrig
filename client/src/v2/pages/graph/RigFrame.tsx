import { useLayoutEffect, useRef, useState } from 'react';
import { RIG_STATE, plannedWord, type MapEdge } from '../../../fleet/views.js';
import { routeLines, spreadLabels, type Placed } from '../../../components/RigMap.js';
import { MockMark } from '../../kit/index.js';
import { FakeButton } from './FakeRunner.js';
import { SeatCard, seatMatches } from './SeatCard.js';
import type { FlagFilter, GraphRig } from './model.js';

/** Room a stacked arc needs above / below a row of cards, at least. */
const ARC_MIN = 24;

export interface LineHover {
  title: string;
  lines: string[];
  x: number;
  y: number;
}

interface Props {
  rig: GraphRig;
  open: boolean;
  picked: boolean;
  /** The tree's highlighted item: a rig key, `<rig key>/pod/<name>`, or a seat key. */
  focusKey: string | null;
  filter: FlagFilter | null;
  zoom: number;
  onToggle: (key: string) => void;
  onPick: (key: string) => void;
  onOpen: (seatKey: string) => void;
  onHover: (seatKey: string, el: HTMLElement) => void;
  onLeave: () => void;
  onLineHover: (h: LineHover | null) => void;
  onLinePin: (edge: MapEdge, title: string) => void;
  nameOf: (seatKey: string) => string;
}

export const podId = (rigKey: string, pod: string) => `${rigKey}/pod/${pod}`;

/**
 * One rig as a frame (C42). Collapsed: name, state, machine, agents and active counts, and its
 * traffic with other rigs. Expanded: the pods and agent cards, with the in-rig handoff lines
 * (counts from the queue) and the spec's planned lines (dotted), routed as the Rig Map does.
 */
export default function RigFrame(p: Props) {
  const { rig, open } = p;
  const st = RIG_STATE[rig.state];
  const loose = !rig.ref;
  const running = rig.ref?.status === 'running';
  const selfOf = new Map(rig.edges.filter((e) => e.self).map((e) => [e.from, e.count]));
  const lines = [...rig.edges, ...(rig.planned ?? [])];
  const { box, placed, size, room } = useInRigLines(open ? lines : [], p.zoom, open);
  const max = Math.max(1, ...rig.edges.map((e) => e.count));
  const title = (e: MapEdge) =>
    e.planned
      ? `Planned: ${p.nameOf(e.from)} ${plannedWord(e.planned)} ${p.nameOf(e.to)} · no handoff yet`
      : `${p.nameOf(e.from)} → ${p.nameOf(e.to)} · ${e.count} handoff${e.count === 1 ? '' : 's'}`;
  const hover = (e: MapEdge, ev: { clientX: number; clientY: number }) => {
    const last = e.items[e.items.length - 1];
    p.onLineHover({
      title: title(e),
      lines: e.planned
        ? ['From the rig spec. It turns solid once a handoff goes this way.']
        : [
            ...(e.open ? [`${e.open} still waiting`] : []),
            ...(e.stale ? [`${e.stale} left open over 2 h`] : []),
            ...(last ? [`latest: ${last.summary ?? last.id}`] : []),
            'Click for the handoffs.',
          ],
      x: ev.clientX + 14,
      y: ev.clientY + 14,
    });
  };

  return (
    <article
      className="g2-rig"
      data-graph-rig={rig.key}
      data-testid="g2-rig"
      data-rig-key={rig.key}
      data-state={rig.state}
      data-loose={loose || undefined}
      data-picked={p.picked || undefined}
      data-highlight={p.focusKey === rig.key || undefined}
      aria-expanded={open}
    >
      <header className="g2-rig-head" data-testid="g2-rig-head">
        <button
          type="button"
          className="g2-caret"
          data-testid="g2-rig-toggle"
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${rig.name}`}
          onClick={() => p.onToggle(rig.key)}
        >
          {open ? '▾' : '▸'}
        </button>
        <button
          type="button"
          className="g2-rig-name mono"
          data-testid="g2-rig-name"
          title={
            loose
              ? 'Sessions on this machine that belong to no rig'
              : 'Pick this rig (the Current Rig Map shows it after a flip)'
          }
          onClick={() => (loose ? p.onToggle(rig.key) : p.onPick(rig.key))}
        >
          {rig.name}
        </button>
        <span className="rig-state" data-state={rig.state}>
          {st.glyph} {st.label}
        </span>
        <span className="g2-rig-machine">{rig.machineLabel}</span>
        <span className="g2-rig-counts mono" data-testid="g2-rig-counts">
          {rig.agents} agent{rig.agents === 1 ? '' : 's'} · {rig.active} active
        </span>
        {(rig.crossOut > 0 || rig.crossIn > 0) && (
          <span
            className="g2-rig-cross mono"
            title="Handoffs with other rigs: sent ↗ and received ↙"
            data-testid="g2-rig-cross"
          >
            ↗{rig.crossOut} ↙{rig.crossIn}
          </span>
        )}
        {(rig.flags.needsMe > 0 || rig.state === 'attention') && !loose && (
          <span className="g2-flag" data-flag="needsMe">
            ▲
          </span>
        )}
      </header>
      {open && (
        <div className="g2-rig-body">
          {!loose && (
            <div className="g2-rig-actions" data-testid="g2-rig-actions">
              <FakeButton
                testId="g2-fake-start"
                disabled={running}
                title={running ? 'Already running' : undefined}
                ask={{
                  label: 'Start',
                  question: `Start ${rig.name} on the ${rig.machineLabel}?`,
                  result: `${rig.name} started on the ${rig.machineLabel} (pretend)`,
                }}
              />
              <FakeButton
                testId="g2-fake-restore"
                ask={{
                  label: 'Restore',
                  question: `Restore ${rig.name} from its last snapshot on the ${rig.machineLabel}?`,
                  result: `${rig.name} restored (pretend)`,
                }}
              />
              <FakeButton
                testId="g2-fake-launch"
                ask={{
                  label: 'Launch',
                  question: `Launch a fresh ${rig.name} from its spec on the ${rig.machineLabel}?`,
                  result: `${rig.name} launched (pretend)`,
                }}
              />
              <MockMark />
              {rig.planned === null && (
                <span className="quiet g2-no-plan">
                  no planned lines: this collector does not send the rig spec&apos;s edges
                </span>
              )}
            </div>
          )}
          <div className="g2-rig-canvas" ref={box}>
            <svg
              className="rigmap-edges"
              width={size.w}
              height={size.h}
              role="group"
              aria-label={`Handoff lines inside ${rig.name}`}
              data-testid="g2-rig-lines"
            >
              <defs>
                <marker
                  id={`g2a-${rig.key}`}
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
              {placed.map((pl) => (
                <g
                  key={`${pl.edge.planned ? 'p' : 'e'}:${pl.edge.from}→${pl.edge.to}`}
                  data-testid={pl.edge.planned ? 'g2-planned' : 'g2-edge'}
                  className="g2-line"
                  tabIndex={pl.edge.planned ? undefined : 0}
                  role={pl.edge.planned ? 'img' : 'button'}
                  aria-label={title(pl.edge)}
                  onPointerEnter={(ev) => hover(pl.edge, ev)}
                  onPointerMove={(ev) => hover(pl.edge, ev)}
                  onPointerLeave={() => p.onLineHover(null)}
                  onClick={() => !pl.edge.planned && p.onLinePin(pl.edge, title(pl.edge))}
                  onKeyDown={(ev) => {
                    if (!pl.edge.planned && (ev.key === 'Enter' || ev.key === ' ')) {
                      ev.preventDefault();
                      p.onLinePin(pl.edge, title(pl.edge));
                    }
                  }}
                >
                  <path
                    d={pl.d}
                    className={`rigmap-edge ${pl.edge.planned ? 'planned' : pl.edge.open ? 'open' : pl.edge.stale ? 'stale' : ''}`}
                    strokeWidth={pl.edge.planned ? undefined : 1.2 + (pl.edge.count / max) * 4}
                    markerEnd={`url(#g2a-${rig.key})`}
                  />
                  <path d={pl.d} className="hit" />
                </g>
              ))}
              {placed.map((pl) => {
                const w = pl.edge.planned
                  ? Math.round(plannedWord(pl.edge.planned).length * 6.6 + 14)
                  : 22;
                return (
                  <g
                    key={`l:${pl.edge.planned ? 'p' : 'e'}:${pl.edge.from}→${pl.edge.to}`}
                    className={`rigmap-label${pl.edge.planned ? ' planned' : ''}`}
                    aria-hidden="true"
                  >
                    <rect
                      x={pl.lx - w / 2}
                      y={pl.ly - 9}
                      width={w}
                      height={18}
                      rx={pl.edge.planned ? 9 : 4}
                    />
                    <text x={pl.lx} y={pl.ly} className="rigmap-count">
                      {pl.edge.planned ? plannedWord(pl.edge.planned) : pl.edge.count}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div className="g2-pods">
              {rig.pods.map((pod) => (
                <div
                  className="pod g2-pod"
                  key={pod.name}
                  data-pod-id={podId(rig.key, pod.name)}
                  data-highlight={p.focusKey === podId(rig.key, pod.name) || undefined}
                >
                  <div className="pod-name">pod · {pod.name}</div>
                  <div
                    className="g2-pod-seats"
                    style={{
                      paddingTop: Math.max(ARC_MIN, room.top),
                      paddingBottom: Math.max(ARC_MIN, room.bottom),
                    }}
                  >
                    {pod.seats.map((s) => (
                      <SeatCard
                        key={s.key}
                        seat={s}
                        selfCount={selfOf.get(s.key) ?? 0}
                        dim={!seatMatches(s, p.filter)}
                        highlight={p.focusKey === s.key}
                        onOpen={p.onOpen}
                        onHover={p.onHover}
                        onLeave={p.onLeave}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

/** Measures the open frame's cards and routes its lines (RigMap's router, read-only reuse). */
function useInRigLines(edges: MapEdge[], zoom: number, open: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [roomKey, setRoomKey] = useState('0,0');
  const sig = edges.map((e) => `${e.from}>${e.to}:${e.count}:${e.planned ?? ''}`).join('|');
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !open) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const z = zoom || 1;
      const boxOf = (n: Element) => {
        const r = n.getBoundingClientRect();
        return {
          x: (r.left - base.left) / z,
          y: (r.top - base.top) / z,
          w: r.width / z,
          h: r.height / z,
        };
      };
      const node = (key: string) => el.querySelector(`[data-node-key="${CSS.escape(key)}"]`);
      const {
        placed: out,
        roomTop,
        roomBottom,
      } = routeLines(edges, {
        card: (k) => {
          const n = node(k);
          return n ? boxOf(n) : null;
        },
        pod: (k) => {
          const n = node(k)?.closest('.g2-pod');
          return n ? boxOf(n) : null;
        },
        lane: () => 'rig',
        podCards: (k) => {
          const pod = node(k)?.closest('.g2-pod');
          return pod ? [...pod.querySelectorAll('[data-node-key]')].map(boxOf) : [];
        },
      });
      const next = `${roomTop.get('rig') ?? 0},${roomBottom.get('rig') ?? 0}`;
      setRoomKey((r) => (r === next ? r : next));
      setPlaced(spreadLabels(out));
      setSize({ w: el.scrollWidth, h: el.scrollHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll('[data-node-key]').forEach((n) => ro.observe(n));
    return () => ro.disconnect();
    // `sig` stands for `edges` (a new array every render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, zoom, open]);
  const [top, bottom] = roomKey.split(',').map(Number) as [number, number];
  return { box, placed: open ? placed : [], size, room: { top, bottom } };
}
