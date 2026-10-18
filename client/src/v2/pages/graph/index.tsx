import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { QueueItem, RigWaitingOutput } from '@appydave/shared';
import { callVerb } from '../../../fleet/coreCall.js';
import type { MapEdge } from '../../../fleet/views.js';
import type { V2PageDef, V2PageProps } from '../../types.js';
import { MockNote } from '../../kit/index.js';
import { FakeRunner } from './FakeRunner.js';
import LinesPanel from './LinesPanel.js';
import { LINE_COLORS, lineColorIndex } from './lineColors.js';
import GraphTree from './GraphTree.js';
import RigFrame, { type LineHover } from './RigFrame.js';
import { SeatDetail } from './SeatCard.js';
import { routeCross, type CrossPlaced } from './crossRoute.js';
import {
  allGroups,
  buildGraph,
  FLAG_FILTERS,
  isStopped,
  openByDefault,
  rigMatches,
  type CrossEdge,
  type FlagFilter,
  type Graph,
  type GraphRig,
  type GraphSeat,
} from './model.js';
import './graph.css';

/** Machine column width and the gap between columns (cross-rig lines run in the gaps). */
const COL_W = 440;
const COL_GAP = 104;
const PAD = 16;
/** Room right of the last column for its same-column arcs. */
const PAD_RIGHT = 90;
/** The smallest zoom "Fit" picks (UX ruling 1). */
export const FIT_MIN = 0.85;
const DETAIL_W = 300;
const DETAIL_H = 260;

/** Height of the sticky column heads at the top of the canvas (screen px), or 0. */
const headRoom = (sc: HTMLElement) =>
  sc.querySelector('.g2-col-head')?.getBoundingClientRect().height ?? 0;

/**
 * Scrolls the canvas (only the canvas, never the page) to an element: centred, or just into view.
 * The column heads are sticky at the top, so "top" means just below them and nothing scrolls
 * behind them.
 */
function scrollWithin(sc: HTMLElement | null, el: HTMLElement, center: boolean) {
  if (!sc?.scrollTo) return;
  const r = el.getBoundingClientRect();
  const s = sc.getBoundingClientRect();
  const head = headRoom(sc);
  const room = s.height - head;
  const dy = center ? head + (room - Math.min(r.height, room)) / 2 : head + 16;
  const dx = center ? (s.width - Math.min(r.width, s.width)) / 2 : 16;
  sc.scrollTo({
    top: sc.scrollTop + r.top - s.top - dy,
    left: sc.scrollLeft + r.left - s.left - dx,
    behavior: center ? 'smooth' : 'auto',
  });
}

/** True when the element is fully inside the canvas's visible area (below the sticky heads). */
function inView(sc: HTMLElement, el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const s = sc.getBoundingClientRect();
  return (
    r.top >= s.top + headRoom(sc) && r.bottom <= s.bottom && r.left >= s.left && r.right <= s.right
  );
}

/** Where a rig's header is relative to the canvas's visible area. */
type EndState = 'in view' | 'above' | 'below';
function endState(sc: HTMLElement, canvas: HTMLElement | null, rigKey: string): EndState {
  const el = canvas?.querySelector<HTMLElement>(
    `[data-graph-rig="${CSS.escape(rigKey)}"] .g2-rig-head`
  );
  if (!el) return 'in view';
  const r = el.getBoundingClientRect();
  const s = sc.getBoundingClientRect();
  if (r.bottom < s.top + headRoom(sc)) return 'above';
  if (r.top > s.bottom) return 'below';
  return 'in view';
}

/** A stable function that always calls the latest one: lets memo(RigFrame) skip frames whose rig has not changed. */
function useStable<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...a: A) => ref.current(...a), []);
}

/** How often the graph is rebuilt from the live fleet (the hub pushes about once a second). */
export const REBUILD_MS = 3000;

/**
 * The value, refreshed at most once per `ms`: the first value at once, then the latest one at the
 * end of each quiet-or-busy window. A rebuild of the whole graph costs real main-thread time.
 */
