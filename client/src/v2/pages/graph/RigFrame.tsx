import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RIG_STATE, plannedWord, type MapEdge } from '../../../fleet/views.js';
import { routeLines, spreadLabels } from '../../../components/RigMap.js';
import { MockMark } from '../../kit/index.js';
import { FakeButton } from './FakeRunner.js';
import { SeatCard, seatMatches } from './SeatCard.js';
import { avoidCards, plannedLabelW, type Rect } from './labels.js';
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
  /** All callbacks are stable (the page wraps them), so memo(RigFrame) skips a frame whose rig is unchanged. */
  onToggle: (key: string, wasOpen: boolean) => void;
  onPick: (key: string) => void;
  onOpen: (seatKey: string) => void;
  onHover: (seatKey: string, el: HTMLElement) => void;
  onLeave: () => void;
  onTab: (e: React.KeyboardEvent) => void;
  onLineHover: (h: LineHover | null) => void;
  onLinePin: (edge: MapEdge, title: string) => void;
  nameOf: (seatKey: string) => string;
}

export const podId = (rigKey: string, pod: string) => `${rigKey}/pod/${pod}`;

const lineKey = (e: MapEdge) => `${e.planned ? 'p' : 'e'}:${e.from}→${e.to}`;

/** Where a line goes, measured. Only geometry is kept: what the line says is read from the rig at render. */
interface Geom {
  d: string;
  lx: number;
  ly: number;
}

/**
 * One rig as a frame (C42). Collapsed: name, state, machine, agents and active counts, and its
 * traffic with other rigs. Expanded: the pods and agent cards, with the in-rig handoff lines
 * (counts from the queue) and the spec's planned lines (dotted), routed as the Rig Map does.
 */
