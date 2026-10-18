import { useCallback, useMemo, useState } from 'react';

/**
 * v2 kit · handoff lines: ONE quiet line style for every screen that draws handoffs (Rig Map,
 * Handoff Flow, Graph). Pure and screen-agnostic: a screen gives it counts and ids, it gives back a
 * width step, merged pairs, labels, mark counts and the lit / faint / dimmed state of a line.
 *
 * The rules it holds (brief-2026-10-19-appyrig-handoff-lines):
 *  1. Thin lines; the NUMBER does the work. Width has three steps set by absolute counts, never by a
 *     share of the busiest pair (a pair with 3 handoffs is thin in every rig, wherever it sits).
 *  2. One line per pair of nodes, labelled with both directions ("14 ⇄ 8").
 *  3. Calm by default, detail on hover or focus.
 *  4. Status is a mark, not a line style: amber badge = still waiting, clock badge = left open
 *     over 2 h. Dotted means planned and nothing else.
 *  5. One legend and one explain sentence, exported from here, so the screens cannot drift.
 */

// ── width steps ────────────────────────────────────────────────────────────────────────────────

/**
 * Where a pair becomes medium and heavy, in handoffs. Chosen on live data (2026-10-19, M4 hub):
 * across the 49 pairs of agents inside one rig on the three machines, 27 sit under 10, 21 are
 * 10–49 and only 1 reaches 50 (appyrig-v15-loadout, 71; the same rig's others are 24, 21 and 2;
 * ylo-d10's are 28, 22, 15 and 14). Cut at 10 and 50 so most lines are thin, a busy pair stands out
 * as medium, and heavy is rare and means "this pair carries the rig". Change here, once.
 */
export const LINE_MEDIUM_FROM = 10;
export const LINE_HEAVY_FROM = 50;

export type LineStep = 'thin' | 'medium' | 'heavy';

/** Stroke width in px for each step. Heavy is the cap: no handoff line is wider than this. */
export const LINE_WIDTH: Record<LineStep, number> = { thin: 1.5, medium: 2.2, heavy: 3 };
export const LINE_WIDTH_CAP = 3;

/** The width step for a handoff count: absolute cut-offs, not a share of the busiest pair. */
export function lineStep(count: number): LineStep {
  if (count >= LINE_HEAVY_FROM) return 'heavy';
  if (count >= LINE_MEDIUM_FROM) return 'medium';
  return 'thin';
}

export const lineWidth = (count: number): number => LINE_WIDTH[lineStep(count)];

// ── one line per pair ──────────────────────────────────────────────────────────────────────────

/** A directed edge as a screen has it: counts from one node to another, with status counts. */
export interface RawEdge {
  from: string;
  to: string;
  count: number;
  /** Open and fresh: still waiting. */
  open?: number;
  /** Open for more than 2 h. */
  stale?: number;
  /** A line from the rig spec with no handoff yet (dotted). */
  planned?: boolean;
}

/** One entry per UNORDERED pair; `a` sorts before `b`, so the same pair always has the same key. */
export interface LinePair {
  a: string;
  b: string;
  aToB: number;
  bToA: number;
  total: number;
  waiting: number;
  leftOpen: number;
  /** True only when the pair has no handoff at all and the spec plans it. */
  planned: boolean;
}

export const pairKey = (a: string, b: string): string =>
  a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;

/** Both directions of a pair as one entry. Self lines (from === to) are left out. */
export function mergePairs(edges: RawEdge[]): LinePair[] {
  const map = new Map<string, LinePair>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const [a, b] = e.from < e.to ? [e.from, e.to] : [e.to, e.from];
    const k = pairKey(a, b);
    const p = map.get(k) ?? {
      a,
      b,
      aToB: 0,
      bToA: 0,
      total: 0,
      waiting: 0,
      leftOpen: 0,
      planned: true,
    };
    if (e.from === a) p.aToB += e.count;
    else p.bToA += e.count;
    p.total += e.count;
    p.waiting += e.open ?? 0;
    p.leftOpen += e.stale ?? 0;
    if (e.count > 0 || !e.planned) p.planned = false;
    map.set(k, p);
  }
  return [...map.values()].sort(
    (x, y) => y.total - x.total || pairKey(x.a, x.b).localeCompare(pairKey(y.a, y.b))
  );
}

/** "14 ⇄ 8" both ways; "14 →" one way a to b; "← 8" one way b to a; "" for a planned line. */
export function pairLabel(p: Pick<LinePair, 'aToB' | 'bToA'>): string {
  if (p.aToB > 0 && p.bToA > 0) return `${p.aToB} ⇄ ${p.bToA}`;
  if (p.aToB > 0) return `${p.aToB} →`;
  if (p.bToA > 0) return `← ${p.bToA}`;
  return '';
}

/** Where the arrowheads go: at b when anything went a to b, at a when anything went b to a. */
export function arrowHeads(p: Pick<LinePair, 'aToB' | 'bToA'>): { atA: boolean; atB: boolean } {
  return { atA: p.bToA > 0, atB: p.aToB > 0 };
}

// ── status as marks ────────────────────────────────────────────────────────────────────────────

export interface LineMarks {
  /** How many are still waiting (amber badge); 0 = no badge. */
  waiting: number;
  /** How many were left open over 2 h (clock badge); 0 = no badge. */
  leftOpen: number;
}

