import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { QueueItem } from '@appydave/shared';
import type { PageDef, PageProps } from '@client/app/types.js';
import {
  HandoffLegend,
  LeftOpenBadgeSvg,
  MockNote,
  PageHeader,
  WaitingBadgeSvg,
  arrowHeads,
  labelClass,
  lineClass,
  lineFocusId,
  lineWidth,
  pairLabel,
  useLineFocus,
} from '@client/kit/index.js';
import { buildRigMap } from '@client/domain/fleet/views.js';
import { useDocsDrawer } from '@client/kit/index.js';
import { FakeRunner } from './FakeRunner.js';
import { useOpenRigs } from './openRigs.js';
import RigBox, { lastWords } from './RigBox.js';
import RigInside from './RigInside.js';
import { routeLines, type Box, type Tip } from '@client/domain/graph/lineRoute.js';
import {
  allGroups,
  buildGraph,
  isLoose,
  FLAG_FILTERS,
  isStopped,
  rigMatches,
  type FlagFilter,
  type Graph,
  type GraphRig,
  type PairEdge,
} from '@client/domain/graph/model.js';
import './graph.css';

/** A stable function that always calls the latest one: lets memo(RigBox) skip boxes whose rig has not changed. */
function useStable<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const ref = useRef(fn);

  ref.current = fn;

  return useCallback((...a: A) => ref.current(...a), []);
}

/** How often the graph is rebuilt from the live fleet (the hub pushes about once a second). */
export const REBUILD_MS = 3000;

/**
 * The value, refreshed at most once per `ms`: the first value at once (leading edge), then the
 * latest one at the end of each window.
 */
function useThrottled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  const last = useRef(0);
  const latest = useRef(value);

  latest.current = value;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Object.is(value, out)) {
      return;
    }

    const wait = last.current + ms - Date.now();

    if (wait <= 0) {
      last.current = Date.now();
      setOut(value);

      return;
    }

    if (timer.current) {
      return;
    }

    timer.current = setTimeout(() => {
      timer.current = null;
      last.current = Date.now();
      setOut(latest.current);
    }, wait);
  }, [value, out, ms]);
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    []
  );

  return out;
}

/** "Show stopped" is remembered (the Wall hides stopped seats the same way by default). */
export const SHOW_STOPPED_KEY = 'appyrig.v2.graph.showStopped';

