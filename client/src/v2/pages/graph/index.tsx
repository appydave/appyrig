import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { QueueItem, RigWaitingOutput } from '@appydave/shared';
import { callVerb } from '../../../fleet/coreCall.js';
import type { MapEdge } from '../../../fleet/views.js';
import type { V2PageDef, V2PageProps } from '../../types.js';
import { FakeRunner } from './FakeRunner.js';
import GraphTree from './GraphTree.js';
import RigFrame, { type LineHover } from './RigFrame.js';
import { SeatDetail } from './SeatCard.js';
import { routeCross, type CrossPlaced } from './crossRoute.js';
import {
  allGroups,
  buildGraph,
  FLAG_FILTERS,
  openByDefault,
  rigMatches,
  type CrossEdge,
  type FlagFilter,
  type GraphRig,
  type GraphSeat,
} from './model.js';
import './graph.css';

/** Machine column width and the gap between columns (cross-rig lines run in the gaps). */
const COL_W = 480;
const COL_GAP = 110;
const PAD = 16;
/** Room right of the last column for its same-column arcs. */
const PAD_RIGHT = 90;
const DETAIL_W = 300;
const DETAIL_H = 260;

/** Scrolls the canvas (only the canvas, never the page) to an element: centred, or just into view. */
function scrollWithin(sc: HTMLElement | null, el: HTMLElement, center: boolean) {
  if (!sc?.scrollTo) return;
  const r = el.getBoundingClientRect();
  const s = sc.getBoundingClientRect();
  const dy = center ? (s.height - Math.min(r.height, s.height)) / 2 : 16;
  const dx = center ? (s.width - Math.min(r.width, s.width)) / 2 : 16;
  sc.scrollTo({
    top: sc.scrollTop + r.top - s.top - dy,
    left: sc.scrollLeft + r.left - s.left - dx,
    behavior: center ? 'smooth' : 'auto',
  });
}

interface Pinned {
  title: string;
  items: QueueItem[];
}