function RigFrame(p: Props) {
  const { rig, open } = p;
  const [menuOpen, setMenuOpen] = useState(false);
  const nameBtn = useRef<HTMLButtonElement>(null);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const st = RIG_STATE[rig.state];
  const loose = !rig.ref;
  const running = rig.ref?.status === 'running';
  const selfOf = new Map(rig.edges.filter((e) => e.self).map((e) => [e.from, e.count]));
  const lines = open ? [...rig.edges, ...(rig.planned ?? [])] : [];
  const { box, geom, size, room } = useInRigLines(lines, p.zoom, open);
  const max = Math.max(1, ...rig.edges.map((e) => e.count));
  const drawn = lines.filter((e) => !e.self && geom.has(lineKey(e)));
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

  // UX 5: under "Needs me", a rig OpenRig itself flags is a rig-level match: its seats are not
  // dimmed (none of them is wrong) and the header says why it is shown.
  const seatFlagged = rig.pods.some((pod) => pod.seats.some((s) => s.flags.needsMe));
  const rigLevel = p.filter === 'needsMe' && !loose && rig.state === 'attention';
  const sparing = rigLevel && !seatFlagged;

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
      data-menu-open={menuOpen || undefined}
      aria-expanded={open}
    >
      <header
        className="g2-rig-head"
        data-testid="g2-rig-head"
        data-rig-match={rigLevel || undefined}
      >
        <button
          type="button"
          className="g2-caret"
          data-testid="g2-rig-toggle"
          tabIndex={-1}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${rig.name}`}
          onClick={() => p.onToggle(rig.key, open)}
        >
          {open ? '▾' : '▸'}
        </button>
        <button
          type="button"
          ref={nameBtn}
          className="g2-rig-name mono"
          data-testid="g2-rig-name"
          title={
            (loose
              ? 'Sessions on this machine that belong to no rig'
              : 'Pick this rig (the Current Rig Map shows it after a flip)') +
            ' · Right arrow unfolds, then reaches ⋯; Left arrow folds'
          }
          onClick={() => (loose ? p.onToggle(rig.key, open) : p.onPick(rig.key))}
          onKeyDown={(e) => {
            // the header is one Tab stop: arrows unfold / fold, and reach the ⋯ menu
            if (e.key === 'ArrowRight') {
              e.preventDefault();
              if (!open) p.onToggle(rig.key, open);
              else menuBtn.current?.focus();
            } else if (e.key === 'ArrowLeft' && open) {
              e.preventDefault();
              p.onToggle(rig.key, open);
            }
          }}
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
        {rigLevel && (
          <span className="g2-reason" data-testid="g2-rig-reason">
            shown because OpenRig flags this rig: needs attention
          </span>
        )}
        {!loose && (
          <RigMenu
            rig={rig}
            running={!!running}
            trigger={menuBtn}
            back={nameBtn}
            onOpenChange={setMenuOpen}
          />
        )}
      </header>
      {open && (
        <div className="g2-rig-body">
          {!loose && rig.planned === null && (
            <div className="g2-rig-actions" data-testid="g2-rig-actions">
              <span className="quiet g2-no-plan">
                no planned lines: this collector does not send the rig spec&apos;s edges
              </span>
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
              {drawn.map((e) => {
                const g = geom.get(lineKey(e))!;
                return (
                  <g
                    key={lineKey(e)}
                    data-testid={e.planned ? 'g2-planned' : 'g2-edge'}
                    className="g2-line"
                    tabIndex={e.planned ? undefined : 0}
                    role={e.planned ? 'img' : 'button'}
                    aria-label={title(e)}
                    onPointerEnter={(ev) => hover(e, ev)}
                    onPointerMove={(ev) => hover(e, ev)}
                    onPointerLeave={() => p.onLineHover(null)}
                    onClick={() => !e.planned && p.onLinePin(e, title(e))}
                    onKeyDown={(ev) => {
                      if (!e.planned && (ev.key === 'Enter' || ev.key === ' ')) {
                        ev.preventDefault();
                        p.onLinePin(e, title(e));
                      }
                    }}
                  >
                    <path
                      d={g.d}
                      className={`rigmap-edge ${e.planned ? 'planned' : e.open ? 'open' : e.stale ? 'stale' : ''}`}
                      strokeWidth={e.planned ? undefined : 1.2 + (e.count / max) * 4}
                      markerEnd={`url(#g2a-${rig.key})`}
                    />
                    <path d={g.d} className="hit" />
                  </g>
                );
              })}
              {drawn.map((e) => {
                const g = geom.get(lineKey(e))!;
                const w = e.planned ? plannedLabelW(e) : 22;
                return (
                  <g
                    key={`l:${lineKey(e)}`}
                    className={`rigmap-label${e.planned ? ' planned' : ''}`}
                    aria-hidden="true"
                  >
                    <rect
                      x={g.lx - w / 2}
                      y={g.ly - 9}
                      width={w}
                      height={18}
                      rx={e.planned ? 9 : 4}
                    />
                    <text x={g.lx} y={g.ly} className="rigmap-count">
                      {e.planned ? plannedWord(e.planned) : e.count}
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
                        dim={!sparing && !seatMatches(s, p.filter)}
                        highlight={p.focusKey === s.key}
                        onOpen={p.onOpen}
                        onHover={p.onHover}
                        onLeave={p.onLeave}
                        onTab={p.onTab}
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

export default memo(RigFrame);

/**
 * UX 3: the rig's Start / Restore / Launch behind one "⋯" button in the header. They are mocks, so
 * the mark stays visible beside the button whether the menu is open or not.
 */
function RigMenu({
  rig,
  running,
  trigger,
  back,
  onOpenChange,
}: {
  rig: GraphRig;
  running: boolean;
  trigger: React.RefObject<HTMLButtonElement | null>;
  back: React.RefObject<HTMLButtonElement | null>;
  /** The frame raises itself above its neighbours while its menu is open. */
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  useEffect(() => onOpenChange(open), [open, onOpenChange]);
  // Closing during the click would unmount the button before React's bubble pass reaches it (the
  // real-browser bug: the dialog never opened), so a button closes the menu after raising its ask.
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open, trigger]);
  return (
    <span className="g2-menu-wrap" ref={wrap}>
      <button
        type="button"
        ref={trigger}
        className="pill-btn g2-menu-btn"
        data-testid="g2-rig-menu"
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            back.current?.focus();
          }
        }}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`Actions for ${rig.name} (mock)`}
        title="Start, Restore, Launch (mocks: they change nothing)"
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      <MockMark />
      {open && (
        <div
          className="g2-menu"
          role="group"
          aria-label={`${rig.name} actions (mock)`}
          data-testid="g2-rig-menu-items"
        >
          <FakeButton
            testId="g2-fake-start"
            onAsk={close}
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
            onAsk={close}
            ask={{
              label: 'Restore',
              question: `Restore ${rig.name} from its last snapshot on the ${rig.machineLabel}?`,
              result: `${rig.name} restored (pretend)`,
            }}
          />
          <FakeButton
            testId="g2-fake-launch"
            onAsk={close}
            ask={{
              label: 'Launch',
              question: `Launch a fresh ${rig.name} from its spec on the ${rig.machineLabel}?`,
              result: `${rig.name} launched (pretend)`,
            }}
          />
        </div>
      )}
    </span>
  );
}

/** Measures the open frame's cards and routes its lines (RigMap's router, read-only reuse). */
function useInRigLines(edges: MapEdge[], zoom: number, open: boolean) {
  const box = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<Map<string, Geom>>(new Map());
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [roomKey, setRoomKey] = useState('0,0');
  // the geometry depends on which lines exist and where the cards are, not on what the lines say
  const sig = edges.map((e) => `${lineKey(e)}`).join('|');
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !open) return;
    const measure = () => {
      const base = el.getBoundingClientRect();
      const z = zoom || 1;
      const boxOf = (n: Element): Rect => {
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
      const cards = [...el.querySelectorAll('[data-node-key]')].map(boxOf);
      const next = `${roomTop.get('rig') ?? 0},${roomBottom.get('rig') ?? 0}`;
      setRoomKey((r) => (r === next ? r : next));
      setGeom(
        new Map(
          avoidCards(spreadLabels(out), cards).map((pl) => [
            lineKey(pl.edge),
            { d: pl.d, lx: pl.lx, ly: pl.ly },
          ])
        )
      );
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
  return { box, geom: open ? geom : new Map<string, Geom>(), size, room: { top, bottom } };
}