function readShowStopped(): boolean {
  try {
    return localStorage.getItem(SHOW_STOPPED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeShowStopped(on: boolean) {
  try {
    localStorage.setItem(SHOW_STOPPED_KEY, on ? '1' : '0');
  } catch {
    /* private window or blocked storage: it just is not remembered */
  }
}

interface Pinned {
  title: string;
  items: QueueItem[];
}
interface LineHover {
  title: string;
  lines: string[];
  x: number;
  y: number;
}
interface Geom {
  d: string;
  lx: number;
  ly: number;
  tipA: Tip;
  tipB: Tip;
}

const pairKey = (p: { a: string; b: string }) => `${p.a}↔${p.b}`;

/** The breakdown behind "+N not drawn": by what the unplaced name is, then the commonest names. */
export function unplacedText(u: Graph['unplaced']): string {
  const top = (kind: 'machine' | 'rig') =>
    u.names
      .filter((n) => n.kind === kind)
      .slice(0, 3)
      .map((n) => `${n.name} ${n.count}`)
      .join(', ');

  return [
    `${u.count} queue rows are not drawn.`,
    u.byKind.rig > 0 ? `${u.byKind.rig} name a rig no machine reports (${top('rig')}).` : null,
    u.byKind.machine > 0
      ? `${u.byKind.machine} name a machine that has no sessions outside rigs (${top('machine')}).`
      : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/** The widest a between-rigs count label is (px), for keeping it off the boxes. */
const LABEL_BOX_W = 48;
const LABEL_BOX_H = 20;

/**
 * Where a between-rigs label sits: its own spot if no rig box is under it; otherwise the nearest point
 * along ITS OWN line (searched outward from the middle) where it is clear of every box, so a count
 * never lands on a box's text. With no clear point the original spot stays.
 */
export function labelClearOf(
  d: string,
  lx: number,
  ly: number,
  boxes: Box[],
  host?: SVGSVGElement | null
): { x: number; y: number } {
  const hits = (x: number, y: number) =>
    boxes.some(
      (b) =>
        x - LABEL_BOX_W / 2 < b.x + b.w &&
        x + LABEL_BOX_W / 2 > b.x &&
        y - LABEL_BOX_H / 2 < b.y + b.h &&
        y + LABEL_BOX_H / 2 > b.y
    );

  if (!hits(lx, ly)) {
    return { x: lx, y: ly };
  }

  const NS = 'http://www.w3.org/2000/svg';
  const path = document.createElementNS(NS, 'path');

  path.setAttribute('d', d);
  // a path measures only while it is in the document: borrow the lines layer for a moment
  host?.appendChild(path);
  try {
    if (typeof path.getTotalLength !== 'function' || typeof path.getPointAtLength !== 'function') {
      return { x: lx, y: ly };
    }

    const len = path.getTotalLength();

    if (!(len > 0)) {
      return { x: lx, y: ly };
    }

    for (let i = 1; i <= 40; i++) {
      for (const t of [0.5 - i * 0.0125, 0.5 + i * 0.0125]) {
        if (t < 0.04 || t > 0.96) {
          continue;
        }

        const pt = path.getPointAtLength(len * t);

        if (!hits(pt.x, pt.y)) {
          return { x: pt.x, y: pt.y };
        }
      }
    }

    return { x: lx, y: ly };
  } finally {
    path.parentNode?.removeChild(path);
  }
}

/** An arrowhead at a line's end, faint, lit or dimmed with its line. */
function Head({ tip, state }: { tip: Tip; state: string }) {
  return (
    <path
      d="M0,0 L-8,-4 L-8,4 z"
      className="g2-head"
      data-state={state}
      transform={`translate(${tip.x} ${tip.y}) rotate(${tip.angle})`}
    />
  );
}

function GraphPage({ ctx, focusChosen = false }: PageProps & { focusChosen?: boolean }) {
  // The fleet arrives about once a second; the overview is rebuilt at most every REBUILD_MS.
  const bucket = Math.floor(ctx.now / 30_000);
  const machines = useThrottled(ctx.machines, REBUILD_MS);
  const graph = useMemo(() => buildGraph(machines, bucket * 30_000), [machines, bucket]);
  const groups = useMemo(() => allGroups(graph), [graph]);
  const picked = ctx.activeRig?.key ?? null;

  const [showStopped, setShowStoppedState] = useState(readShowStopped);
  const setShowStopped = (on: boolean) => {
    setShowStoppedState(on);
    writeShowStopped(on);
  };

  const [filter, setFilter] = useState<FlagFilter | null>(null);
  // which rigs are open persists across visits (the URL's `open=` once the nav lane provides it)
  const [expanded, setExpanded] = useOpenRigs(ctx);
  const [flash, setFlash] = useState<string | null>(null);
  // the rig box or line the pointer or keyboard is on: its lines light up, the rest dim (kit)
  const lineFocus = useLineFocus();
  const [lineHover, setLineHover] = useState<LineHover | null>(null);
  const { openDocs, drawer: docsDrawer } = useDocsDrawer(ctx);
  const [pinned, setPinned] = useState<Pinned | null>(null);

  // Stopped rigs are hidden unless asked for (or picked); a line to one is counted, not lost.
  const hiddenStopped = (r: GraphRig) => isStopped(r) && !showStopped && r.key !== picked;
  const shown = (r: GraphRig) => !hiddenStopped(r) && rigMatches(r, filter);
  const columns = graph.machines.map((m) => ({
    machine: m,
    groups: [...m.rigs, ...(m.loose ? [m.loose] : [])].filter(shown),
  }));
  const visible = new Set(columns.flatMap((c) => c.groups.map((g) => g.key)));
  const pairs = graph.pairs.filter((p) => visible.has(p.a) && visible.has(p.b));
  const stoppedHidden = new Set(groups.filter(hiddenStopped).map((g) => g.key));
  const toHidden = graph.pairs.filter(
    (p) =>
      !(visible.has(p.a) && visible.has(p.b)) &&
      (stoppedHidden.has(p.a) || stoppedHidden.has(p.b)) &&
      (visible.has(p.a) || stoppedHidden.has(p.a)) &&
      (visible.has(p.b) || stoppedHidden.has(p.b))
  );
  const stoppedCount = groups.filter((g) => isStopped(g)).length;

  const names = useMemo(() => {
    const m = new Map<string, string>();

    for (const g of groups) {
      m.set(g.key, g.ref ? `${g.name} (${g.machineLabel})` : `no rig (${g.machineLabel})`);
    }

    return m;
  }, [groups]);
  const nameOf = (k: string) => names.get(k) ?? k;

  // ---- lines: geometry only (measured); what a line says is read from `pairs` at render.
  const canvas = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<Map<string, Geom>>(new Map());
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sig = `${pairs.map(pairKey).join('|')}~${[...visible].join(',')}~${columns.length}`;

  useLayoutEffect(() => {
    const el = canvas.current;

    if (!el) {
      return;
    }

    const measure = () => {
      const base = el.getBoundingClientRect();
      const box = (key: string): Box | null => {
        const f = el.querySelector<HTMLElement>(`[data-graph-rig="${CSS.escape(key)}"]`);

        if (!f) {
          return null;
        }

        const r = f.getBoundingClientRect();

        return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
      };

      const rigBoxes = [...el.querySelectorAll<HTMLElement>('[data-graph-rig]')].map((f) => {
        const r = f.getBoundingClientRect();

        return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
      });

      setGeom(
        new Map(
          routeLines(pairs, box).map((l) => {
            const at = labelClearOf(
              l.d,
              l.lx,
              l.ly,
              rigBoxes,
              el.querySelector<SVGSVGElement>('svg.g2-lines')
            );

            return [pairKey(l.pair), { d: l.d, lx: at.x, ly: at.y, tipA: l.tipA, tipB: l.tipB }];
          })
        )
      );
      setSize({ w: el.clientWidth, h: el.clientHeight });
    };

    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const ro = new ResizeObserver(measure);

    ro.observe(el);
    el.querySelectorAll('[data-graph-rig]').forEach((n) => ro.observe(n));

    return () => ro.disconnect();
    // the signature stands for `pairs` and the layout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // the box at either end of the lit line (or the lit box itself) wears an ink outline
  const traceOf = (rigKey: string): string | undefined => {
    const f = lineFocus.focus;

    if (f === null) {
      return undefined;
    }

    if (f.startsWith('line:')) {
      return pairs.some((x) => lineFocusId(x.a, x.b) === f && (x.a === rigKey || x.b === rigKey))
        ? 'var(--ar-ink)'
        : undefined;
    }

    return f === rigKey ? 'var(--ar-ink)' : undefined;
  };

  const drawn = pairs.flatMap((p) => {
    const g = geom.get(pairKey(p));

    return g ? [{ p, g }] : [];
  });

  const pairTitle = (p: PairEdge) =>
    `${nameOf(p.a)} ⇄ ${nameOf(p.b)} · ${p.total} handoff${p.total === 1 ? '' : 's'} between rigs`;
  const lineHoverCard = (p: PairEdge, ev: { clientX: number; clientY: number }) => {
    const last = p.items[p.items.length - 1];

    setLineHover({
      title: pairTitle(p),
      lines: [
        `${p.aToB} ${nameOf(p.a)} → ${nameOf(p.b)} · ${p.bToA} ${nameOf(p.b)} → ${nameOf(p.a)}`,
        ...(p.waiting ? [`${p.waiting} still waiting`] : []),
        ...(p.leftOpen ? [`${p.leftOpen} left open over 2 h`] : []),
        ...(last ? [`latest: ${last.summary ?? last.id}`] : []),
        'Click for the handoffs.',
      ],
      x: ev.clientX + 14,
      y: ev.clientY + 14,
    });
  };

  const pinPair = (p: PairEdge) => {
    setLineHover(null);
    setPinned({ title: pairTitle(p), items: p.items });
  };

  useEffect(() => {
    if (!pinned) {
      return;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) {
        return;
      }

      e.preventDefault();
      setPinned(null);
    };

    window.addEventListener('keydown', onKey, true);

    return () => window.removeEventListener('keydown', onKey, true);
  }, [pinned]);

  // A rig box opens in place (several can be open at once) and becomes the shared rig choice.
  const chooseRig = ctx.chooseRig;
  const toggleBox = useStable((k: string, was: boolean) => {
    setExpanded((o) => ({ ...o, [k]: !was }));
    if (!was && !isLoose(k)) {
      chooseRig(k);
    }
  });
  const trace = useStable((k: string | null) => lineFocus.setFocus(k));
  const expandAll = (on: boolean) =>
    setExpanded(Object.fromEntries(groups.filter(shown).map((g) => [g.key, on])));
  // A rig pick (the drawer, the Rigs list, a repeat pick) opens that rig here and scrolls to it. A cold
  // open pre-opens nothing; the `map` alias opens the chosen rig at once.
  const nonce = ctx.focusNonce;
  const seen = useRef<{ rig: string | null; nonce: number } | null>(null);

  useEffect(() => {
    if (!picked) {
      return;
    }

    const before = seen.current;

    seen.current = { rig: picked, nonce };
    if (!before && !focusChosen && nonce === 0) {
      return;
    }

    if (before && before.rig === picked && before.nonce === nonce) {
      return;
    }

    setExpanded((o) => ({ ...o, [picked]: true }));
    setFlash(picked);

    const t = window.setTimeout(() => setFlash((f) => (f === picked ? null : f)), 2500);

    // after the box has grown, bring it into view (centred; never past the page)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-graph-rig="${CSS.escape(picked)}"]`)
          ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      })
    );

    return () => window.clearTimeout(t);
    // setExpanded is stable enough: the pick and the nonce are what trigger this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, nonce, focusChosen]);

  // A card click opens the Agent panel on top of this page (never another page). ⋯ → Documents opens the
  // same panel on its Documents tab.
  const openAgent = (key: string) =>
    ctx.openAgentPanel({ machineId: key.slice(0, key.indexOf('/')), seatKey: key });
  const openSeatDocs = (key: string) =>
    ctx.openAgentPanel({
      machineId: key.slice(0, key.indexOf('/')),
      seatKey: key,
      tab: 'documents',
    });
  const openInMap = useStable((k: string) => {
    ctx.chooseRig(k);
    ctx.goTo('map');
  });
  const minute = Math.floor(ctx.now / 60_000) * 60_000;
  const openKeys = groups
    .filter((g) => expanded[g.key] && g.ref && shown(g))
    .map((g) => g.key)
    .join('|');
  const insideMaps = useMemo(
    () =>
      new Map(
        openKeys
          .split('|')
          .filter(Boolean)
          .map((k) => [k, buildRigMap(ctx.allMachines, k, minute)] as const)
      ),
    [openKeys, ctx.allMachines, minute]
  );
  const counts = Object.fromEntries(
    FLAG_FILTERS.map((f) => [f.key, groups.filter((g) => rigMatches(g, f.key)).length])
  ) as Record<FlagFilter, number>;
  const linesTotal = pairs.reduce((n, p) => n + p.total, 0);
  const unplacedHint = unplacedText(graph.unplaced);

  return (
    <main className="view g2-graph" data-testid="ar-graph" aria-label="Graph: every rig as one box">
      <div className="g2-sticky" data-testid="g2-sticky">
        <div className="g2-toolbar">
          <span className="g2-tool-group">
            <button
              type="button"
              className="pill-btn"
              data-testid="g2-expand-all"
              onClick={() => expandAll(true)}
            >
              Expand all
            </button>
            <button
              type="button"
              className="pill-btn"
              data-testid="g2-collapse-all"
              onClick={() => expandAll(false)}
            >
              Collapse all
            </button>
          </span>
          <span className="g2-tool-group">
            <button
              type="button"
              className="pill-btn"
              data-testid="g2-show-stopped"
              aria-pressed={showStopped}
              title="Stopped rigs are hidden by default, as on the Wall"
              onClick={() => setShowStopped(!showStopped)}
            >
              Show stopped ({stoppedCount})
            </button>
          </span>
          <span className="g2-tool-group" role="group" aria-label="Filter by state">
            {FLAG_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className="pill-btn g2-filter"
                data-flag={f.key}
                data-testid={`g2-filter-${f.key}`}
                aria-pressed={filter === f.key}
                title={f.hint}
                onClick={() => setFilter((x) => (x === f.key ? null : f.key))}
              >
                {f.glyph} {f.label} <span className="mono">{counts[f.key]}</span>
              </button>
            ))}
          </span>
        </div>
        <PageHeader
          title="Graph"
          facts={[
            <span key="c" data-testid="g2-caption">
              <b>{graph.totals.rigs} rigs</b> · {graph.totals.agents} agents · {graph.totals.active}{' '}
              active · {graph.machines.length} machines ·{' '}
              <b>
                {pairs.length} line{pairs.length === 1 ? '' : 's'} between rigs
              </b>{' '}
              ({linesTotal} handoffs)
              {toHidden.length > 0 && (
                <span data-testid="g2-hidden-lines">
                  {' '}
                  · {toHidden.length} to hidden stopped rig{toHidden.length === 1 ? '' : 's'}
                </span>
              )}
              {graph.unplaced.count > 0 && (
                <span
                  className="g2-unplaced"
                  data-testid="g2-unplaced"
                  tabIndex={0}
                  title={unplacedHint}
                  aria-label={unplacedHint}
                >
                  {' '}
                  · +{graph.unplaced.count} not drawn ⓘ
                </span>
              )}
            </span>,
            ...(pairs.length === 0
              ? [
                  <span key="n" data-testid="g2-no-lines">
                    No handoffs between the rigs shown
                    {toHidden.length > 0 ? ' (some go to hidden stopped rigs)' : ''}.
                  </span>,
                ]
              : []),
          ]}
          mocks={
            <span data-testid="g2-mock-note">
              <MockNote>Rig controls on this page are mocks — nothing is sent</MockNote>
            </span>
          }
        />
        <p className="g2-key" data-testid="g2-key">
          <span>
            <b>○</b> running
          </span>
          <span>
            <b>✕</b> stopped <i className="g2-key-frost">frosted</i>
          </span>
          <span>
            <b className="g2-key-attn">▲</b> needs you (orange edge)
          </span>
          <span>
            <b>◌</b> machine asleep (dotted edge)
          </span>
          <span>
            <b>⌛</b> work waiting over 2 h
          </span>
          <span>
            <i className="g2-key-norig">no rig</i> = plain tmux sessions
          </span>
        </p>
      </div>
      {pairs.length > 0 && (
        <div className="g2-legend" data-testid="g2-legend">
          <HandoffLegend compact />
        </div>
      )}
      <div className="g2-canvas" ref={canvas} data-testid="g2-canvas">
        <div className="g2-machines" style={{ ['--g2-n' as string]: Math.max(1, columns.length) }}>
          {columns.map(({ machine, groups: gs }) => (
            <section
              key={machine.id}
              className="g2-machine"
              data-machine-col={machine.id}
              data-liveness={machine.liveness}
              data-testid="g2-machine"
              aria-label={`${machine.label}: ${gs.length} rigs`}
            >
              <header className="g2-machine-head">
                <b>{machine.label}</b>
                <i>
                  {machine.liveness} · {machine.rigs.length} rig
                  {machine.rigs.length === 1 ? '' : 's'} ·{' '}
                  {[...machine.rigs, ...(machine.loose ? [machine.loose] : [])].reduce(
                    (n, r) => n + r.agents,
                    0
                  )}{' '}
                  agents
                </i>
              </header>
              {gs.length === 0 && (
                <p className="quiet g2-col-empty" data-testid="g2-col-empty">
                  {filter
                    ? 'Nothing here matches the filter.'
                    : 'No running rigs shown on this machine.'}
                </p>
              )}
              <div className="g2-boxes">
                {gs.map((g) => (
                  <RigBox
                    key={g.key}
                    rig={g}
                    now={ctx.now}
                    expanded={!!expanded[g.key]}
                    focused={flash === g.key}
                    trace={traceOf(g.key)}
                    onToggle={toggleBox}
                    onTrace={trace}
                    onOpenMap={openInMap}
                  >
                    {insideMaps.get(g.key) ? (
                      <RigInside
                        map={insideMaps.get(g.key)!}
                        rig={g}
                        socket={ctx.getSocket()}
                        machines={ctx.allMachines}
                        lastWords={lastWords(g, ctx.now)}
                        onOpenAgent={openAgent}
                        onDetails={() => openDocs({ machineId: g.machineId, rig: g.name })}
                        onDocs={openSeatDocs}
                        onPin={(title, items) => setPinned({ title, items })}
                      />
                    ) : null}
                  </RigBox>
                ))}
              </div>
            </section>
          ))}
        </div>
        <svg
          className="g2-lines"
          width={size.w}
          height={size.h}
          role="group"
          aria-label="Handoff lines between rigs"
          data-testid="g2-cross-lines"
        >
          {drawn.map(({ p, g }) => {
            const state = lineFocus.stateOf(p.a, p.b);
            const heads = arrowHeads(p);

            return (
              <g
                key={pairKey(p)}
                data-testid="g2-cross"
                data-from={p.a}
                data-to={p.b}
                data-count={p.total}
                data-state={state}
                className="g2-line"
                tabIndex={0}
                role="button"
                aria-label={`${pairTitle(p)}. Enter shows them.`}
                onPointerEnter={(ev) => {
                  lineHoverCard(p, ev);
                  lineFocus.setFocus(lineFocusId(p.a, p.b));
                }}
                onPointerMove={(ev) => lineHoverCard(p, ev)}
                onPointerLeave={() => {
                  setLineHover(null);
                  lineFocus.setFocus(null);
                }}
                onFocus={() => lineFocus.setFocus(lineFocusId(p.a, p.b))}
                onBlur={() => lineFocus.setFocus(null)}
                onClick={() => pinPair(p)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    pinPair(p);
                  }
                }}
              >
                <path d={g.d} className={lineClass(state)} strokeWidth={lineWidth(p.total)} />
                {heads.atB && <Head tip={g.tipB} state={state} />}
                {heads.atA && <Head tip={g.tipA} state={state} />}
                <path d={g.d} className="hit" />
              </g>
            );
          })}
        </svg>
        <svg className="g2-lines g2-lines-labels" width={size.w} height={size.h} aria-hidden="true">
          {drawn.map(({ p, g }) => {
            const state = lineFocus.stateOf(p.a, p.b);
            const text = pairLabel(p);
            const w = Math.max(28, text.length * 7 + 10);

            return (
              <g
                key={`l:${pairKey(p)}`}
                className={`g2-label ${labelClass(state)}`}
                data-testid="g2-cross-label"
                onPointerEnter={(ev) => {
                  lineHoverCard(p, ev);
                  lineFocus.setFocus(lineFocusId(p.a, p.b));
                }}
                onPointerLeave={() => {
                  setLineHover(null);
                  lineFocus.setFocus(null);
                }}
                onClick={() => pinPair(p)}
              >
                <rect x={g.lx - w / 2} y={g.ly - 9} width={w} height={18} rx={4} />
                <text x={g.lx} y={g.ly} className="g2-label-text">
                  {text}
                </text>
                <WaitingBadgeSvg x={g.lx + w / 2 + 9} y={g.ly} n={p.waiting} />
                <LeftOpenBadgeSvg
                  x={g.lx + w / 2 + (p.waiting > 0 ? 26 : 9)}
                  y={g.ly}
                  n={p.leftOpen}
                />
              </g>
            );
          })}
        </svg>
      </div>
      {lineHover && (
        <div
          className="hover-card"
          role="tooltip"
          data-testid="g2-line-card"
          style={{ left: lineHover.x, top: lineHover.y }}
        >
          <b>{lineHover.title}</b>
          {lineHover.lines.map((l, i) => (
            <span key={i} style={{ display: 'block' }}>
              {l}
            </span>
          ))}
        </div>
      )}
      {pinned && (
        <aside className="g2-drawer" data-testid="g2-drawer" aria-label={pinned.title}>
          <header>
            <b>{pinned.title}</b>
            <button type="button" className="pill-btn" onClick={() => setPinned(null)}>
              Close · Esc
            </button>
          </header>
          <ol className="g2-items">
            {[...pinned.items]
              .reverse()
              .slice(0, 40)
              .map((q) => (
                <li key={q.id} data-testid="g2-drawer-item" data-state={q.state}>
                  <span className="mono g2-item-when">
                    {new Date(q.createdAt).toLocaleString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>{' '}
                  <span className="mono">
                    {q.source} → {q.destination}
                  </span>{' '}
                  <span className="g2-item-state">{q.state}</span>
                  <span className="g2-item-summary">{q.summary ?? q.id}</span>
                </li>
              ))}
          </ol>
          {pinned.items.length > 40 && (
            <p className="quiet">… and {pinned.items.length - 40} older.</p>
          )}
        </aside>
      )}
      {docsDrawer}
    </main>
  );
}

export function GraphScreen(props: PageProps & { focusChosen?: boolean }) {
  return (
    <FakeRunner>
      <GraphPage {...props} />
    </FakeRunner>
  );
}

export const page: PageDef = {
  key: 'graph',
  label: 'Graph',
  group: 'fleet',
  component: GraphScreen,
  blurb:
    'Every rig as a box in machine columns; open several in place (a rig is a box, or open with its cards), handoff lines between rigs and inside them.',
};