function GraphPage({ ctx }: V2PageProps) {
  // The graph is heavy (every rig's map); `now` only moves stale counts, so it re-reads every 30 s.
  const bucket = Math.floor(ctx.now / 30_000);
  const graph = useMemo(() => buildGraph(ctx.machines, bucket * 30_000), [ctx.machines, bucket]);
  const groups = useMemo(() => allGroups(graph), [graph]);
  const picked = ctx.activeRig?.key ?? null;

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<FlagFilter | null>(null);
  const [teams, setTeams] = useState<string[] | null>(null);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<{ key: string; n: number } | null>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [fitZoom, setFitZoom] = useState(1);
  const [lineHover, setLineHover] = useState<LineHover | null>(null);
  const [pinned, setPinned] = useState<Pinned | null>(null);

  const isOpen = useCallback(
    (r: GraphRig) => overrides[r.key] ?? openByDefault(r, picked),
    [overrides, picked]
  );
  const shown = (r: GraphRig) => (!teams || teams.includes(r.key)) && rigMatches(r, filter);
  const columns = graph.machines.map((m) => ({
    machine: m,
    groups: [...m.rigs, ...(m.loose ? [m.loose] : [])].filter(shown),
  }));
  const visible = new Set(columns.flatMap((c) => c.groups.map((g) => g.key)));
  const cross = graph.cross.filter((e) => visible.has(e.from) && visible.has(e.to));

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      m.set(g.key, g.ref ? `${g.name} (${g.machineLabel})` : `no rig (${g.machineLabel})`);
      for (const p of g.pods) for (const s of p.seats) m.set(s.key, s.name);
    }
    return m;
  }, [groups]);
  const nameOf = useCallback((k: string) => names.get(k) ?? k, [names]);
  const seatIndex = useMemo(() => {
    const m = new Map<string, { seat: GraphSeat; rig: GraphRig }>();
    for (const g of groups)
      for (const p of g.pods) for (const s of p.seats) m.set(s.key, { seat: s, rig: g });
    return m;
  }, [groups]);

  // ---- zoom: "fit" scales the columns to the window, never above 100 %.
  const scroller = useRef<HTMLDivElement>(null);
  const natural = columns.length * COL_W + (columns.length - 1) * COL_GAP + PAD * 2 + PAD_RIGHT;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth;
      if (w > 0) setFitZoom(Math.max(0.5, Math.min(1, Math.floor((w / natural) * 100) / 100)));
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [natural]);
  const z = zoom === 'fit' ? fitZoom : zoom;

  // ---- cross-rig lines, from the frames' measured positions (layout px, unaffected by zoom).
  const canvas = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<CrossPlaced[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const crossSig = cross.map((e) => `${e.from}>${e.to}:${e.count}`).join('|');
  const layoutSig = `${[...visible].join(',')}|${groups.map((g) => (isOpen(g) ? 1 : 0)).join('')}|${z}`;
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const measure = () => {
      const box = (key: string) => {
        const f = el.querySelector<HTMLElement>(`[data-graph-rig="${CSS.escape(key)}"]`);
        const head = f?.querySelector<HTMLElement>('.g2-rig-head');
        if (!f || !head) return null;
        return {
          x: f.offsetLeft,
          y: f.offsetTop,
          w: f.offsetWidth,
          h: head.offsetHeight,
          col: Number(f.closest<HTMLElement>('[data-col]')?.dataset.col ?? 0),
        };
      };
      setPlaced(routeCross(cross, box, COL_GAP));
      setSize({ w: el.scrollWidth, h: el.scrollHeight });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll('[data-graph-rig]').forEach((n) => ro.observe(n));
    return () => ro.disconnect();
    // the signatures stand for `cross` and the layout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossSig, layoutSig]);
  const maxCross = Math.max(1, ...cross.map((e) => e.count));

  // ---- tree selection: open the rig, scroll to the item, highlight it.
  const select = (key: string, rigKey: string | null) => {
    setFocusKey(key);
    if (rigKey) {
      const g = groups.find((x) => x.key === rigKey);
      if (g && !isOpen(g)) setOverrides((o) => ({ ...o, [rigKey]: true }));
      if (g?.ref) ctx.chooseRig(rigKey);
      if (key !== rigKey && z < 0.9) setZoom(1);
    }
    setScrollTo((s) => ({ key, n: (s?.n ?? 0) + 1 }));
  };
  useEffect(() => {
    if (!scrollTo) return;
    const el = canvas.current;
    const k = CSS.escape(scrollTo.key);
    const target = scrollTo.key.startsWith('machine:')
      ? el?.querySelector(`[data-machine-col="${CSS.escape(scrollTo.key.slice(8))}"]`)
      : (el?.querySelector(`[data-node-key="${k}"]`) ??
        el?.querySelector(`[data-pod-id="${k}"]`) ??
        el?.querySelector(`[data-graph-rig="${k}"]`));
    if (target) scrollWithin(scroller.current, target as HTMLElement, true);
  }, [scrollTo]);
  // A flip lands on the picked rig.
  useEffect(() => {
    if (!picked) return;
    const el = canvas.current?.querySelector(`[data-graph-rig="${CSS.escape(picked)}"]`);
    if (el) scrollWithin(scroller.current, el as HTMLElement, false);
    // once, on arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- hover detail card (C44) and each machine's ssh address for the attach line.
  const [detail, setDetail] = useState<{
    key: string;
    x: number;
    y: number;
    above: boolean;
  } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keep = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  const hide = () => {
    keep();
    hideTimer.current = setTimeout(() => setDetail(null), 220);
  };
  useEffect(() => () => keep(), []);
  const [sshOf, setSshOf] = useState<Record<string, string | null>>({});
  const asking = useRef(new Set<string>());
  const askSsh = (machineId: string) => {
    if (asking.current.has(machineId) || machineId in sshOf) return;
    const rig = graph.machines.find((m) => m.id === machineId)?.rigs[0]?.name;
    if (!rig) return;
    asking.current.add(machineId);
    void callVerb<RigWaitingOutput>(ctx.getSocket(), 'rig.waiting', {
      machine: machineId,
      rig,
    }).then((a) => {
      asking.current.delete(machineId);
      if (a.ok) setSshOf((o) => ({ ...o, [machineId]: a.value.ssh }));
    });
  };
  const onHover = (key: string, el: HTMLElement) => {
    keep();
    if (document.querySelector('[data-explain-on]')) return;
    const hit = seatIndex.get(key);
    if (!hit || key.startsWith('?/')) return;
    askSsh(hit.rig.machineId);
    const r = el.getBoundingClientRect();
    const above = r.bottom + 6 + DETAIL_H > window.innerHeight && r.top - 6 - DETAIL_H > 0;
    setDetail({
      key,
      x: Math.max(8, Math.min(r.left, window.innerWidth - DETAIL_W - 8)),
      y: above ? r.top - 6 : r.bottom + 6,
      above,
    });
  };
  useEffect(() => {
    if (!detail && !pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (detail) setDetail(null);
      else setPinned(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [detail, pinned]);
  const detailHit = detail ? seatIndex.get(detail.key) : undefined;
  const edgesOf = (key: string, rig: GraphRig) => {
    const touches = (e: MapEdge) => !e.self && (e.from === key || e.to === key);
    return `${rig.edges.filter(touches).length} handed · ${(rig.planned ?? []).filter(touches).length} planned`;
  };

  const crossTitle = (e: CrossEdge) =>
    `${nameOf(e.from)} → ${nameOf(e.to)} · ${e.count} handoff${e.count === 1 ? '' : 's'} between rigs`;
  const crossHover = (e: CrossEdge, ev: { clientX: number; clientY: number }) => {
    const last = e.items[e.items.length - 1];
    setLineHover({
      title: crossTitle(e),
      lines: [
        ...(e.open ? [`${e.open} still waiting`] : []),
        ...(e.stale ? [`${e.stale} left open over 2 h`] : []),
        ...(last ? [`latest: ${last.summary ?? last.id}`] : []),
        'Click for the handoffs.',
      ],
      x: ev.clientX + 14,
      y: ev.clientY + 14,
    });
  };
  const pinCross = (e: CrossEdge) => {
    setLineHover(null);
    setPinned({ title: crossTitle(e), items: e.items });
  };

  const expandAll = (on: boolean) =>
    setOverrides(Object.fromEntries(groups.map((g) => [g.key, on])));
  const counts = Object.fromEntries(
    FLAG_FILTERS.map((f) => [f.key, groups.filter((g) => rigMatches(g, f.key)).length])
  ) as Record<FlagFilter, number>;
  const crossTotal = graph.cross.reduce((n, e) => n + e.count, 0);

  return (
    <main
      className="view g2-graph"
      data-testid="v2-graph"
      aria-label="Graph: every rig on every machine"
    >
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
        <span className="g2-tool-group g2-teams-wrap">
          <button
            type="button"
            className="pill-btn"
            data-testid="g2-teams"
            aria-expanded={teamsOpen}
            aria-pressed={!!teams}
            onClick={() => setTeamsOpen((o) => !o)}
          >
            Teams · {teams ? `${teams.length} of ${groups.length}` : 'all'}
          </button>
          {teamsOpen && (
            <div
              className="g2-teams"
              role="group"
              aria-label="Show these teams"
              data-testid="g2-teams-panel"
            >
              <p className="g2-teams-row">
                <button
                  type="button"
                  className="pill-btn"
                  data-testid="g2-teams-all"
                  onClick={() => setTeams(null)}
                >
                  All
                </button>
                <button
                  type="button"
                  className="pill-btn"
                  data-testid="g2-teams-none"
                  onClick={() => setTeams([])}
                >
                  None
                </button>
                <button
                  type="button"
                  className="pill-btn"
                  data-testid="g2-teams-running"
                  onClick={() =>
                    setTeams(groups.filter((g) => g.ref?.status === 'running').map((g) => g.key))
                  }
                >
                  Running only
                </button>
              </p>
              {graph.machines.map((m) => (
                <fieldset key={m.id}>
                  <legend>{m.label}</legend>
                  {[...m.rigs, ...(m.loose ? [m.loose] : [])].map((g) => (
                    <label key={g.key} className="g2-team">
                      <input
                        type="checkbox"
                        data-testid="g2-team"
                        data-key={g.key}
                        checked={!teams || teams.includes(g.key)}
                        onChange={(e) => {
                          const base = teams ?? groups.map((x) => x.key);
                          setTeams(
                            e.target.checked ? [...base, g.key] : base.filter((k) => k !== g.key)
                          );
                        }}
                      />{' '}
                      <span className="mono">{g.name}</span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          )}
        </span>
        <span className="g2-tool-group" role="group" aria-label="Zoom">
          <button
            type="button"
            className="pill-btn"
            aria-label="Zoom out"
            onClick={() => setZoom(Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
          >
            −
          </button>
          <span className="mono g2-zoom" data-testid="g2-zoom">
            {Math.round(z * 100)}%
          </span>
          <button
            type="button"
            className="pill-btn"
            aria-label="Zoom in"
            onClick={() => setZoom(Math.min(1.2, Math.round((z + 0.1) * 10) / 10))}
          >
            +
          </button>
          <button
            type="button"
            className="pill-btn"
            aria-pressed={zoom === 'fit'}
            onClick={() => setZoom('fit')}
          >
            Fit
          </button>
        </span>
      </div>
      <p className="view-caption g2-caption" data-testid="g2-caption">
        <b>{graph.totals.rigs} rigs</b> · {graph.totals.agents} agents · {graph.totals.active}{' '}
        active · {graph.machines.length} machines · <b>{graph.cross.length} lines between rigs</b> (
        {crossTotal} handoffs) · line width = how often · amber = still waiting · dotted = planned
        in the rig spec
        {graph.unplaced.count > 0 && (
          <span data-testid="g2-unplaced">
            {' '}
            · {graph.unplaced.count} queue rows name rigs no machine reports (
            {graph.unplaced.names
              .slice(0, 3)
              .map((n) => `${n.name} ${n.count}`)
              .join(', ')}
            ), not drawn
          </span>
        )}
      </p>
      <div className="g2-body">
        <GraphTree machines={columns} selected={focusKey} onSelect={select} />
        <div className="g2-scroll" ref={scroller} data-testid="g2-scroll">
          <div
            className="g2-canvas"
            ref={canvas}
            style={{
              zoom: z,
              ['--g2-col' as string]: `${COL_W}px`,
              ['--g2-gap' as string]: `${COL_GAP}px`,
            }}
            data-testid="g2-canvas"
          >
            <svg
              className="g2-cross"
              width={size.w}
              height={size.h}
              role="group"
              aria-label="Handoff lines between rigs"
              data-testid="g2-cross-lines"
            >
              <defs>
                <marker
                  id="g2-cross-arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="10"
                  markerHeight="10"
                  markerUnits="userSpaceOnUse"
                  orient="auto"
                >
                  <path d="M0,0 L10,5 L0,10 z" className="g2-cross-head" />
                </marker>
              </defs>
              {placed.map((p) => (
                <g
                  key={`${p.edge.from}→${p.edge.to}`}
                  data-testid="g2-cross"
                  data-from={p.edge.from}
                  data-to={p.edge.to}
                  data-count={p.edge.count}
                  className="g2-cross-line"
                  tabIndex={0}
                  role="button"
                  aria-label={`${crossTitle(p.edge)}. Enter shows them.`}
                  onPointerEnter={(ev) => crossHover(p.edge, ev)}
                  onPointerMove={(ev) => crossHover(p.edge, ev)}
                  onPointerLeave={() => setLineHover(null)}
                  onClick={() => pinCross(p.edge)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      pinCross(p.edge);
                    }
                  }}
                >
                  <path
                    d={p.d}
                    className={`g2-cross-path ${p.edge.open ? 'open' : p.edge.stale ? 'stale' : ''}`}
                    strokeWidth={1.5 + (p.edge.count / maxCross) * 5}
                    markerEnd="url(#g2-cross-arrow)"
                  />
                  <path d={p.d} className="hit" />
                </g>
              ))}
            </svg>
            <div className="g2-cols" style={{ paddingRight: PAD_RIGHT }}>
              {columns.map(({ machine, groups: gs }, col) => (
                <section
                  key={machine.id}
                  className="g2-col"
                  data-col={col}
                  data-machine-col={machine.id}
                  data-liveness={machine.liveness}
                  data-testid="g2-machine"
                  data-highlight={focusKey === `machine:${machine.id}` || undefined}
                  aria-label={`${machine.label}: ${gs.length} rigs`}
                >
                  <header className="g2-col-head">
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
                        : 'No teams shown on this machine.'}
                    </p>
                  )}
                  {gs.map((g) => (
                    <RigFrame
                      key={g.key}
                      rig={g}
                      open={isOpen(g)}
                      picked={g.key === picked}
                      focusKey={focusKey}
                      filter={filter}
                      zoom={z}
                      onToggle={(k) => setOverrides((o) => ({ ...o, [k]: !isOpen(g) }))}
                      onPick={(k) => {
                        ctx.chooseRig(k);
                        setFocusKey(k);
                      }}
                      onOpen={ctx.onOpenAgent}
                      onHover={onHover}
                      onLeave={hide}
                      onLineHover={setLineHover}
                      onLinePin={(e, title) => {
                        setLineHover(null);
                        setPinned({ title, items: e.items });
                      }}
                      nameOf={nameOf}
                    />
                  ))}
                </section>
              ))}
            </div>
            <svg className="g2-cross-labels" width={size.w} height={size.h} aria-hidden="true">
              {placed.map((p) => (
                <g
                  key={`l:${p.edge.from}→${p.edge.to}`}
                  className="rigmap-label g2-cross-label"
                  data-testid="g2-cross-label"
                  onPointerEnter={(ev) => crossHover(p.edge, ev)}
                  onPointerLeave={() => setLineHover(null)}
                  onClick={() => pinCross(p.edge)}
                >
                  <rect x={p.lx - 13} y={p.ly - 9} width={26} height={18} rx={4} />
                  <text x={p.lx} y={p.ly} className="rigmap-count">
                    {p.edge.count}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>
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
      {detail && detailHit && (
        <SeatDetail
          seat={detailHit.seat}
          machineLabel={detailHit.rig.machineLabel}
          edges={edgesOf(detailHit.seat.key, detailHit.rig)}
          ssh={sshOf[detailHit.rig.machineId]}
          at={detail}
          onKeep={keep}
          onLeave={hide}
        />
      )}
    </main>
  );
}

function GraphV2(props: V2PageProps) {
  return (
    <FakeRunner>
      <GraphPage {...props} />
    </FakeRunner>
  );
}

export const page: V2PageDef = {
  key: 'map',
  label: 'Graph',
  group: 'fleet',
  component: GraphV2,
  blurb:
    'Every rig on every machine on one page, with the handoff lines between rigs; a tree down the left.',
};