export const lineMarks = (p: Pick<LinePair, 'waiting' | 'leftOpen'>): LineMarks => ({
  waiting: p.waiting,
  leftOpen: p.leftOpen,
});

/** Dotted means planned and nothing else: the one dash pattern a handoff line may carry. */
export const PLANNED_DASH = '1 4';

/** A pod-to-pod edge, for the merged rail. */
export interface PodEdge {
  fromPod: string;
  toPod: string;
  count: number;
  open?: number;
  stale?: number;
}

/**
 * One rail per pair of pods with a total, never parallel rails: lines between pods are merged
 * (both directions together), and a rail inside one pod is not a rail.
 */
export function podRail(edges: PodEdge[]): LinePair[] {
  return mergePairs(
    edges.map((e) => ({
      from: e.fromPod,
      to: e.toPod,
      count: e.count,
      open: e.open,
      stale: e.stale,
    }))
  );
}

// ── calm / lit / dimmed ────────────────────────────────────────────────────────────────────────

export type LineFocusState = 'faint' | 'lit' | 'dimmed';

/** The focus id for a line itself (hovering or focusing the line, not a node). */
export const lineFocusId = (a: string, b: string): string => `line:${pairKey(a, b)}`;

/**
 * Faint when nothing is focused; with a node focused, its lines are lit and every other line is
 * dimmed; with a line focused, only that line is lit.
 */
export function lineFocusState(focus: string | null, a: string, b: string): LineFocusState {
  if (focus === null) return 'faint';
  if (focus.startsWith('line:')) return focus === lineFocusId(a, b) ? 'lit' : 'dimmed';
  return focus === a || focus === b ? 'lit' : 'dimmed';
}

/** Handlers that set the focus on pointer hover AND keyboard focus (a keyboard user gets the same). */
export interface FocusHandlers {
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * Tracks which node (an agent or a rig id) or line the pointer or keyboard is on. A screen spreads
 * `focusProps(id)` on a card, a rig box or a line, and asks `stateOf(a, b)` for each line it draws.
 */
export function useLineFocus() {
  const [focus, setFocus] = useState<string | null>(null);
  const focusProps = useCallback(
    (id: string): FocusHandlers => ({
      onPointerEnter: () => setFocus(id),
      onPointerLeave: () => setFocus(null),
      onFocus: () => setFocus(id),
      onBlur: () => setFocus(null),
    }),
    []
  );
  const stateOf = useCallback((a: string, b: string) => lineFocusState(focus, a, b), [focus]);
  return useMemo(() => ({ focus, setFocus, focusProps, stateOf }), [focus, focusProps, stateOf]);
}

// ── one legend, one explain sentence ───────────────────────────────────────────────────────────

export interface LegendEntry {
  key: 'thin' | 'medium' | 'heavy' | 'both' | 'waiting' | 'leftOpen' | 'planned' | 'calm';
  /** What the mark looks like, in a few words (the sample is drawn by the legend component). */
  label: string;
  /** What it means. */
  means: string;
}

export const LINE_LEGEND: LegendEntry[] = [
  { key: 'thin', label: `thin · 1–${LINE_MEDIUM_FROM - 1}`, means: 'a few handoffs' },
  {
    key: 'medium',
    label: `medium · ${LINE_MEDIUM_FROM}–${LINE_HEAVY_FROM - 1}`,
    means: 'a busy pair',
  },
  { key: 'heavy', label: `heavy · ${LINE_HEAVY_FROM}+`, means: 'the pair that carries the rig' },
  {
    key: 'both',
    label: '14 ⇄ 8',
    means: 'one line per pair: handoffs each way, arrowheads show direction',
  },
  { key: 'waiting', label: 'amber badge', means: 'still waiting' },
  { key: 'leftOpen', label: 'clock badge', means: 'left open for over 2 h' },
  { key: 'planned', label: 'dotted', means: 'planned in the rig spec, no handoff yet' },
  { key: 'calm', label: 'faint', means: 'hover or focus an agent to light its lines' },
];

/** The one explain sentence every screen shows for its lines. */
export const LINE_EXPLAIN =
  'Each line is one pair, labelled with the handoffs each way (14 ⇄ 8). Width has three steps by count, ' +
  `not by how busy the rest are (under ${LINE_MEDIUM_FROM}, ${LINE_MEDIUM_FROM}–${LINE_HEAVY_FROM - 1}, ${LINE_HEAVY_FROM}+). ` +
  'An amber badge means still waiting and a clock badge means left open over 2 h. Dotted means planned and nothing else. ' +
  'Lines start faint; hover or focus an agent to light its own.';

// ── the guard: no per-screen width formula ─────────────────────────────────────────────────────

/**
 * Source lines that size a stroke from a share of the busiest pair (a division by a "max").
 * Used by the guard test; exported so a screen's own test can run it on its file.
 */
export function relativeWidthLines(source: string): string[] {
  return source
    .split('\n')
    .filter(
      (l) =>
        /stroke|width/i.test(l) &&
        /\/\s*(?:max\w*|\(?\s*Math\.max)/.test(l) &&
        !/^\s*(\/\/|\*)/.test(l)
    );
}
