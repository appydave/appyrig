import { useEffect, useMemo, useRef, useState } from 'react';
import type { FleetMachine, HandoffGetOutput, RigEntry, RigEntryOutput } from '@appydave/shared';
import { ago } from '../fleet/model.js';
import { callVerb } from '../fleet/coreCall.js';
import type { FleetSocket } from '../fleet/useFleet.js';
import {
  buildFlow,
  flowChapters,
  flowRange,
  replaySteps,
  rigQueue,
  stageOf,
  type FlowEdge,
} from '../fleet/views.js';
import ReplayConsoles from './ReplayConsoles.js';
import HandoffPanel, { type PanelMode, type PanelSelection } from './HandoffPanel.js';
import { isShortcutBlocked, isSlider } from '../lib/keys.js';

interface Props {
  machine: FleetMachine | null;
  rig: string | null;
  now: number;
  /** For the consoles' seat.history calls; without it the consoles show handoffs only. */
  socket?: FleetSocket;
  /** S2: ← → step through handoffs. Off while an overlay owns the keyboard. */
  keys?: boolean;
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

/** Path for an edge between boxes: straight for forward neighbours, arcs otherwise. */
function edgePath(
  e: FlowEdge,
  L: Layout
): {
  d: string;
  lx: number;
  ly: number;
  kind: 'forward' | 'report' | 'rework';
} {
  const a = L.x(e.from);
  const b = L.x(e.to);
  const gap = Math.abs(L.idx(e.to) - L.idx(e.from));
  if (!e.rework && b > a && gap === 1) {
    const y = ROW_Y;
    return {
      d: `M${a + L.boxW / 2},${y} L${b - L.boxW / 2},${y}`,
      lx: (a + b) / 2,
      ly: y - 10,
      kind: 'forward',
    };
  }
  if (e.rework) {
    // Below the row, amber: anything sent back to an earlier stage (rework, verdicts, answers).
    const y0 = ROW_Y + BOX_H / 2;
    const dip = 70 + gap * 28;
    return {
      d: `M${a},${y0} C${a},${y0 + dip} ${b},${y0 + dip} ${b},${y0}`,
      lx: (a + b) / 2,
      ly: y0 + dip * 0.75 + 4,
      kind: 'rework',
    };
  }
  // Above the row: briefs that skip a stage, and reports going back.
  const y0 = ROW_Y - BOX_H / 2;
  // Going back flies higher than going out, so A→B and B→A never share a line.
  const rise = (b < a ? 78 : 40) + gap * 18;
  return {
    d: `M${a},${y0} C${a},${y0 - rise} ${b},${y0 - rise} ${b},${y0}`,
    lx: (a + b) / 2,
    ly: y0 - rise * 0.75 - 4,
    kind: b < a ? 'report' : 'forward',
  };
}

const EXPLAIN_EDGE = { forward: 'flow-forward', report: 'flow-report', rework: 'rework' } as const;

const PANEL_KEY = 'appyrig.handoffPanel';
function readPanelMode(): PanelMode {
  try {
    return localStorage.getItem(PANEL_KEY) === 'pinned' ? 'pinned' : 'hover';
  } catch {
    return 'hover';
  }
}

/**
 * S4: how the first seat to act was woken, in calm words. Nearly every rig starts at launch,
 * which is normal, so that case reads as a fact, not an alarm.
 */
export function entryWords(e: RigEntry): string | null {
  if (e.status === 'unknown' || !e.entry) return null;
  if (e.status === 'via-queue') return 'came in through the queue';
  switch (e.entry.origin) {
    case 'startup':
      return 'started at launch, not via the queue';
    case 'typed':
      return 'a prompt typed into the seat, not via the queue';
    case 'send':
      return 'a direct message from another seat, not via the queue';
    case 'system':
      return 'an OpenRig system message, not via the queue';
    case 'compaction':
      return 'resumed after a context compaction, not via the queue';
    case 'skill':
      return "a skill's instructions, not via the queue";
    default:
      return 'not via the queue';
  }
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
export default function HandoffFlow({ machine, rig, now, socket, keys = true }: Props) {
  // S4: the handoff detail panel. `sel` names a line (edge key) and/or one item on it.
  const [sel, setSel] = useState<{ edge: string | null; itemId: string | null } | null>(null);
  const [pinned, setPinned] = useState(false);
  const [mode, setMode] = useState<PanelMode>(readPanelMode);
  const bodies = useRef(new Map<string, HandoffGetOutput>());
  const [entry, setEntry] = useState<RigEntry | null>(null);
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
    () => (machine && rig ? flowChapters(machine, rig, tenMin) : []),
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
    setSel(null);
    setPinned(false);
    if (!socket || !machineId || !rig) return;
    let current = true;
    void callVerb<RigEntryOutput>(socket, 'rig.entry', { machine: machineId, rig }).then((a) => {
      if (current && a.ok) setEntry(a.value.entry);
    });
    return () => {
      current = false;
    };
  }, [socket, machineId, rig]);

