// Forked from components/HandoffFlow.tsx @ 08025cf — mirror Current's fixes or 3-way diff on promote.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FleetMachine, HandoffGetOutput, RigEntry, RigEntryOutput } from '@appydave/shared';
import { ago } from '../../../fleet/model.js';
import { callVerb } from '../../../fleet/coreCall.js';
import type { FleetSocket } from '../../../fleet/useFleet.js';
import {
  buildFlow,
  flowChapters,
  flowRange,
  replaySteps,
  rigQueue,
  stageOf,
  type FlowOptions,
} from '../../../fleet/views.js';
import ReplayConsoles from '../../../components/ReplayConsoles.js';
import HandoffPanel, {
  type PanelMode,
  type PanelSelection,
} from '../../../components/HandoffPanel.js';
import FollowWork from '../../../components/FollowWork.js';
import { entryWords, medianSentence } from '../../../components/HandoffFlow.js';
import { followWork } from '../../../fleet/timeline.js';
import { isShortcutBlocked, isSlider } from '../../../lib/keys.js';
import {
  HandoffLegend,
  LINE_WIDTH,
  LeftOpenBadgeSvg,
  WaitingBadgeSvg,
  arrowHeads,
  labelClass,
  lineClass,
  lineFocusId,
  lineWidth,
  mergePairs,
  pairLabel,
  useLineFocus,
} from '../../kit/index.js';
import { flowPairKey, flowPairs, pairPath, type FlowPair } from './flowLines.js';
import './flow.css';

/**
 * Run board brief, lane 2: v2 counts a handoff as sent back by its `verdict:` tag (changes / fail)
 * when the rig uses them, else by the old backwards-stage rule. Current's page passes nothing.
 */
const V2_FLOW: FlowOptions = { sentBack: 'verdict-or-stage' };

interface Props {
  machine: FleetMachine | null;
  rig: string | null;
  now: number;
  /** For the consoles' seat.history calls; without it the consoles show handoffs only. */
  socket?: FleetSocket;
  /** S2: ← → step through handoffs. Off while an overlay owns the keyboard. */
  keys?: boolean;
  /**
   * D15 · UI-B: open the one agent panel (App owns it; the Rig Map opens the same one). A box with
   * exactly one seat opens it on click; the documents live there, never in this view.
   */
  onOpenAgent?: (seatKey: string) => void;
}

const W = 1000;
const H = 400;
const ROW_Y = 200;
const BOX_H = 92;

interface Layout {
  x: (id: string) => number;
  idx: (id: string) => number;
  boxW: number;
}

/** Boxes spread evenly across the width: four role stages, or up to six seats. */
function layoutFor(ids: string[]): Layout {
  const slot = W / ids.length;
  return {
    x: (id) => slot * (ids.indexOf(id) + 0.5),
    idx: (id) => ids.indexOf(id),
    boxW: Math.min(170, slot - 40),
  };
}

export type Lens = 'traffic' | 'structure';

export interface StructureLine {
  from: string;
  to: string;
  kinds: string[];
}

/**
 * C35, the structure lens: the lines OpenRig plans between this rig's seats (delegates_to, can_observe...),
 * drawn between the same boxes as the traffic. A rig that reports none falls back to who has handed to
 * whom (`source: 'traffic'`), so the lens is never a blank diagram.
 */
export function structureLines(
  edges: { from: string; to: string; kind: string }[] | undefined,
  trafficPairs: { from: string; to: string }[],
  mode: 'roles' | 'seats',
  nodes: string[]
): { lines: StructureLine[]; source: 'planned' | 'traffic' } {
  const idOf = (raw: string) => {
    const n = raw.split('@')[0]!;
    return mode === 'roles' ? stageOf(n) : n;
  };
  const ok = new Set(nodes);
  const byPair = new Map<string, StructureLine>();
  for (const e of edges ?? []) {
    // Like Traffic: an endpoint with no box of its own (seats mode caps the boxes) joins `others`.
    const place = (raw: string) => {
      const id = idOf(raw);
      return ok.has(id) ? id : mode === 'seats' && ok.has('others') ? 'others' : null;
    };
    const from = place(e.from);
    const to = place(e.to);
    if (!from || !to || from === to) continue;
    const key = `${from}→${to}`;
    const line = byPair.get(key) ?? { from, to, kinds: [] };
    if (!line.kinds.includes(e.kind)) line.kinds.push(e.kind);
    byPair.set(key, line);
  }
  if (byPair.size > 0) return { lines: [...byPair.values()], source: 'planned' };
  const seen = new Map<string, StructureLine>();
  for (const e of trafficPairs) {
    if (e.from === e.to) continue;
    seen.set(`${e.from}→${e.to}`, { from: e.from, to: e.to, kinds: ['handed work'] });
  }
  return { lines: [...seen.values()], source: 'traffic' };
}

