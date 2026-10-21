import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FleetMachine, QueueItem, RigWaitingOutput } from '@appydave/shared';
import { ago, PIP } from '../../domain/fleet/model.js';
import { callVerb } from '../../domain/fleet/coreCall.js';
import type { FleetSocket } from '../../domain/fleet/useFleet.js';
import { RIG_STATE, type MapSeat, type RigMap } from '../../domain/fleet/views.js';
import { CopyAttach, harnessOf, pctText, tokensText } from '../../kit/SeatCardLines.js';
import { attachLine } from '../../kit/WaitingOnDavid.js';
import {
  LeftOpenBadgeSvg,
  WaitingBadgeSvg,
  labelClass,
  lineClass,
  lineFocusState,
  lineWidth,
  pairLabel,
  useLineFocus,
} from '../../kit/index.js';
import { mapPairs, type MapPair } from '../../domain/rig-map/lines.js';
import type { GraphRig } from '../../domain/graph/model.js';
import { TerminalCard, WallCard, tailLine } from '../../kit/index.js';
import { cardBody } from '../../domain/wall/model.js';
import { findTile } from '../../domain/fleet/seats.js';

interface Props {
  map: RigMap;
  /** The box's own numbers, so the open rig has ONE header line (not the box meta and a status). */
  rig: GraphRig;
  socket: FleetSocket;
  /** Every machine, for each agent's terminal tail. */
  machines: FleetMachine[];
  /** The newest handoff of the rig, in words (the box's own sentence). */
  lastWords: string;
  onOpenAgent: (key: string) => void;
  onDetails: () => void;
  /** Open the documents drawer for an agent (by seat key). */
  onDocs?: (seatKey: string) => void;
  /** A line was clicked: show its handoffs in the page's drawer. */
  onPin: (title: string, items: QueueItem[]) => void;
  /**
   * The Rig Map's roomy look: Wall cards (the V1 body), bigger pods, and heavier, clearly labelled
   * handoff lines. `fresh` words a machine's freshness for a card's footer. The Graph leaves it off
   * and keeps the compact cards.
   */
  roomy?: { fresh: (m: FleetMachine) => string };
}

/** A person, not an agent: `human@kernel`, `operator-human`. */
export const isHuman = (s: Pick<MapSeat, 'name' | 'address'>): boolean =>
  /(^|[-_.])human($|@)/i.test(s.name) || /(^|[-_.])human@/i.test(s.address);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Arc {
  /** Runs along the gap above its rows and down the left channel, never over a card. */
  elbow?: boolean;
  pair: MapPair;
  d: string;
  lx: number;
  ly: number;
}

const LEVEL_STEP = 12;
const LIFT_BASE = 14;
/** The roomy (Rig Map) scale: lines are drawn heavier and labels bigger, with more room for the arcs. */
const ROOMY = {
  step: 30,
  base: 54,
  stroke: 1.9,
  label: 8.4,
  labelH: 24,
  chan: 8,
  lx: 84,
  rowStep: 30,
  cut: 13,
};

/**
 * An open rig, in place: pods as light dashed outlines with a count, agents as fixed-size compact
 * cards, ONE quiet line per agent pair (the kit), self-handoffs as text, and the people as dark
 * human cards with what is waiting on them as badges (no rails). Pure view of the original rig-map
 * model; nothing here is sent anywhere.
 */