  // S4: Esc closes the panel first (capture, so the screen-level Esc never also goes back).
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setSel(null);
      setPinned(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sel]);

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
  const flow = buildFlow(machine, rig, t, now)!;
  const max = Math.max(1, ...flow.edges.map((e) => e.count));
  const L = layoutFor(flow.stages.map((s) => s.stage));
  const labelOf = (id: string) => flow.stages.find((s) => s.stage === id)?.label ?? id;
  const staleStages = flow.stages.filter((s) => s.stale > 0);
  // During a replay, narrate the latest chapter reached.
  const chapter = at === null ? null : ([...chapters].reverse().find((c) => c.at <= t) ?? null);
  const stepItem = stepIdx >= 0 ? steps[stepIdx]! : null;
  const edgeKey = (e: FlowEdge) => `${e.from}→${e.to}`;
  const selection: PanelSelection | null = (() => {
    if (!sel) return null;
    const edge =
      (sel.edge && flow.edges.find((e) => edgeKey(e) === sel.edge)) ||
      (sel.itemId && flow.edges.find((e) => e.items.some((q) => q.id === sel.itemId))) ||
      null;
    if (!edge || !edge.items.length) return null;
    const itemId =
      sel.itemId && edge.items.some((q) => q.id === sel.itemId)
        ? sel.itemId
        : edge.items[edge.items.length - 1]!.id;
    return {
      edge: edgeKey(edge),
      title: `${labelOf(edge.from)} → ${labelOf(edge.to)} · ${edge.count} handoff${edge.count === 1 ? '' : 's'}`,
      items: edge.items,
      itemId,
    };
  })();
  const peek = (edge: string, itemId: string | null = null) => {
    if (!pinned) setSel({ edge, itemId });
  };
  const unpeek = () => {
    if (!pinned && mode === 'hover') setSel(null);
  };
  const pin = (edge: string, itemId: string | null = null) => {
    setSel({ edge, itemId });
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
      className="flow"
      data-testid="handoff-flow"
      data-mode={flow.mode}
      aria-label={`Handoff flow of ${rig}`}
    >
      <div className="flow-stats">
        <span data-testid="flow-total" data-explain="handoff">
          <b>{flow.total}</b> handoffs
        </span>
        {flow.mode === 'roles' && (
          <span data-testid="flow-rework" data-explain="rework">
            <b className="amber">{flow.rework}</b> sent back
          </span>
        )}
        <span data-explain="median-turnaround">
          <b>
            {flow.medianTurnaroundMin === null ? '–' : `${flow.medianTurnaroundMin.toFixed(1)} min`}
          </b>{' '}
          median handoff → close
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
      <p className="view-caption" data-explain={flow.mode === 'roles' ? 'stage' : 'seat-mode'}>
        {flow.mode === 'roles'
          ? 'Stages are read from seat names: qa → QA, review / r1 → Reviewer, lead / orch → Lead, the rest → Builders.'
          : 'No QA or review seat in this rig, so each seat is its own box, in the order it first handed work on.'}
      </p>

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
              markerWidth="11"
              markerHeight="11"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 z" className="flow-arrowhead" />
            </marker>
            <marker
              id="hf-arrow-amber"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="11"
              markerHeight="11"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 z" className="flow-arrowhead amber" />
            </marker>
          </defs>
          {flow.edges.map((e, i) => {
            const p = edgePath(e, L);
            const id = `hf-edge-${i}`;
            return (
              <g
                key={`${e.from}→${e.to}`}
                data-testid="flow-edge"
                data-edge={edgeKey(e)}
                data-kind={p.kind}
                data-in-flight={e.inFlight.length}
                data-selected={selection?.edge === edgeKey(e) || undefined}
                tabIndex={0}
                role="button"
                aria-label={`${labelOf(e.from)} to ${labelOf(e.to)}: ${e.count} handoff${e.count === 1 ? '' : 's'}. Enter pins the details.`}
                onPointerEnter={() => peek(edgeKey(e))}
                onPointerLeave={unpeek}
                onFocus={() => peek(edgeKey(e))}
                onBlur={unpeek}
                onClick={() => pin(edgeKey(e))}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    pin(edgeKey(e));
                  }
                }}
                data-explain={EXPLAIN_EDGE[p.kind]}
                data-explain-ctx={`${labelOf(e.from)} → ${labelOf(e.to)} · ${e.count} handoff${e.count === 1 ? '' : 's'}`}
              >
                <path
                  id={id}
                  d={p.d}
                  className={`flow-edge ${p.kind}`}
                  strokeWidth={1.5 + (e.count / max) * 6}
                  markerEnd={p.kind === 'rework' ? 'url(#hf-arrow-amber)' : 'url(#hf-arrow)'}
                />
                {/* A wide invisible stroke so the line is easy to hover. */}
                <path d={p.d} className="hit" />
                <text x={p.lx} y={p.ly} className={`flow-count ${p.kind}`}>
                  {e.count}
                  {p.kind === 'rework' ? ' back' : ''}
                </text>
                {e.inFlight.slice(0, 6).map((q, k) => (
                  <circle
                    key={q.id}
                    r={6}
                    className={`pulse ${p.kind}`}
                    data-testid="flow-pulse"
                    data-item={q.id}
                    onPointerEnter={() => peek(edgeKey(e), q.id)}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      pin(edgeKey(e), q.id);
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
          {flow.stages.map((s) => {
            const x = L.x(s.stage);
            const state = s.waiting ? 'waiting' : s.stale ? 'stale' : '';
            return (
              <g
                key={s.stage}
                data-testid="flow-stage"
                data-stage={s.stage}
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
                  className={`flow-box ${state}`}
                />
                <text
                  x={x}
                  y={ROW_Y - 14}
                  className={flow.mode === 'roles' ? 'flow-stage-name' : 'flow-seat-name'}
                >
                  {s.label}
                </text>
                <text x={x} y={ROW_Y + 8} className="flow-seats">
                  {s.seats.length
                    ? s.seats.map((x) => x.model).join(' · ')
                    : s.outside
                      ? 'outside this rig'
                      : s.stage === 'others'
                        ? 'quieter seats'
                        : 'no seat'}
                </text>
                <text
                  x={x}
                  y={ROW_Y + 30}
                  className={`flow-wait ${state === 'waiting' ? 'amber' : ''}`}
                >
                  {s.waiting
                    ? `${s.waiting} waiting · oldest ${ago(s.oldestWaitMs ?? 0)}`
                    : s.stale
                      ? `${s.stale} left open · ${ago(s.oldestStaleMs ?? 0)}`
                      : 'nothing waiting'}
                </text>
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
        <HandoffPanel
          machineId={machine.machine.id}
          selection={selection}
          mode={mode}
          pinned={pinned}
          socket={socket}
          cache={bodies.current}
          onPick={(id) => selection && setSel({ edge: selection.edge, itemId: id })}
          onMode={chooseMode}
          onClose={() => {
            setSel(null);
            setPinned(false);
          }}
        />
      </div>

      {flow.mode === 'roles' && (
        <ul className="flow-legend" aria-label="Seats per stage">
          {flow.stages.map((s) => (
            <li key={s.stage}>
              <b>{s.label}</b>{' '}
              {s.seats.map((x) => (
                <span key={x.name} className="chip" data-family={x.family} data-explain="model">
                  {x.name}
                </span>
              ))}
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