const PANEL_KEY = 'appyrig.handoffPanel';
/**
 * Batch 1 · B1 (fb-0005: "hovering over something doesn't mean you want it"): the panel shows what
 * you CLICK unless a viewer chose to have it follow the pointer. A stored choice is kept.
 */
function readPanelMode(): PanelMode {
  try {
    return localStorage.getItem(PANEL_KEY) === 'hover' ? 'hover' : 'pinned';
  } catch {
    return 'pinned';
  }
}

/** A floating card for what is under the pointer (B1): text only, never in the layout. */
interface HoverCard {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

const REPLAY_SECONDS = 40;
/** Replay holds on each chapter for this many 100 ms ticks, so the narration can be read. */
const CHAPTER_HOLD_TICKS = 30;

const clock = (t: number) =>
  new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Concept 4 · Handoff Flow: queue handoffs moving lead → builders → QA → reviewer, as pulses.
 * Amber arcs below the row are items sent back to an earlier stage (rework, verdicts, answers).
 * The scrubber replays a finished run.
 * A team with no QA or review seat is drawn one box per seat instead of being squashed into roles.
 */
export default function HandoffFlowV2({
  machine,
  rig,
  now,
  socket,
  keys = true,
  onOpenAgent,
}: Props) {
  // S4: the handoff detail panel. `sel` names a line (edge key) and/or one item on it.
  // B1: `stage` names a box (a seat or role) instead of a line.
  const [sel, setSel] = useState<{
    edge: string | null;
    itemId: string | null;
    stage?: string | null;
  } | null>(null);
  // Lines are faint; hovering or focusing a box or a line lights its own (kit: useLineFocus).
  const lineFocus = useLineFocus();
  /** C35: which picture of the rig to draw: who handed what (traffic), or who works with whom (structure). */
  const [lens, setLens] = useState<Lens>('traffic');
  const [card, setCard] = useState<HoverCard | null>(null);
  const [pinned, setPinned] = useState(false);
  const [mode, setMode] = useState<PanelMode>(readPanelMode);
  const bodies = useRef(new Map<string, HandoffGetOutput>());
  // Views V2: the handoff whose work is being followed (the chain replaces the panel).
  const [follow, setFollow] = useState<string | null>(null);
  const chain = useMemo(
    () => (machine && rig && follow ? followWork(machine, rig, follow) : null),
    [machine, rig, follow]
  );
  const [entry, setEntry] = useState<RigEntry | null>(null);
  // C1 (F9): the row is always there, so its answer arriving never pushes the diagram down.
  const [entryLoaded, setEntryLoaded] = useState(false);
  const machineId = machine?.machine.id ?? null;

  const range = useMemo(
    () => (machine && rig ? flowRange(rigQueue(machine, rig)) : null),
    [machine, rig]
  );
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const atRef = useRef<number | null>(null);
  const hold = useRef(0);
  // Chapters only need the open/closed picture to 10-minute precision.
  const tenMin = Math.floor(now / 600_000) * 600_000;
  const chapters = useMemo(
    () => (machine && rig ? flowChapters(machine, rig, tenMin, V2_FLOW) : []),
    [machine, rig, tenMin]
  );
  const steps = useMemo(() => (machine && rig ? replaySteps(machine, rig) : []), [machine, rig]);
  // Set while stepping one handoff at a time; any other move clears it.
  const [stepId, setStepId] = useState<string | null>(null);
  const jump = (t: number | null, step: string | null = null) => {
    atRef.current = t;
    setAt(t);
    setStepId(step);
  };

  // S2: ← → press the step buttons. The handler reads the latest step functions from a ref.
  const stepKeys = useRef<{ prev: () => void; next: () => void } | null>(null);
  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (isShortcutBlocked(e) || isSlider(e.target) || !stepKeys.current) return;
      e.preventDefault();
      if (e.key === 'ArrowLeft') stepKeys.current.prev();
      else stepKeys.current.next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys]);

  // S4: where this rig's work came in (rig.entry, read-only), once per rig.
  useEffect(() => {
    setEntry(null);
    setEntryLoaded(false);
    setSel(null);
    setPinned(false);
    setFollow(null);
    if (!socket || !machineId || !rig) return;
    let current = true;
    void callVerb<RigEntryOutput>(socket, 'rig.entry', { machine: machineId, rig }).then((a) => {
      if (!current) return;
      if (a.ok) setEntry(a.value.entry);
      setEntryLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [socket, machineId, rig]);

  // S4: Esc closes the panel first (capture, so the screen-level Esc never also goes back).
  useEffect(() => {
    // r1 S4: stand down while a seat panel (or the ? overlay) is on top, so one Esc closes one thing.
    // Views V2: while following work, Esc is FollowWork's (back to this panel).
    if (!sel || chain || !keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setSel(null);
      setPinned(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sel, chain, keys]);

  // A new rig starts at its end (the current state).
  useEffect(() => {
    jump(null);
    setPlaying(false);
  }, [machine?.machine.id, rig]);

  useEffect(() => {
    if (!playing || !range) return;
    const step = (range.end - range.start) / (REPLAY_SECONDS * 10);
    const id = window.setInterval(() => {
      if (hold.current > 0) {
        hold.current -= 1;
        return;
      }
      const cur = atRef.current ?? range.start;
      let next = cur + step;
      const chapter = chapters.find((c) => c.at > cur && c.at <= next);
      if (chapter) {
        next = chapter.at;
        hold.current = CHAPTER_HOLD_TICKS;
      }
      if (next >= range.end) {
        setPlaying(false);
        next = range.end;
      }
      jump(next);
    }, 100);
    return () => window.clearInterval(id);
  }, [playing, range, chapters]);

  // Step logic sits above the early returns so the key handler can read it from an effect
  // (r1 S2: a ref written during render is not safe under concurrent rendering).
  const tStep = at ?? range?.end ?? 0;
  const stepIdx = stepId ? steps.findIndex((q) => q.id === stepId) : -1;
  const stepTo = (i: number) => {
    const q = steps[i];
    if (!q) return;
    setPlaying(false);
    jump(Date.parse(q.createdAt), q.id);
    // S4: the stepped handoff's full message, so the one-line narration is readable in full.
    if (!pinned) setSel({ edge: null, itemId: q.id });
  };
  const nextStep = () =>
    stepTo(
      stepIdx >= 0
        ? stepIdx + 1
        : at === null
          ? 0
          : steps.findIndex((q) => Date.parse(q.createdAt) > tStep)
    );
  const prevStep = () => {
    if (stepIdx >= 0) return stepTo(stepIdx - 1);
    if (at === null) return stepTo(steps.length - 1);
    let i = -1;
    steps.forEach((q, k) => {
      if (Date.parse(q.createdAt) < tStep) i = k;
    });
    stepTo(i);
  };
  const ready = !!(machine && rig && range);
  useEffect(() => {
    stepKeys.current = ready
      ? {
          prev: () => stepIdx !== 0 && prevStep(),
          next: () => stepIdx !== steps.length - 1 && nextStep(),
        }
      : null;
  });

  if (!machine || !rig) return <p className="empty">Pick a rig.</p>;
  if (!range) {
    return (
      <p className="empty" data-testid="flow-empty">
        No handoffs through the queue in {rig} yet.
      </p>
    );
  }
  const t = at ?? range.end;
  const flow = buildFlow(machine, rig, t, now, V2_FLOW)!;
  const pairs = flowPairs(flow.edges, t);
  const L = layoutFor(flow.stages.map((s) => s.stage));
  const labelOf = (id: string) => flow.stages.find((s) => s.stage === id)?.label ?? id;
  const staleStages = flow.stages.filter((s) => s.stale > 0);
  const structure = structureLines(
    machine.snapshot.rigs.find((r) => r.name === rig)?.edges,
    flow.edges.map((e) => ({ from: e.from, to: e.to })),
    flow.mode,
    flow.stages.map((x) => x.stage)
  );
  // During a replay, narrate the latest chapter reached.
  const chapter = at === null ? null : ([...chapters].reverse().find((c) => c.at <= t) ?? null);
  const stepItem = stepIdx >= 0 ? steps[stepIdx]! : null;
  const pairOf = (key: string | null) => (key ? pairs.find((p) => p.key === key) : undefined);
  const pairTitle = (p: FlowPair) =>
    `${labelOf(p.a)} ⇄ ${labelOf(p.b)} · ${pairLabel(p)} · ${p.total} handoff${p.total === 1 ? '' : 's'}`;
  const pairItems = (p: FlowPair) =>
    p.edges.flatMap((e) => e.items).sort((x, y) => x.createdAt.localeCompare(y.createdAt));
  const stageSelection = (stage: string, itemId: string | null): PanelSelection | null => {
    const lines = flow.edges.filter((e) => e.from === stage || e.to === stage);
    const seen = new Set<string>();
    const items = lines
      .flatMap((e) => e.items)
      .filter((q) => (seen.has(q.id) ? false : (seen.add(q.id), true)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const inN = lines.filter((e) => e.to === stage).reduce((n, e) => n + e.count, 0);
    const outN = lines.filter((e) => e.from === stage).reduce((n, e) => n + e.count, 0);
    return {
      edge: `stage:${stage}`,
      title: `${labelOf(stage)} · ${inN} in · ${outN} out`,
      agents: flow.stages
        .find((x) => x.stage === stage)
        ?.seats.map((x) => ({
          key: x.key,
          name: x.name,
        })),
      items,
      // QA B1-1: a box with no handoffs still answers a click, saying so (never the idle text).
      itemId:
        itemId && items.some((q) => q.id === itemId) ? itemId : (items[items.length - 1]?.id ?? ''),
    };
  };
  const selection: PanelSelection | null = (() => {
    if (!sel) return null;
    if (sel.stage) return stageSelection(sel.stage, sel.itemId);
    const pair =
      pairOf(sel.edge) ||
      (sel.itemId && pairs.find((p) => pairItems(p).some((q) => q.id === sel.itemId))) ||
      null;
    const items = pair ? pairItems(pair) : [];
    if (!pair || !items.length) return null;
    const itemId =
      sel.itemId && items.some((q) => q.id === sel.itemId)
        ? sel.itemId
        : items[items.length - 1]!.id;
    return { edge: pair.key, title: pairTitle(pair), items, itemId };
  })();
  // B1: in "Follow pointer" mode the panel follows the pointer (it has a fixed size, so nothing
  // moves); in "On click" mode the pointer only raises a floating card.
  const cardAt = (
    ev: { clientX: number; clientY: number } | null,
    title: string,
    lines: string[]
  ) =>
    // With Explain mode on, its card is the hover help: never float two cards at once.
    setCard(
      ev && !document.querySelector('[data-explain-on]')
        ? { x: ev.clientX + 14, y: ev.clientY + 14, title, lines }
        : null
    );
  const edgeCard = (p: FlowPair, ev: { clientX: number; clientY: number } | null) => {
    const items = pairItems(p);
    const last = items[items.length - 1];
    cardAt(ev, pairTitle(p), [
      `${labelOf(p.a)} → ${labelOf(p.b)}: ${p.aToB} · ${labelOf(p.b)} → ${labelOf(p.a)}: ${p.bToA}`,
      ...(p.waiting ? [`${p.waiting} still waiting`] : []),
      ...(p.leftOpen ? [`${p.leftOpen} left open over 2 h`] : []),
      ...(p.back ? [`${p.back} sent back to an earlier stage`] : []),
      ...(last ? [`latest: ${last.summary ?? last.id}`] : []),
      'Click to show it in the panel.',
    ]);
  };
  const peek = (
    edge: string,
    itemId: string | null = null,
    ev: { clientX: number; clientY: number } | null = null
  ) => {
    if (mode === 'hover' && !pinned) setSel({ edge, itemId });
    else {
      const p = pairOf(edge);
      if (p) edgeCard(p, ev);
    }
  };
  const peekStage = (stage: string, ev: { clientX: number; clientY: number } | null = null) => {
    if (mode === 'hover' && !pinned) setSel({ edge: null, itemId: null, stage });
    else {
      const s = flow.stages.find((x) => x.stage === stage);
      const sl = stageSelection(stage, null);
      cardAt(ev, s?.label ?? stage, [
        ...(s?.seats.length ? [s.seats.map((x) => `${x.name} (${x.model})`).join(', ')] : []),
        sl && sl.items.length
          ? `${sl.title.split(' · ').slice(1).join(' · ')} · click to list them`
          : 'no handoffs through the queue',
      ]);
    }
  };
  const unpeek = () => {
    setCard(null);
    if (!pinned && mode === 'hover') setSel(null);
  };
  const pin = (edge: string, itemId: string | null = null) => {
    setCard(null);
    setSel({ edge, itemId });
    setPinned(true);
  };
  const pinStage = (stage: string) => {
    setCard(null);
    // One seat in the box: the box IS that agent, so it opens the agent panel (documents first).
    const only = flow.stages.find((x) => x.stage === stage)?.seats;
    if (onOpenAgent && only?.length === 1) {
      setSel(null);
      setPinned(false);
      onOpenAgent(only[0]!.key);
      return;
    }
    setSel({ edge: null, itemId: null, stage });
    setPinned(true);
  };
  const chooseMode = (m: PanelMode) => {
    setMode(m);
    if (m === 'hover') setPinned(false);
    try {
      localStorage.setItem(PANEL_KEY, m);
    } catch {
      // per-viewer convenience only
    }
  };
  // S4: the first seat to act, as a box on this diagram.
  const entryText = entry ? entryWords(entry) : null;
  const entryNode = (() => {
    if (!entry?.entry || entry.status !== 'outside-queue') return null;
    const raw = entry.entry.seat;
    const id = flow.mode === 'roles' ? stageOf(raw.split('@')[0]!) : raw.split('@')[0]!;
    return flow.stages.some((s) => s.stage === id) ? id : null;
  })();
  const staleCount = staleStages.reduce((n, s) => n + s.stale, 0);
  const oldestStale = Math.max(0, ...staleStages.map((s) => s.oldestStaleMs ?? 0));

  return (
    <section
      className="flow v2-flow"
      data-testid="handoff-flow"
      data-lens={lens}
      data-mode={flow.mode}
      aria-label={`Handoff flow of ${rig}`}
    >
      <div className="flow-stats">
        <span data-testid="flow-total" data-explain="handoff">
          <b>{flow.total}</b> handoffs
        </span>
        {(flow.mode === 'roles' || flow.rework > 0) && (
          <span data-testid="flow-rework" data-explain="rework">
            <b className="amber">{flow.rework}</b> sent back
          </span>
        )}
        <span
          data-explain="median-turnaround"
          data-testid="flow-median"
          title={medianSentence(flow.medianTurnaroundMin, flow.closedCount)}
        >
          <b>
            {flow.medianTurnaroundMin === null
              ? '–'
              : flow.medianTurnaroundMin < 1
                ? `${Math.round(flow.medianTurnaroundMin * 60)} s`
                : `${flow.medianTurnaroundMin.toFixed(1)} min`}
          </b>{' '}
          median time, handover → close
        </span>
        <span data-testid="flow-bottleneck" data-explain="bottleneck">
          {flow.bottleneck ? (
            <>
              queue builds at <b className="amber">{labelOf(flow.bottleneck)}</b>
            </>
          ) : (
            'nothing queued'
          )}
        </span>
        {staleCount > 0 && (
          <span className="quiet" data-testid="flow-stale" data-explain="stale">
            {staleCount} left open · oldest {ago(oldestStale)}
          </span>
        )}
      </div>
      {/* D09 W0: how the stages are read and where work came in fold under one line, so the stage
          diagram sits right under the numbers. Nothing is removed; open it to read them. */}
      <details className="flow-notes" data-testid="flow-notes">
        <summary>How stages are read · where work came in</summary>
        <p className="view-caption" data-explain={flow.mode === 'roles' ? 'stage' : 'seat-mode'}>
          {flow.mode === 'roles'
            ? 'Stages are read from seat names: qa → QA, review / r1 → Reviewer, lead / orch → Lead, the rest → Builders.'
            : 'No QA or review seat in this rig, so each seat is its own box, in the order it first handed work on.'}
        </p>
        {!entry && (
          <p
            className="flow-entry"
            data-testid="flow-entry"
            data-status={entryLoaded ? 'none' : 'loading'}
          >
            <b>Where work came in · </b>
            {entryLoaded ? 'not known.' : 'checking…'}
          </p>
        )}
        {entry && (
          <p className="flow-entry" data-testid="flow-entry" data-status={entry.status}>
            <b>Where work came in · </b>
            {entry.entry && entryText ? (
              <>
                {entry.entry.seat.split('@')[0]}: {entryText} ({clock(Date.parse(entry.entry.at))})
                {entry.entry.excerpt && (
                  <q className="flow-entry-excerpt" data-testid="flow-entry-excerpt">
                    {entry.entry.excerpt}
                  </q>
                )}
              </>
            ) : (
              <>not known{entry.reason ? `: ${entry.reason}` : ''}</>
            )}
            {entry.seatsWithoutHistory.length > 0 && (
              <span className="quiet">
                {' '}
                · {entry.seatsWithoutHistory.length} seat
                {entry.seatsWithoutHistory.length === 1 ? ' has' : 's have'} no visible history, so
                one of them may have acted first.
              </span>
            )}
          </p>
        )}
      </details>

      {stepItem ? (
        <p className="flow-narration" data-testid="flow-narration" data-kind="step">
          <b>
            Handoff {stepIdx + 1} of {steps.length}
          </b>{' '}
          {clock(Date.parse(stepItem.createdAt))} · {(stepItem.source ?? '?').split('@')[0]} →{' '}
          {(stepItem.destination ?? '?').split('@')[0]}: {stepItem.summary ?? '(no message)'}
        </p>
      ) : (
        chapter && (
          <p className="flow-narration" data-testid="flow-narration" data-kind={chapter.kind}>
            <b>{chapter.title}</b> {chapter.text}
          </p>
        )
      )}

      <div
        className="v2-lens"
        role="group"
        aria-label="What the diagram shows"
        data-explain="v2-lens"
      >
        {(
          [
            ['traffic', 'Traffic', 'who handed what'],
            ['structure', 'Structure', 'who works with whom'],
          ] as const
        ).map(([id, name, what]) => (
          <button
            key={id}
            type="button"
            className="pill-btn"
            data-testid={`flow-lens-${id}`}
            aria-pressed={lens === id}
            onClick={() => setLens(id)}
          >
            {name} <span className="quiet">{what}</span>
          </button>
        ))}
        {lens === 'structure' && (
          <span className="quiet" data-testid="flow-structure-source">
            {structure.source === 'planned'
              ? `${structure.lines.length} planned line${structure.lines.length === 1 ? '' : 's'} from OpenRig, between the same boxes`
              : 'OpenRig reported no planned lines for this rig, so these are the pairs that have handed work to each other'}
          </span>
        )}
      </div>
      <div className="flow-row">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="flow-svg"
          role="group"
          aria-label="Handoff flow diagram: Tab to a line to see its handoffs"
        >
          <defs>
            <marker
              id="hf-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="9"
              markerHeight="9"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 z" className="flow-arrowhead v2-arrowhead" />
            </marker>
            <marker
              id="hf-arrow-start"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="9"
              markerHeight="9"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L10,5 L0,10 z" className="flow-arrowhead v2-arrowhead" />
            </marker>
          </defs>
          {lens === 'traffic' &&
            pairs.map((p, i) => {
              const g = pairPath(p, L, ROW_Y, BOX_H);
              const id = `hf-edge-${i}`;
              const state = lineFocus.stateOf(p.a, p.b);
              const heads = arrowHeads(p);
              // The path runs left box → right box; put each arrowhead at the box it points to.
              const atEnd = g.aLeft ? heads.atB : heads.atA;
              const atStart = g.aLeft ? heads.atA : heads.atB;
              const label = pairLabel(p);
              const w = 16 + label.length * 8.5;
              const inFlight = p.edges.flatMap((e) => e.inFlight);
              const lineFocusProps = lineFocus.focusProps(lineFocusId(p.a, p.b));
              return (
                <g
                  key={p.key}
                  data-testid="flow-edge"
                  data-edge={p.key}
                  data-pair={`${p.a}|${p.b}`}
                  data-kind={p.back ? 'rework' : 'forward'}
                  data-state={state}
                  data-in-flight={inFlight.length}
                  data-selected={selection?.edge === p.key || undefined}
                  tabIndex={0}
                  role="button"
                  aria-label={`${labelOf(p.a)} and ${labelOf(p.b)}: ${p.aToB} one way, ${p.bToA} the other. Enter pins the details.`}
                  onPointerEnter={(ev) => {
                    lineFocusProps.onPointerEnter();
                    peek(p.key, null, ev);
                  }}
                  onPointerMove={(ev) => mode !== 'hover' && edgeCard(p, ev)}
                  onPointerLeave={() => {
                    lineFocusProps.onPointerLeave();
                    unpeek();
                  }}
                  onFocus={() => {
                    lineFocusProps.onFocus();
                    peek(p.key);
                  }}
                  onBlur={() => {
                    lineFocusProps.onBlur();
                    unpeek();
                  }}
                  onClick={() => pin(p.key)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      pin(p.key);
                    }
                  }}
                  data-explain="handoff"
                  data-explain-ctx={pairTitle(p)}
                >
                  <path
                    id={id}
                    d={g.d}
                    className={lineClass(state)}
                    strokeWidth={lineWidth(p.total)}
                    markerEnd={atEnd ? 'url(#hf-arrow)' : undefined}
                    markerStart={atStart ? 'url(#hf-arrow-start)' : undefined}
                  />
                  {/* A wide invisible stroke so the line is easy to hover. */}
                  <path d={g.d} className="hit" />
                  <g
                    data-testid="flow-count-pill"
                    data-count={p.total}
                    data-label={label}
                    className={labelClass(state)}
                  >
                    <rect
                      x={g.lx - w / 2}
                      y={g.ly - 11}
                      width={w}
                      height={18}
                      rx={9}
                      className="v2-pair-pill"
                    />
                    <text x={g.lx} y={g.ly} className="v2-pair-count">
                      {label}
                    </text>
                  </g>
                  <g className={labelClass(state)}>
                    <WaitingBadgeSvg x={g.lx + w / 2 + 10} y={g.ly - 2} n={p.waiting} />
                    <LeftOpenBadgeSvg
                      x={g.lx + w / 2 + (p.waiting ? 30 : 10)}
                      y={g.ly - 2}
                      n={p.leftOpen}
                    />
                  </g>
                  {inFlight.slice(0, 6).map((q, k) => (
                    <circle
                      key={q.id}
                      r={4}
                      className="pulse v2-pulse"
                      data-testid="flow-pulse"
                      data-item={q.id}
                      onPointerEnter={(ev) => peek(p.key, q.id, ev)}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        pin(p.key, q.id);
                      }}
                    >
                      <title>{q.summary ?? q.id}</title>
                      <animateMotion
                        dur="2.4s"
                        repeatCount="indefinite"
                        begin={`${(k * 0.4).toFixed(1)}s`}
                      >
                        <mpath href={`#${id}`} />
                      </animateMotion>
                    </circle>
                  ))}
                </g>
              );
            })}
          {lens === 'structure' &&
            mergePairs(
              structure.lines.map((l) => ({ from: l.from, to: l.to, count: 1, planned: true }))
            ).map((p) => {
              const g = pairPath(p, L, ROW_Y, BOX_H);
              const state = lineFocus.stateOf(p.a, p.b);
              const both = structure.lines.filter(
                (l) => flowPairKey(l.from, l.to) === flowPairKey(p.a, p.b)
              );
              const text = [...new Set(both.flatMap((l) => l.kinds))].join(' · ');
              const heads = arrowHeads(p);
              const atEnd = g.aLeft ? heads.atB : heads.atA;
              const atStart = g.aLeft ? heads.atA : heads.atB;
              const w = 16 + text.length * 7.5;
              return (
                <g
                  key={flowPairKey(p.a, p.b)}
                  data-testid="flow-structure-line"
                  data-edge={`${p.a}|${p.b}`}
                  data-kind-text={text}
                  data-state={state}
                >
                  <title>{`${labelOf(p.a)} · ${labelOf(p.b)}: ${text}`}</title>
                  <path
                    d={g.d}
                    className={lineClass(state, structure.source === 'planned')}
                    strokeWidth={LINE_WIDTH.thin}
                    markerEnd={atEnd ? 'url(#hf-arrow)' : undefined}
                    markerStart={atStart ? 'url(#hf-arrow-start)' : undefined}
                  />
                  <g className={labelClass(state)}>
                    <rect
                      x={g.lx - w / 2}
                      y={g.ly - 15}
                      width={w}
                      height={22}
                      rx={11}
                      className="v2-kind-pill"
                    />
                    <text x={g.lx} y={g.ly} className="v2-kind">
                      {text}
                    </text>
                  </g>
                </g>
              );
            })}
          {flow.stages.map((s) => {
            const x = L.x(s.stage);
            const state = s.waiting ? 'waiting' : s.stale ? 'stale' : '';
            return (
              <g
                key={s.stage}
                data-testid="flow-stage"
                data-stage={s.stage}
                data-selected={sel?.stage === s.stage || undefined}
                tabIndex={0}
                role="button"
                aria-label={
                  onOpenAgent && s.seats.length === 1
                    ? `${s.label}: Enter opens this agent`
                    : `${s.label}: Enter lists its handoffs`
                }
                onPointerEnter={(ev) => {
                  lineFocus.setFocus(s.stage);
                  peekStage(s.stage, ev);
                }}
                onPointerMove={(ev) => mode !== 'hover' && peekStage(s.stage, ev)}
                onPointerLeave={() => {
                  lineFocus.setFocus(null);
                  unpeek();
                }}
                onFocus={() => {
                  lineFocus.setFocus(s.stage);
                  peekStage(s.stage);
                }}
                onBlur={() => {
                  lineFocus.setFocus(null);
                  unpeek();
                }}
                data-focus={lineFocus.focus === s.stage || undefined}
                onClick={() => pinStage(s.stage)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    pinStage(s.stage);
                  }
                }}
                data-waiting={s.waiting}
                data-stale={s.stale}
                data-explain={flow.mode === 'roles' ? `stage-${s.stage}` : 'seat'}
                data-explain-ctx={
                  s.seats.length
                    ? `${s.label}: ${s.seats.map((x) => `${x.name} (${x.model})`).join(', ')}`
                    : s.label
                }
              >
                <rect
                  x={x - L.boxW / 2}
                  y={ROW_Y - BOX_H / 2}
                  width={L.boxW}
                  height={BOX_H}
                  rx={10}
                  className={`flow-box ${state}${s.noLead ? ' none' : ''}${flow.mode === 'roles' && s.outside ? ' outside' : ''}`}
                  data-testid={
                    s.noLead
                      ? 'flow-no-lead'
                      : s.outside && flow.mode === 'roles'
                        ? 'flow-outside'
                        : undefined
                  }
                />
                <text
                  x={x}
                  y={ROW_Y - 14}
                  className={
                    flow.mode !== 'roles'
                      ? 'flow-seat-name'
                      : s.noLead || s.outside
                        ? 'flow-stage-name small'
                        : 'flow-stage-name'
                  }
                >
                  {s.noLead ? 'No lead — by design' : s.label}
                </text>
                <text x={x} y={ROW_Y + 8} className="flow-seats">
                  {s.seats.length
                    ? s.seats.map((x) => x.model).join(' · ')
                    : s.noLead
                      ? 'no lead seat in this rig'
                      : s.outside
                        ? flow.mode === 'roles'
                          ? 'orchestrator, David or another rig'
                          : 'outside this rig'
                        : s.stage === 'others'
                          ? 'quieter seats'
                          : 'no seat'}
                </text>
                {!s.noLead && (
                  <g data-testid="flow-wait-badge" data-state={state || 'none'}>
                    <rect
                      x={x - L.boxW / 2 + 10}
                      y={ROW_Y + 16}
                      width={L.boxW - 20}
                      height={26}
                      rx={13}
                      className={`v2-wait-pill ${state}`}
                    />
                    <text x={x} y={ROW_Y + 34} className="flow-wait v2-wait">
                      {s.waiting
                        ? `${s.waiting} waiting · ${ago(s.oldestWaitMs ?? 0)}`
                        : s.stale
                          ? `${s.stale} open · ${ago(s.oldestStaleMs ?? 0)}`
                          : 'nothing waiting'}
                    </text>
                  </g>
                )}
                {entryNode === s.stage && (
                  <text
                    x={x}
                    y={ROW_Y + BOX_H / 2 + 18}
                    className="flow-entry-mark"
                    data-testid="flow-entry-mark"
                    data-explain="entry-outside"
                    data-explain-ctx={`${entry!.entry!.seat.split('@')[0]}: ${entryText}`}
                  >
                    ↘ work entered here ·{' '}
                    {entry!.entry!.origin === 'startup' ? 'at launch' : 'outside the queue'}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {chain && follow ? (
          <FollowWork
            machineId={machine.machine.id}
            chain={chain}
            fromId={follow}
            socket={socket}
            cache={bodies.current}
            onClose={() => setFollow(null)}
            keys={keys}
          />
        ) : (
          <HandoffPanel
            machineId={machine.machine.id}
            selection={selection}
            mode={mode}
            pinned={pinned}
            socket={socket}
            cache={bodies.current}
            onPick={(id) =>
              sel &&
              setSel(
                sel.stage ? { ...sel, itemId: id } : { edge: selection?.edge ?? null, itemId: id }
              )
            }
            onMode={chooseMode}
            onClose={() => {
              setSel(null);
              setPinned(false);
            }}
            onFollow={(id) => {
              setPinned(true);
              setFollow(id);
            }}
            onOpenAgent={onOpenAgent}
            keys={keys}
            onLine={(dir) => {
              // Views K: ] / [ = next / previous line, in drawing (Tab) order; opens its newest.
              const order = pairs.map((p) => p.key);
              if (!order.length) return;
              const i = selection?.edge ? order.indexOf(selection.edge) : dir === 1 ? -1 : 0;
              pin(order[(i + dir + order.length) % order.length]!);
            }}
          />
        )}
        {card && (
          <div
            className="hover-card"
            role="tooltip"
            data-testid="flow-hover-card"
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
      </div>

      <HandoffLegend compact />
      {flow.mode === 'roles' && (
        <ul className="flow-legend" aria-label="Seats per stage">
          {flow.stages.map((s) => (
            <li key={s.stage}>
              <b>{s.label}</b>{' '}
              {s.seats.map((x) =>
                onOpenAgent ? (
                  <button
                    key={x.name}
                    type="button"
                    className="chip chip-btn"
                    data-family={x.family}
                    data-explain="model"
                    data-testid="flow-agent-chip"
                    title="Open this agent: its documents, terminal and messages"
                    onClick={() => onOpenAgent(x.key)}
                  >
                    {x.name}
                  </button>
                ) : (
                  <span key={x.name} className="chip" data-family={x.family} data-explain="model">
                    {x.name}
                  </span>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flow-replay" data-testid="flow-replay">
        <button
          type="button"
          className="pill-btn cta"
          data-testid="flow-play"
          data-explain="replay"
          onClick={() => {
            if (!playing && t >= range.end) jump(range.start);
            hold.current = 0;
            setPlaying((p) => !p);
          }}
        >
          {playing ? 'Pause' : 'Replay run'}
        </button>
        <button
          type="button"
          className="pill-btn"
          data-testid="flow-prev"
          aria-label="Previous handoff"
          data-explain="step"
          disabled={stepIdx === 0}
          onClick={prevStep}
        >
          ◀
        </button>
        <button
          type="button"
          className="pill-btn"
          data-testid="flow-next"
          aria-label="Next handoff"
          data-explain="step"
          disabled={stepIdx === steps.length - 1}
          onClick={nextStep}
        >
          ▶
        </button>
        <input
          type="range"
          aria-label="Replay time"
          data-testid="flow-scrubber"
          min={range.start}
          max={range.end}
          step={Math.max(1, Math.floor((range.end - range.start) / 1000))}
          value={t}
          onChange={(e) => {
            setPlaying(false);
            jump(Number(e.target.value));
          }}
        />
        <span className="label" data-testid="flow-time">
          {t >= range.end ? 'now' : clock(t)} · run {clock(range.start)} → {clock(range.end)}
        </span>
      </div>
      {chapters.length > 0 && (
        <ol className="flow-chapters" aria-label="Chapters" data-testid="flow-chapters">
          {chapters.map((c) => (
            <li key={`${c.kind}-${c.at}`}>
              <button
                type="button"
                className="pill-btn"
                data-testid="flow-chapter"
                aria-current={chapter?.kind === c.kind && chapter.at === c.at ? 'step' : undefined}
                data-explain="replay"
                onClick={() => {
                  setPlaying(false);
                  jump(c.at);
                }}
              >
                {clock(c.at)} · {c.title}
              </button>
            </li>
          ))}
        </ol>
      )}
      <ReplayConsoles machine={machine} rig={rig} at={t} socket={socket} />
    </section>
  );
}