export default function RigInside({
  map,
  rig,

  socket,
  machines,
  lastWords,
  onOpenAgent,
  onDetails,
  onDocs,
  onPin,
  roomy,
}: Props) {
  const big = Boolean(roomy);
  const LS = roomy ? ROOMY.step : LEVEL_STEP;
  const LB = roomy ? ROOMY.base : LIFT_BASE;
  const own = map.lanes[0]!;
  const home = map.rig.machineId;
  const box = useRef<HTMLDivElement>(null);
  const lf = useLineFocus();
  const [arcs, setArcs] = useState<Arc[]>([]);
  const [lift, setLift] = useState(LB + 14);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ key: string; x: number; y: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** After a click that opened something, the card under the pointer does not pop up its own card for a moment. */
  const quietUntil = useRef(0);
  const quiet = () => {
    quietUntil.current = Date.now() + 700;
    setHover(null);
  };

  const ownSeats = useMemo(() => own.pods.flatMap((p) => p.seats), [own]);
  const ownKeys = useMemo(() => new Set(ownSeats.map((s) => s.key)), [ownSeats]);
  // The people: seats named human in the rig, and human endpoints from outside it (not placed).
  const outsideHumans = useMemo(
    () =>
      map.lanes
        .slice(1)
        .flatMap((l) => l.pods.flatMap((p) => p.seats))
        .filter(isHuman),
    [map]
  );
  const humans = useMemo(
    () => [...ownSeats.filter(isHuman), ...outsideHumans],
    [ownSeats, outsideHumans]
  );
  const humanKeys = useMemo(() => new Set(humans.map((h) => h.key)), [humans]);
  const agentPods = useMemo(
    () =>
      own.pods
        .map((p) => ({ ...p, seats: p.seats.filter((s) => !humanKeys.has(s.key)) }))
        .filter((p) => p.seats.length > 0),
    [own, humanKeys]
  );
  const pairs = useMemo(
    () =>
      mapPairs(map).filter(
        (p) => ownKeys.has(p.a) && ownKeys.has(p.b) && !humanKeys.has(p.a) && !humanKeys.has(p.b)
      ),
    [map, ownKeys, humanKeys]
  );
  const selfOf = useMemo(
    () => new Map(map.edges.filter((e) => e.self).map((e) => [e.from, e.count])),
    [map]
  );
  const names = useMemo(
    () => new Map([...ownSeats, ...outsideHumans].map((s) => [s.key, s.name] as const)),
    [ownSeats, outsideHumans]
  );

  // What waits on the people: items to them (fresh and left open), and who sent the most.
  const humanInfo = (h: MapSeat) => {
    const from = map.edges
      .filter((e) => e.to === h.key && !e.self)
      .map((e) => ({
        name: names.get(e.from) ?? e.from.split('/').pop() ?? e.from,
        count: e.count,
      }))
      .sort((a, b) => b.count - a.count);

    return { from: from.slice(0, 2), total: from.reduce((n, f) => n + f.count, 0) };
  };

  const waitingOnYou = humans.reduce((n, h) => n + h.open, 0);

  useLayoutEffect(() => {
    const el = box.current;

    if (!el) {
      setArcs([]);

      return;
    }

    const measure = () => {
      const base = el.getBoundingClientRect();
      const rect = (key: string): Rect | null => {
        const n = el.querySelector<HTMLElement>(`[data-node-key="${CSS.escape(key)}"]`);

        if (!n) {
          return null;
        }

        const r = n.getBoundingClientRect();

        return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
      };

      const placedPairs = pairs
        .map((p) => ({ p, a: rect(p.a), b: rect(p.b) }))
        .filter((x): x is { p: MapPair; a: Rect; b: Rect } => !!x.a && !!x.b);
      // Same row: arcs over the cards, stacked by span (the shortest lowest, first free level).
      const sameRow = placedPairs
        .filter((x) => Math.abs(x.a.y - x.b.y) < 20)
        .sort((x, y) => Math.abs(x.a.x - x.b.x) - Math.abs(y.a.x - y.b.x));
      // Another row: out of the card's top, along the gap above its row, down a channel at the left
      // of every pod, along the gap above the other row and into the other card. Cards are never crossed.
      const otherRow = placedPairs.filter((x) => Math.abs(x.a.y - x.b.y) >= 20);
      const levels: [number, number][][] = [];
      const out: Arc[] = [];

      for (const { p, a, b } of sameRow) {
        const sx = a.x + a.w / 2;
        const ex = b.x + b.w / 2;
        const lo = Math.min(sx, ex) - 10;
        const hi = Math.max(sx, ex) + 10;
        let lv = levels.findIndex((iv) => iv.every(([l, h]) => hi < l || lo > h));

        if (lv === -1) {
          lv = levels.length;
          levels.push([]);
        }

        levels[lv]!.push([lo, hi]);

        const up = LB + lv * LS;
        // stop 3 px above the card, so a line never runs over its edge
        const sy = a.y - 3;
        const ey = b.y - 3;
        // a cubic with both handles lifted peaks at 3/4 of the lift
        const peak = (up * 4) / 3;

        out.push({
          pair: p,
          d: `M${sx},${sy} C${sx},${sy - peak} ${ex},${ey - peak} ${ex},${ey}`,
          lx: (sx + ex) / 2,
          ly: (sy + ey) / 2 - up * (big ? 1 : 0.75),
        });
      }

      otherRow.forEach(({ p, a, b }, i) => {
        const sx = a.x + a.w / 2;
        const ex = b.x + b.w / 2;
        const gap = 9;
        const chan = big ? ROOMY.chan + (i % 4) * 8 : 4 + (i % 4) * 4;
        const ay = a.y - gap;
        const by = b.y - gap;

        out.push({
          elbow: true,
          pair: p,
          d: `M${sx},${a.y - 3} L${sx},${ay} L${chan},${ay} L${chan},${by} L${ex},${by} L${ex},${b.y - 3}`,
          // labels sit in the left channel, stepped so two never share a spot
          lx: big ? ROOMY.lx : 34,
          ly: (ay + by) / 2 + (i - (otherRow.length - 1) / 2) * (big ? ROOMY.rowStep : 16),
        });
      });
      setArcs(out);
      setLift(LB + Math.max(1, levels.length) * LS + 8);
      setSize({ w: el.clientWidth, h: el.clientHeight });
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const ro = new ResizeObserver(measure);

    ro.observe(el);
    el.querySelectorAll('[data-node-key]').forEach((n) => ro.observe(n));

    return () => ro.disconnect();
  }, [pairs, agentPods, LS, LB, big]);

  // The attach line needs the machine's ssh target (rig.waiting); unknown means no button.
  const [ssh, setSsh] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;

    setSsh(undefined);
    void callVerb<RigWaitingOutput>(socket, 'rig.waiting', {
      machine: home,
      rig: map.rig.name,
    }).then((a) => live && a.ok && setSsh(a.value.ssh));

    return () => {
      live = false;
    };
  }, [socket, home, map.rig.name]);

  const keep = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
    }

    hideTimer.current = null;
  };

  const hide = () => {
    keep();
    hideTimer.current = setTimeout(() => setHover(null), 220);
  };

  useEffect(() => () => keep(), []);
  // a press anywhere outside the card, its menu and the hover card puts the hover card away
  useEffect(() => {
    if (!hover) {
      return;
    }

    const away = (e: PointerEvent) => {
      const t = e.target as Element | null;

      if (t?.closest('.g2-hover, .g2-cell')) {
        return;
      }

      keep();
      setHover(null);
    };

    document.addEventListener('pointerdown', away);

    return () => document.removeEventListener('pointerdown', away);
  }, [hover]);

  const showHover = (s: MapSeat, node: HTMLElement) => {
    keep();
    if (Date.now() < quietUntil.current) {
      return;
    }

    const base = box.current?.getBoundingClientRect();

    if (!base) {
      return;
    }

    const r = node.getBoundingClientRect();

    setHover({
      key: s.key,
      x: Math.max(0, Math.min(r.left - base.left, base.width - 290)),
      y: r.bottom - base.top + 6,
    });
  };

  const enter = (s: MapSeat, el: HTMLElement) => {
    lf.setFocus(s.key);
    showHover(s, el);
  };

  const leave = () => {
    lf.setFocus(null);
    hide();
  };

  const hoverSeat = hover ? [...ownSeats, ...outsideHumans].find((s) => s.key === hover.key) : null;
  const touches = (key: string) =>
    `${pairs.filter((p) => p.total > 0 && (p.a === key || p.b === key)).length} handed · ${pairs.filter((p) => p.planned && (p.a === key || p.b === key)).length} planned`;
  const st = RIG_STATE[map.rig.state];

  return (
    <section
      className="g2-inside"
      data-testid="g2-inside"
      data-rig-key={map.rig.key}
      data-roomy={roomy ? true : undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <p className="g2-status" data-testid="g2-status">
        <span className="rig-state" data-state={map.rig.state}>
          {st.glyph} {st.label}
        </span>
        <span className="g2-status-meta mono" data-testid="g2-status-meta">
          {rig.machineLabel} · {rig.agents} agent{rig.agents === 1 ? '' : 's'} · {rig.active} active
        </span>
        {rig.flags.needsMe > 0 && (
          <span
            className="g2-flag"
            data-flag="needsMe"
            title="Needs you: blocked, or asked you something"
          >
            ▲ {rig.flags.needsMe}
          </span>
        )}
        {rig.flags.stuck > 0 && (
          <span className="g2-flag" data-flag="stuck" title="Work left open over 2 h">
            ⌛ {rig.flags.stuck}
          </span>
        )}
        {rig.flags.failing > 0 && (
          <span className="g2-flag" data-flag="failing" title="Down while its rig runs">
            ✕ {rig.flags.failing}
          </span>
        )}
        {(rig.crossOut > 0 || rig.crossIn > 0) && (
          <span
            className="g2-box-cross mono"
            title="Handoffs with other rigs: sent ↗ and received ↙"
          >
            ↗{rig.crossOut} ↙{rig.crossIn}
          </span>
        )}
        <span className="g2-status-last" title={lastWords}>
          {lastWords}
        </span>
        {waitingOnYou > 0 && (
          <span className="g2-status-wait" data-testid="g2-status-wait">
            {waitingOnYou} waiting on you
          </span>
        )}
        <button type="button" className="pill-btn" data-testid="g2-details" onClick={onDetails}>
          Details
        </button>
      </p>
      <div className="g2-inside-body" ref={box}>
        {
          <svg
            className="g2-inside-lines"
            width={size.w}
            height={size.h}
            role="group"
            aria-label="Handoff lines inside the rig"
            data-testid="g2-inside-lines"
          >
            {arcs.map(({ pair: p, d }) => {
              const state = lineFocusState(lf.focus, p.a, p.b);
              const planned = p.planned;

              return (
                <g
                  key={`${p.a}|${p.b}`}
                  data-testid={planned ? 'g2-inside-planned' : 'g2-inside-line'}
                  data-edge={`${p.a}↔${p.b}`}
                  data-state={state}
                >
                  <path
                    d={d}
                    className={lineClass(state, planned)}
                    strokeWidth={
                      (planned ? lineWidth(0) : lineWidth(p.total)) * (roomy ? ROOMY.stroke : 1)
                    }
                  />
                </g>
              );
            })}
          </svg>
        }
        {
          <svg
            className="g2-inside-lines g2-inside-lines-labels"
            width={size.w}
            height={size.h}
            aria-hidden="true"
          >
            {arcs.map(({ pair: p, lx, ly, elbow }) => {
              const state = lineFocusState(lf.focus, p.a, p.b);
              const full = p.planned ? p.plannedWords || 'planned' : pairLabel(p);
              // a planned word in the left channel is cut to fit it (the full words are the tooltip)
              const text =
                elbow && full.length > (roomy ? ROOMY.cut : 7)
                  ? `${full.split(/[ ·]+/)[0]!.slice(0, roomy ? ROOMY.cut : 7)}…`
                  : full;
              const w = Math.max(26, text.length * (roomy ? ROOMY.label : 7) + 12);
              const lh = roomy ? ROOMY.labelH : 18;

              return (
                <g
                  key={`l:${p.a}|${p.b}`}
                  className={`g2-label ${labelClass(state)}`}
                  data-testid={p.planned ? 'g2-inside-planned-label' : 'g2-inside-label'}
                  data-edge={`${p.a}↔${p.b}`}
                  onPointerEnter={() => lf.setFocus(`line:${p.a}|${p.b}`)}
                  onPointerLeave={() => lf.setFocus(null)}
                  onClick={() =>
                    !p.planned &&
                    onPin(
                      `${names.get(p.a) ?? p.a} ⇄ ${names.get(p.b) ?? p.b} · ${p.total} handoffs`,
                      p.items
                    )
                  }
                >
                  {text !== full && <title>{full}</title>}
                  <rect x={lx - w / 2} y={ly - lh / 2} width={w} height={lh} rx={4} />
                  <text x={lx} y={ly} className="g2-label-text">
                    {text}
                  </text>
                  <WaitingBadgeSvg x={lx + w / 2 + 9} y={ly} n={p.waiting} />
                  <LeftOpenBadgeSvg
                    x={lx + w / 2 + (p.waiting > 0 ? 26 : 9)}
                    y={ly}
                    n={p.leftOpen}
                  />
                </g>
              );
            })}
          </svg>
        }
        <div className="g2-pods" style={{ paddingTop: lift }}>
          {agentPods.map((pod) => (
            <div className="g2-pod" key={pod.name} data-testid="g2-pod" data-pod={pod.name}>
              <span className="g2-pod-label" data-testid="g2-pod-label">
                {pod.name} <b>{pod.seats.length}</b>
              </span>
              <div className="g2-pod-cards">
                {pod.seats.map((s) => (
                  <span
                    className="g2-cell"
                    key={s.key}
                    onPointerEnter={(e) => enter(s, e.currentTarget)}
                    onFocus={(e) => enter(s, e.currentTarget)}
                    onPointerLeave={leave}
                    onBlur={leave}
                  >
                    {roomy ? (
                      <RoomyCard
                        s={s}
                        machines={machines}
                        fresh={roomy.fresh}
                        onOpen={() => {
                          quiet();
                          onOpenAgent(s.key);
                        }}
                        corner={
                          onDocs && <CardMenu name={s.name} onDocuments={() => onDocs(s.key)} />
                        }
                      />
                    ) : (
                      <TerminalCard
                        size="compact"
                        name={s.name}
                        status={s.pip}
                        runtime={s.runtime}
                        model={s.modelRaw}
                        modelLabel={s.model.text}
                        modelFamily={s.model.family}
                        contextPct={s.contextPct}
                        contextTokens={s.contextTokens}
                        tail={tailLine(findTile(machines, s.key)?.seat.tail?.lines)}
                        onOpen={() => {
                          quiet();
                          onOpenAgent(s.key);
                        }}
                        corner={
                          onDocs && <CardMenu name={s.name} onDocuments={() => onDocs(s.key)} />
                        }
                        testId="g2-agent-card"
                        dataAttrs={{ 'data-node-key': s.key }}
                        ariaLabel={`${s.name}, ${PIP[s.pip].label}: open the agent page`}
                      />
                    )}
                    {selfOf.get(s.key) ? (
                      <span className="g2-self" data-testid="g2-self">
                        ↺ {selfOf.get(s.key)} to itself
                      </span>
                    ) : null}
                  </span>
                ))}
              </div>
            </div>
          ))}
          {humans.length > 0 && (
            <div className="g2-pod g2-pod-human" data-testid="g2-humans">
              <span className="g2-pod-label">people</span>
              <div className="g2-pod-cards">
                {humans.map((h) => {
                  const info = humanInfo(h);

                  return <HumanCard key={h.key} seat={h} from={info.from} fromTotal={info.total} />;
                })}
              </div>
            </div>
          )}
        </div>
        {hover && hoverSeat && (
          <div
            className="seat-detail g2-hover"
            data-testid="seat-detail"
            style={{ left: hover.x, top: hover.y }}
            onPointerEnter={keep}
            onPointerLeave={hide}
            onFocus={keep}
            onBlur={hide}
          >
            <div className="seat-detail-head">
              <b>{hoverSeat.name}</b>
              {ssh !== undefined &&
                (ssh !== null || hoverSeat.key.startsWith(`${home}/`)) &&
                attachLine(hoverSeat.address, ssh) !== null && (
                  <CopyAttach session={hoverSeat.address} ssh={ssh} />
                )}
              {onDocs && (
                <button
                  type="button"
                  className="pill-btn"
                  data-testid="g2-hover-docs"
                  onClick={() => {
                    quiet();
                    onDocs(hoverSeat.key);
                  }}
                >
                  Documents
                </button>
              )}
            </div>
            <dl className="mono">
              <dt>activity</dt>
              <dd data-testid="detail-activity">
                {hoverSeat.activity ?? PIP[hoverSeat.pip].label}
              </dd>
              <dt>session</dt>
              <dd data-testid="detail-session">{hoverSeat.address}</dd>
              <dt>runtime</dt>
              <dd data-testid="detail-runtime">
                {harnessOf(hoverSeat.runtime, hoverSeat.modelRaw).label} ·{' '}
                {hoverSeat.modelRaw ?? '—'}
              </dd>
              <dt>spec / role</dt>
              <dd data-testid="detail-role">{hoverSeat.agentRole ?? '—'}</dd>
              <dt>edges</dt>
              <dd data-testid="detail-edges">{touches(hoverSeat.key)}</dd>
              <dt>tokens</dt>
              <dd data-testid="detail-tokens">
                {tokensText(hoverSeat.contextTokens)} · {pctText(hoverSeat.contextPct)}
              </dd>
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * A person, not an agent: a dark card with what waits on them as amber badges ("56 left open · 5d",
 * "48 from dev-qa"). Never a NOT PLACED rail.
 */
export function HumanCard({
  seat,
  from,
  fromTotal,
  compact = false,
}: {
  seat: MapSeat;
  from: { name: string; count: number }[];
  fromTotal: number;
  compact?: boolean;
}) {
  const age = seat.oldestStaleMs !== null ? ago(seat.oldestStaleMs) : null;

  return (
    <div
      className="g2-human"
      data-testid="g2-human-card"
      data-compact={compact || undefined}
      title={seat.address.replace(/^\?\//, '')}
    >
      <span className="g2-card-bar">
        <span className="g2-human-glyph" aria-hidden="true">
          ☺
        </span>
        <b className="g2-card-name">{seat.name}</b>
        <span className="g2-human-tag">person</span>
      </span>
      <span className="g2-card-addr mono">{seat.address.replace(/^\?\//, '')}</span>
      <span className="g2-human-badges">
        {seat.stale > 0 && (
          <span className="g2-badge" data-testid="g2-human-stale">
            {seat.stale} left open{age ? ` · ${age}` : ''}
          </span>
        )}
        {seat.open > 0 && (
          <span className="g2-badge" data-testid="g2-human-open">
            {seat.open} waiting
          </span>
        )}
        {from.map((f) => (
          <span className="g2-badge g2-badge-quiet" key={f.name} data-testid="g2-human-from">
            {f.count} from {f.name}
          </span>
        ))}
        {fromTotal === 0 && seat.stale === 0 && seat.open === 0 && (
          <span className="g2-badge g2-badge-quiet">nothing waiting</span>
        )}
      </span>
    </div>
  );
}

/**
 * The visible ⋯ on a compact card: a small menu with Documents (which opens the Agent panel on its
 * Documents tab). A click on the card itself opens the panel on its first tab.
 */
function CardMenu({ name, onDocuments }: { name: string; onDocuments: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') {
        return;
      }

      e.stopPropagation();
      setOpen(false);
    };

    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc, true);

    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc, true);
    };
  }, [open]);

  return (
    <span className="g2-card-menu" ref={wrap} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="g2-card-more"
        data-testid="g2-card-more"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More for ${name}`}
        title="More"
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <span className="g2-card-menu-pop" role="menu" data-testid="g2-card-menu">
          <button
            type="button"
            role="menuitem"
            className="g2-card-menu-item"
            data-testid="g2-card-documents"
            onClick={() => {
              setOpen(false);
              onDocuments();
            }}
          >
            Documents
          </button>
        </span>
      )}
    </span>
  );
}

/** A Rig Map card: the Wall's card (V1 body: last typed, folder and branch, footer) for one seat. */
function RoomyCard({
  s,
  machines,
  fresh,
  onOpen,
  corner,
}: {
  s: MapSeat;
  machines: FleetMachine[];
  fresh: (m: FleetMachine) => string;
  onOpen: () => void;
  corner: ReactNode;
}) {
  const tile = findTile(machines, s.key);
  const body = tile
    ? cardBody(tile.seat)
    : { lastTyped: null, folder: null, branch: null, fallback: [] };
  const stopped = s.pip === 'stopped';

  return (
    <WallCard
      name={s.name}
      status={s.pip}
      address={s.address}
      runtime={s.runtime}
      model={s.modelRaw}
      modelLabel={s.model.text}
      modelFamily={s.model.family}
      role={s.agentRole}
      where={tile?.machine.machine.label}
      skillCount={s.skills}
      lastTyped={body.lastTyped}
      fallbackLines={body.fallback}
      folder={body.folder}
      branch={body.branch}
      fresh={tile ? (stopped ? `stopped · ${fresh(tile.machine)}` : fresh(tile.machine)) : '\u2014'}
      contextPct={s.contextPct}
      contextTokens={s.contextTokens}
      queue={tile?.seat.work ?? { pending: 0, inProgress: 0, blocked: 0 }}
      onOpen={onOpen}
      corner={corner}
      testId="g2-agent-card"
      dataAttrs={{ 'data-node-key': s.key }}
      ariaLabel={`${s.name}, ${PIP[s.pip].label}: open the agent page`}
    />
  );
}