function useThrottled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  // 0: nothing has been applied yet, so the first change after mount is applied at once (leading
  // edge); only the ones after it wait out the window
  const last = useRef(0);
  const latest = useRef(value);
  latest.current = value;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (Object.is(value, out)) return;
    const wait = last.current + ms - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      setOut(value);
      return;
    }
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      last.current = Date.now();
      setOut(latest.current);
    }, wait);
  }, [value, out, ms]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );
  return out;
}

interface CrossGeom {
  d: string;
  lx: number;
  ly: number;
}
const crossKey = (e: { from: string; to: string }) => `${e.from}→${e.to}`;

/** value: a string (ssh address), null (none configured), undefined (not known: failed or no way to ask). */
interface SshState {
  value: string | null | undefined;
  note?: string;
}
const SSH_FAIL_TTL_MS = 30_000;
const SSH_NONE_TTL_MS = 120_000;

/** "Show stopped" is remembered (the Wall hides stopped seats the same way by default). */
const SHOW_STOPPED_KEY = 'appyrig.v2.graph.showStopped';
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
export { SHOW_STOPPED_KEY };

interface Pinned {
  title: string;
  items: QueueItem[];
}

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

function GraphPage({ ctx }: V2PageProps) {
  // The graph is heavy (every rig's map); `now` only moves stale counts, so it re-reads every 30 s.
  // The fleet arrives about once a second; the graph is rebuilt at most every REBUILD_MS (UX/perf).
  const bucket = Math.floor(ctx.now / 30_000);
  const machines = useThrottled(ctx.machines, REBUILD_MS);
  const graph = useMemo(() => buildGraph(machines, bucket * 30_000), [machines, bucket]);
  const groups = useMemo(() => allGroups(graph), [graph]);
  const picked = ctx.activeRig?.key ?? null;

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<FlagFilter | null>(null);
  const [teams, setTeams] = useState<string[] | null>(null);
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [showStopped, setShowStoppedState] = useState(readShowStopped);
  const setShowStopped = (on: boolean) => {
    setShowStoppedState(on);
    writeShowStopped(on);
  };
  // which line (`from→to`) or rig the pointer or focus is on: its lines light up, the rest dim
  const [hotLine, setHotLine] = useState<string | null>(null);
  const [hotRig, setHotRig] = useState<string | null>(null);
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
  // Stopped rigs are hidden unless asked for (or picked); a line to one is counted, not lost.
  const hiddenStopped = (r: GraphRig) => isStopped(r) && !showStopped && r.key !== picked;
  const shown = (r: GraphRig) =>
    (!teams || teams.includes(r.key)) && !hiddenStopped(r) && rigMatches(r, filter);
  const columns = graph.machines.map((m) => ({
    machine: m,
    groups: [...m.rigs, ...(m.loose ? [m.loose] : [])].filter(shown),
  }));
  const visible = new Set(columns.flatMap((c) => c.groups.map((g) => g.key)));
  const cross = graph.cross.filter((e) => visible.has(e.from) && visible.has(e.to));
  const stoppedHidden = new Set(groups.filter(hiddenStopped).map((g) => g.key));
  // lines whose other end is on screen but one end is a hidden stopped rig
  const toHidden = graph.cross.filter(
    (e) =>
      !(visible.has(e.from) && visible.has(e.to)) &&
      (stoppedHidden.has(e.from) || stoppedHidden.has(e.to)) &&
      (visible.has(e.from) || stoppedHidden.has(e.from)) &&
      (visible.has(e.to) || stoppedHidden.has(e.to))
  );
  const hiddenLines = {
    lines: toHidden.length,
    handoffs: toHidden.reduce((n, e) => n + e.count, 0),
  };
  const stoppedCount = groups.filter((g) => isStopped(g)).length;
  const colorIdx = lineColorIndex(cross.map((e) => crossKey(e)));
  const colorOf = (e: { from: string; to: string }) => colorIdx.get(crossKey(e)) ?? 0;

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      m.set(g.key, g.ref ? `${g.name} (${g.machineLabel})` : `no rig (${g.machineLabel})`);
      for (const p of g.pods) for (const s of p.seats) m.set(s.key, s.name);
    }
    return m;
  }, [groups]);
  const nameOf = useStable((k: string) => names.get(k) ?? k);
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
      // UX 1: Fit never goes below 85 %; a wider fleet scrolls sideways instead of shrinking the text
      if (w > 0) setFitZoom(Math.max(FIT_MIN, Math.min(1, Math.floor((w / natural) * 100) / 100)));
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
  // Geometry only, keyed by from→to. What a line says (open / stale / count) is read from `cross` at render.
  const [geom, setGeom] = useState<Map<string, CrossGeom>>(new Map());
  const [size, setSize] = useState({ w: 0, h: 0 });
  const crossSig = cross.map((e) => crossKey(e)).join('|');
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
      setGeom(
        new Map(
          routeCross(cross, box, COL_GAP).map((pl: CrossPlaced) => [
            crossKey(pl.edge),
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
    el.querySelectorAll('[data-graph-rig]').forEach((n) => ro.observe(n));
    return () => ro.disconnect();
    // the signatures stand for `cross` and the layout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossSig, layoutSig]);
  const maxCross = Math.max(1, ...cross.map((e) => e.count));
  // where each end of the lit line is, so a line too tall for the screen still says both ends
  const [ends, setEnds] = useState<{ from: EndState; to: EndState } | null>(null);
  useEffect(() => {
    const sc = scroller.current;
    const e = hotLine === null ? undefined : cross.find((x) => crossKey(x) === hotLine);
    if (!sc || !e) {
      setEnds(null);
      return;
    }
    const calc = () =>
      setEnds({
        from: endState(sc, canvas.current, e.from),
        to: endState(sc, canvas.current, e.to),
      });
    calc();
    sc.addEventListener('scroll', calc, { passive: true });
    return () => sc.removeEventListener('scroll', calc);
    // the line is identified by hotLine; `cross` is a new array every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotLine, crossSig]);
  const hotEdge = hotLine === null ? undefined : cross.find((x) => crossKey(x) === hotLine);
  const anyHot = hotLine !== null || hotRig !== null;
  const isHot = (e: CrossEdge) =>
    hotLine !== null
      ? crossKey(e) === hotLine
      : hotRig !== null && (e.from === hotRig || e.to === hotRig);
  const dimmed = (e: CrossEdge) => anyHot && !isHot(e);
  // the frames at the ends of the lit line(s) wear its colour
  const traceOf = (rigKey: string): string | undefined => {
    if (hotLine !== null) {
      const e = cross.find((x) => crossKey(x) === hotLine);
      return e && (e.from === rigKey || e.to === rigKey) ? LINE_COLORS[colorOf(e)] : undefined;
    }
    return hotRig === rigKey ? 'var(--ar-ink)' : undefined;
  };
  const drawnCross = cross.flatMap((edge) => {
    const g = geom.get(crossKey(edge));
    return g ? [{ edge, g }] : [];
  });

  // ---- tree selection: open the rig, scroll to the item, highlight it.
  const select = (key: string, rigKey: string | null) => {
    // an agent in the tree opens its page, as a card does
    if (seatIndex.has(key) && !key.startsWith('?/')) {
      ctx.openAgentPage(key);
      return;
    }
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
    // the canvas opens at its top; it scrolls only to bring an off-screen picked rig into view
    if (el && scroller.current && !inView(scroller.current, el as HTMLElement))
      scrollWithin(scroller.current, el as HTMLElement, false);
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
  // L4: a machine's ssh address comes from the hub through any of its rigs (rig.waiting). A failed
  // or empty answer is remembered for a while, then asked again; a machine with only loose
  // sessions has no rig to ask through, and says so instead of waiting for an answer.
  const [sshOf, setSshOf] = useState<Record<string, SshState>>({});
  const sshAt = useRef(new Map<string, number>());
  const asking = useRef(new Set<string>());
  const askSsh = (machineId: string) => {
    if (asking.current.has(machineId)) return;
    const at = sshAt.current.get(machineId);
    const known = sshOf[machineId];
    if (at !== undefined && known) {
      const ttl =
        typeof known.value === 'string'
          ? Infinity
          : known.value === null
            ? SSH_NONE_TTL_MS
            : SSH_FAIL_TTL_MS;
      if (Date.now() - at < ttl) return;
    }
    const rig = graph.machines.find((m) => m.id === machineId)?.rigs[0]?.name;
    const remember = (st: SshState) => {
      sshAt.current.set(machineId, Date.now());
      setSshOf((o) => ({ ...o, [machineId]: st }));
    };
    if (!rig) {
      remember({
        value: undefined,
        note: 'no attach line: this machine runs no rig, and the hub gives a machine\u2019s ssh address only through a rig',
      });
      return;
    }
    asking.current.add(machineId);
    void callVerb<RigWaitingOutput>(ctx.getSocket(), 'rig.waiting', {
      machine: machineId,
      rig,
    }).then((a) => {
      asking.current.delete(machineId);
      remember(a.ok ? { value: a.value.ssh } : { value: undefined });
    });
  };
  const detailRef = useRef<HTMLDivElement>(null);
  const detailFrom = useRef<HTMLElement | null>(null);
  const quiet = useRef(false);
  const onHover = (key: string, el: HTMLElement) => {
    keep();
    detailFrom.current = el;
    if (quiet.current) return; // focus handed back by Escape must not reopen the card
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
      if (detail) {
        const inside = detailRef.current?.contains(document.activeElement);
        setDetail(null);
        if (inside) {
          quiet.current = true;
          detailFrom.current?.focus();
          quiet.current = false;
        }
      } else setPinned(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [detail, pinned]);
  const detailHit = detail ? seatIndex.get(detail.key) : undefined;
  // L3: the card's buttons are reachable by keyboard. Tab from the card with its hover card open
  // goes into the hover card; Shift+Tab out of its first button, and Escape, go back to the card.
  const onTab = (e: React.KeyboardEvent) => {
    const first = detailRef.current?.querySelector<HTMLElement>('button:not([disabled])');
    if (!detail || !first) return;
    e.preventDefault();
    keep();
    first.focus();
  };
  const onDetailKey = (e: React.KeyboardEvent) => {
    const first = detailRef.current?.querySelector<HTMLElement>('button:not([disabled])');
    if (e.key === 'Tab' && e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      detailFrom.current?.focus();
    }
  };
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
  /**
   * Bring a line's two ends on screen: both frame headers when they fit together (vertically, and
   * sideways if the columns do), else the end that is farther from where the canvas is now.
   */
  const revealLine = (e: CrossEdge) => {
    const sc = scroller.current;
    const cv = canvas.current;
    if (!sc?.scrollTo || !cv) return;
    const head = (k: string) =>
      cv.querySelector<HTMLElement>(`[data-graph-rig="${CSS.escape(k)}"] .g2-rig-head`);
    const a = head(e.from);
    const b = head(e.to);
    if (!a || !b) return;
    const s = sc.getBoundingClientRect();
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    const room = s.height - headRoom(sc) - 32;
    const top = Math.min(ra.top, rb.top);
    const bottom = Math.max(ra.bottom, rb.bottom);
    if (bottom - top <= room) {
      // both fit: put the pair in the middle of the visible area
      const mid = (top + bottom) / 2;
      const want = s.top + headRoom(sc) + (s.height - headRoom(sc)) / 2;
      const left = Math.min(ra.left, rb.left);
      const right = Math.max(ra.right, rb.right);
      const sideways = right - left <= s.width - 32 ? left - s.left - 16 : 0;
      sc.scrollTo({
        top: sc.scrollTop + mid - want,
        left: sideways ? sc.scrollLeft + sideways : sc.scrollLeft,
        behavior: 'smooth',
      });
      return;
    }
    // they do not fit together: go to the end that is not on screen (the far one when both are not)
    const mid = s.top + s.height / 2;
    const far =
      endState(sc, cv, e.from) === 'in view'
        ? b
        : endState(sc, cv, e.to) === 'in view'
          ? a
          : Math.abs(ra.top - mid) > Math.abs(rb.top - mid)
            ? a
            : b;
    scrollWithin(sc, far, true);
  };
  const pinCross = (e: CrossEdge) => {
    setLineHover(null);
    setPinned({ title: crossTitle(e), items: e.items });
  };

  const toggleRig = useStable((k: string, wasOpen: boolean) =>
    setOverrides((o) => ({ ...o, [k]: !wasOpen }))
  );
  const pickRig = useStable((k: string) => {
    ctx.chooseRig(k);
    setFocusKey(k);
  });
  // W2: an agent click goes to the agent's page, not the side panel
  const openAgent = useStable((k: string) => ctx.openAgentPage(k));
  const onHoverStable = useStable(onHover);
  const hideStable = useStable(hide);
  const onTabStable = useStable(onTab);
  const pinLine = useStable((e: MapEdge, title: string) => {
    setLineHover(null);
    setPinned({ title, items: e.items });
  });
  const expandAll = (on: boolean) =>
    setOverrides(Object.fromEntries(groups.map((g) => [g.key, on])));
  const counts = Object.fromEntries(
    FLAG_FILTERS.map((f) => [f.key, groups.filter((g) => rigMatches(g, f.key)).length])
  ) as Record<FlagFilter, number>;
  const crossTotal = graph.cross.reduce((n, e) => n + e.count, 0);
  const unplacedHint = unplacedText(graph.unplaced);

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
        <span className="g2-mock-note" data-testid="g2-mock-note">
          <MockNote>Rig and agent controls on this page are mocks — nothing is sent</MockNote>
        </span>
      </div>
      <p className="view-caption g2-caption" data-testid="g2-caption">
        <b>{graph.totals.rigs} rigs</b> · {graph.totals.agents} agents · {graph.totals.active}{' '}
        active · {graph.machines.length} machines · <b>{graph.cross.length} lines between rigs</b> (
        {crossTotal} handoffs)
        {hiddenLines.lines > 0 && (
          <span data-testid="g2-hidden-lines">
            {' '}
            · {hiddenLines.lines} to hidden stopped rig{hiddenLines.lines === 1 ? '' : 's'}
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
      </p>
      <p className="g2-legend" data-testid="g2-legend">
        <span className="g2-legend-line" aria-hidden="true" />
        Each line is one pair of rigs, in its own colour · thicker = more handoffs · bold with a
        gold edge = still waiting · dashed = left open over 2 h · dotted inside a rig = planned in
        its spec · hover a line, a rig or a row under Lines to follow it
      </p>
      <div className="g2-body">
        <div className="g2-rail">
          <GraphTree machines={columns} selected={focusKey} onSelect={select} />
          <LinesPanel
            lines={cross}
            colorOf={colorOf}
            nameOf={nameOf}
            hot={hotLine}
            onHot={setHotLine}
            onPin={pinCross}
            onReveal={revealLine}
            hidden={hiddenLines}
          />
        </div>
        <div className="g2-scroll-wrap">
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
                  {LINE_COLORS.map((c, i) => (
                    <marker
                      key={c}
                      id={`g2-cross-arrow-${i}`}
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="10"
                      markerHeight="10"
                      markerUnits="userSpaceOnUse"
                      orient="auto"
                    >
                      <path d="M0,0 L10,5 L0,10 z" fill={c} />
                    </marker>
                  ))}
                </defs>
                {drawnCross.map(({ edge, g }) => (
                  <g
                    key={crossKey(edge)}
                    data-testid="g2-cross"
                    data-from={edge.from}
                    data-to={edge.to}
                    data-count={edge.count}
                    data-dim={dimmed(edge) || undefined}
                    data-hot={isHot(edge) || undefined}
                    className="g2-cross-line"
                    tabIndex={0}
                    role="button"
                    aria-label={`${crossTitle(edge)}. Enter shows them.`}
                    onPointerEnter={(ev) => {
                      crossHover(edge, ev);
                      setHotLine(crossKey(edge));
                    }}
                    onPointerMove={(ev) => crossHover(edge, ev)}
                    onPointerLeave={() => {
                      setLineHover(null);
                      setHotLine(null);
                    }}
                    onFocus={() => setHotLine(crossKey(edge))}
                    onBlur={() => setHotLine(null)}
                    onClick={() => pinCross(edge)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        pinCross(edge);
                      }
                    }}
                  >
                    {edge.open > 0 && (
                      <path
                        d={g.d}
                        className="g2-cross-glow"
                        strokeWidth={4.5 + (edge.count / maxCross) * 5}
                      />
                    )}
                    <path
                      d={g.d}
                      className={`g2-cross-path ${edge.open ? 'open' : edge.stale ? 'stale' : ''}`}
                      stroke={LINE_COLORS[colorOf(edge)]}
                      strokeWidth={1.8 + (edge.count / maxCross) * 4.5}
                      markerEnd={`url(#g2-cross-arrow-${colorOf(edge)})`}
                    />
                    <path d={g.d} className="hit" />
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
                        onToggle={toggleRig}
                        onPick={pickRig}
                        onOpen={openAgent}
                        onHover={onHoverStable}
                        onLeave={hideStable}
                        onTab={onTabStable}
                        onLineHover={setLineHover}
                        onLinePin={pinLine}
                        nameOf={nameOf}
                        trace={traceOf(g.key)}
                        onTrace={setHotRig}
                      />
                    ))}
                  </section>
                ))}
              </div>
              <svg className="g2-cross-labels" width={size.w} height={size.h} aria-hidden="true">
                {drawnCross.map(({ edge, g }) => (
                  <g
                    key={`l:${crossKey(edge)}`}
                    className="rigmap-label g2-cross-label"
                    data-dim={dimmed(edge) || undefined}
                    data-testid="g2-cross-label"
                    onPointerEnter={(ev) => crossHover(edge, ev)}
                    onPointerLeave={() => setLineHover(null)}
                    onClick={() => pinCross(edge)}
                  >
                    <rect
                      x={g.lx - 13}
                      y={g.ly - 9}
                      width={26}
                      height={18}
                      rx={4}
                      style={{ stroke: LINE_COLORS[colorOf(edge)] }}
                    />
                    <text x={g.lx} y={g.ly} className="rigmap-count">
                      {edge.count}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>
          {hotEdge && ends && (
            <p className="g2-follow" data-testid="g2-follow" role="status">
              <span
                className="g2-swatch"
                aria-hidden="true"
                style={{ background: LINE_COLORS[colorOf(hotEdge)] }}
              />
              <b className="mono">{nameOf(hotEdge.from)}</b>
              <i data-end={ends.from}>
                {ends.from === 'in view' ? '' : ends.from === 'above' ? '▲ above' : '▼ below'}
              </i>
              {' → '}
              <b className="mono">{nameOf(hotEdge.to)}</b>
              <i data-end={ends.to}>
                {ends.to === 'in view' ? '' : ends.to === 'above' ? '▲ above' : '▼ below'}
              </i>
              <span className="mono"> · {hotEdge.count}</span>
            </p>
          )}
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
          ssh={sshOf[detailHit.rig.machineId]?.value}
          sshNote={sshOf[detailHit.rig.machineId]?.note}
          ref={detailRef}
          onKeyDown={onDetailKey}
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
