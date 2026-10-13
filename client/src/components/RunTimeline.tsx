import { useEffect, useMemo, useRef, useState } from 'react';
import type { FleetMachine, HandoffGetOutput } from '@appydave/shared';
import type { FleetSocket } from '../fleet/useFleet.js';
import {
  BREAK_PX,
  DOT_STATE_LABEL,
  OUTSIDE_LANE,
  buildTimeline,
  followWork,
  stackRows,
  timeScale,
  timeTicks,
  type DotState,
  type TimelineMark,
  type TimelinePhase,
} from '../fleet/timeline.js';
import HandoffPanel, { type PanelSelection } from './HandoffPanel.js';
import FollowWork, { STATE_GLYPH } from './FollowWork.js';

interface Props {
  machine: FleetMachine | null;
  rig: string | null;
  now: number;
  socket?: FleetSocket;
  /** False while something sits on top (a seat panel, an overlay): its keys stand down. */
  keys?: boolean;
}

const AXIS_H = 54;
const LANE_H = 44;
const ROW_DY = 11;
const PAD_X = 16;
const ZOOMS = [2, 4, 8, 16];

const hhmm = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const day = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const who = (raw: string | null) => (raw ?? '?').split('@')[0];
const gapWords = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 120 ? `${m} min` : `${Math.round(m / 60)} h`;
};

/** As much of "Phase 2 · Tue 13 Oct · 10:03 AM–11:15 AM · 46" as fits the band (~6 px a letter). */
function phaseLabel(p: TimelinePhase, px: number, date: string | null): string {
  const tries = [
    `Phase ${p.index} · ${date ? `${date} · ` : ''}${hhmm(p.start)}–${hhmm(p.end)} · ${p.count}`,
    `Phase ${p.index} · ${date ? `${date} · ` : ''}${hhmm(p.start)}`,
    `P${p.index}${date ? ` · ${date}` : ''}`,
    `P${p.index}`,
  ];
  return tries.find((t) => t.length * 6 <= px - 8) ?? '';
}

/** The largest scale that keeps the run within ~1,400 px; the smallest when nothing fits. */
function fitZoom(activeMs: number): number {
  const mins = activeMs / 60_000;
  return [...ZOOMS].reverse().find((z) => mins * z <= 1400) ?? ZOOMS[0]!;
}

function Mark({ state, flag }: { state: DotState; flag: TimelineMark['flag'] }) {
  if (flag === 'in') return <path d="M-6,-5 L6,-5 L0,6 z" className="tl-shape" />;
  if (flag === 'out') return <path d="M-6,5 L6,5 L0,-6 z" className="tl-shape" />;
  if (state === 'handed-on') return <path d="M0,-6 L6,0 L0,6 L-6,0 z" className="tl-shape" />;
  if (state === 'stopped')
    return <rect x={-5} y={-5} width={10} height={10} className="tl-shape" />;
  return <circle r={5} className="tl-shape" />;
}

/**
 * Views V1 · the run timeline: one lane per seat on a time axis, every handoff a mark on the lane
 * of the seat that sent it, shaped and coloured by its state. Items to or from David or another
 * rig are flags on the "you / other rigs" lane. Pauses over 20 minutes split the run into phases
 * (drawn as bands, the pause squeezed to a break). The Flow's "biggest queue" moment is marked.
 * Click a mark (or Tab to it, Enter) for the handoff panel; the timeline scrolls in its own box.
 */
export default function RunTimeline({ machine, rig, now, socket, keys = true }: Props) {
  const tenMin = Math.floor(now / 600_000) * 600_000;
  const tl = useMemo(
    () => (machine && rig ? buildTimeline(machine, rig, tenMin) : null),
    [machine, rig, tenMin]
  );
  const activeMs = tl ? tl.phases.reduce((n, p) => n + (p.end - p.start) + 6 * 60_000, 0) : 0;
  const [zoom, setZoom] = useState<number | null>(null);
  const z = zoom ?? fitZoom(activeMs);
  const [sel, setSel] = useState<{ lane: string; itemId: string } | null>(null);
  const [follow, setFollow] = useState<string | null>(null);
  const bodies = useRef(new Map<string, HandoffGetOutput>());
  const scroller = useRef<HTMLDivElement>(null);

  // A new rig starts fresh, at its own fitting scale.
  useEffect(() => {
    setSel(null);
    setFollow(null);
    setZoom(null);
  }, [machine?.machine.id, rig]);

  // Esc closes the panel first (capture, so the screen-level Esc never also goes back).
  useEffect(() => {
    if (!sel || follow || !keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      setSel(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sel, follow, keys]);

  const chain = useMemo(
    () => (machine && rig && follow ? followWork(machine, rig, follow) : null),
    [machine, rig, follow]
  );
  const inChain = useMemo(() => new Set(chain?.steps.map((s) => s.item.id) ?? []), [chain]);

  if (!machine || !rig) {
    return (
      <p className="quiet" data-testid="timeline-empty">
        Pick a rig above to see its run.
      </p>
    );
  }
  if (!tl) {
    return (
      <p className="quiet" data-testid="timeline-empty">
        {rig} has no handoffs through the queue yet, so there is no run to draw.
      </p>
    );
  }

  const scale = timeScale(tl.phases, z);
  const { rows, perLane } = stackRows(tl.marks, scale.x);
  // A lane grows by a row for each mark sent too close to the one before it (a fan-out).
  const laneH = tl.lanes.map((l) => Math.max(LANE_H, ((perLane.get(l.id) ?? 1) + 1) * ROW_DY + 12));
  const laneTop = laneH.map((_, i) => AXIS_H + laneH.slice(0, i).reduce((a, b) => a + b, 0));
  const laneY = (i: number) => laneTop[i]! + laneH[i]! / 2;
  const rowY = (i: number, row: number, n: number) =>
    laneTop[i]! + laneH[i]! / 2 + (row - (n - 1) / 2) * ROW_DY;
  const laneIndex = new Map(tl.lanes.map((l, i) => [l.id, i]));
  const width = scale.width + PAD_X * 2;
  const height = AXIS_H + laneH.reduce((a, b) => a + b, 0) + 8;
  const X = (t: number) => PAD_X + scale.x(t);
  const multiDay = day(tl.start) !== day(tl.end);
  // A phase on a new day names its date, so a run over two days reads right.
  const newDay = (i: number) =>
    multiDay && (i === 0 || day(tl.phases[i]!.start) !== day(tl.phases[i - 1]!.end));

  const lane = sel ? tl.lanes.find((l) => l.id === sel.lane) : null;
  const selection: PanelSelection | null =
    sel && lane
      ? {
          edge: null,
          title:
            lane.id === OUTSIDE_LANE
              ? 'In from and out to you / other rigs'
              : `Sent by ${lane.label}`,
          items: lane.items,
          itemId: sel.itemId,
        }
      : null;

  const pick = (m: TimelineMark) => {
    setFollow(null);
    setSel({ lane: m.lane, itemId: m.item.id });
  };
  const peakX = tl.peak ? X(tl.peak.at) : null;

  return (
    <section className="timeline" data-testid="run-timeline" aria-label={`Run timeline of ${rig}`}>
      <div className="flow-stats">
        <span data-testid="timeline-total">
          <b>{tl.total}</b> handoffs
        </span>
        <span data-testid="timeline-phases">
          <b>{tl.phases.length}</b> phase{tl.phases.length === 1 ? '' : 's'} ·{' '}
          {multiDay ? `${day(tl.start)} ` : ''}
          {hhmm(tl.start)} – {multiDay ? `${day(tl.end)} ` : ''}
          {hhmm(tl.end)}
        </span>
        {tl.peak && (
          <span data-testid="timeline-peak-stat">
            Biggest queue <b>{hhmm(tl.peak.at)}</b>
          </span>
        )}
        <span className="tl-zoom" role="group" aria-label="Timeline scale">
          <button
            type="button"
            className="pill-btn"
            data-testid="timeline-zoom-out"
            aria-label="Zoom out"
            disabled={z <= ZOOMS[0]!}
            onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)]!)}
          >
            −
          </button>
          <span data-testid="timeline-zoom">{z} px per minute</span>
          <button
            type="button"
            className="pill-btn"
            data-testid="timeline-zoom-in"
            aria-label="Zoom in"
            disabled={z >= ZOOMS[ZOOMS.length - 1]!}
            onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)]!)}
          >
            +
          </button>
        </span>
      </div>
      {tl.peak && (
        <p className="flow-narration" data-testid="timeline-peak-text" data-kind="peak">
          <b>Biggest queue.</b> {tl.peak.text}
        </p>
      )}
      <div className="flow-row">
        <div className="tl-frame">
          <ul className="tl-labels" aria-hidden="true" style={{ paddingTop: AXIS_H }}>
            {tl.lanes.map((l, i) => (
              <li
                key={l.id}
                className="tl-label"
                style={{ height: laneH[i] }}
                data-outside={l.outside || undefined}
                title={`${l.label}: ${l.items.length} handoff${l.items.length === 1 ? '' : 's'}`}
              >
                <span>{l.label}</span>
                <span className="quiet">{l.items.length}</span>
              </li>
            ))}
          </ul>
          <div className="tl-scroll" ref={scroller} data-testid="timeline-scroll">
            <svg
              width={width}
              height={height}
              className="tl-svg"
              role="group"
              aria-label={`${tl.total} handoffs on ${tl.lanes.length} lanes, oldest on the left`}
            >
              {scale.spans.map((s, i) => (
                <g key={s.phase.index} data-testid="timeline-phase" data-phase={s.phase.index}>
                  <rect
                    x={PAD_X + s.x0}
                    y={0}
                    width={s.x1 - s.x0}
                    height={height}
                    className="tl-phase"
                    data-odd={i % 2 === 1 || undefined}
                  />
                  <text x={PAD_X + s.x0 + 4} y={13} className="tl-phase-label">
                    {phaseLabel(s.phase, s.x1 - s.x0, newDay(i) ? day(s.phase.start) : null)}
                  </text>
                  <title>
                    Phase {s.phase.index}: {day(s.phase.start)} {hhmm(s.phase.start)}–
                    {hhmm(s.phase.end)}, {s.phase.count} handoff{s.phase.count === 1 ? '' : 's'}
                  </title>
                </g>
              ))}
              {scale.breaks.map((b) => (
                <g key={b.x} data-testid="timeline-break">
                  <line
                    x1={PAD_X + b.x}
                    x2={PAD_X + b.x}
                    y1={AXIS_H - 20}
                    y2={height}
                    className="tl-break"
                  />
                  <text x={PAD_X + b.x} y={AXIS_H - 26} className="tl-break-label">
                    ⋯ {gapWords(b.gapMs)}
                  </text>
                </g>
              ))}
              {timeTicks(tl.phases, z).map((t) => (
                <g key={t}>
                  <line x1={X(t)} x2={X(t)} y1={AXIS_H - 6} y2={AXIS_H} className="tl-tick" />
                  <text x={X(t)} y={AXIS_H - 12} className="tl-tick-label">
                    {hhmm(t)}
                  </text>
                </g>
              ))}
              {tl.lanes.map((l, i) => (
                <line
                  key={l.id}
                  x1={0}
                  x2={width}
                  y1={laneY(i)}
                  y2={laneY(i)}
                  className="tl-lane"
                  data-outside={l.outside || undefined}
                />
              ))}
              {peakX !== null && tl.peak && (
                <g
                  className="tl-peak"
                  data-testid="timeline-peak"
                  data-at={new Date(tl.peak.at).toISOString()}
                >
                  <line x1={peakX} x2={peakX} y1={AXIS_H - 4} y2={height} />
                  <text x={peakX + 4} y={height - 6}>
                    ▲ Biggest queue {hhmm(tl.peak.at)}
                  </text>
                  <title>{tl.peak.text}</title>
                </g>
              )}
              {tl.marks.map((m, i) => {
                const li = laneIndex.get(m.lane) ?? 0;
                const y = rowY(li, rows[i]!, perLane.get(m.lane) ?? 1);
                const x = X(m.at);
                const label = `${hhmm(m.at)} · ${who(m.item.source)} → ${who(m.item.destination)} · ${DOT_STATE_LABEL[m.state]}${m.flag ? ` · ${m.flag === 'in' ? 'came in' : 'went out'}` : ''} · ${m.item.summary ?? m.item.id}`;
                return (
                  <g
                    key={`${m.lane}:${m.item.id}`}
                    transform={`translate(${x},${y})`}
                    className="tl-mark"
                    data-testid="timeline-mark"
                    data-id={m.item.id}
                    data-state={m.state}
                    data-flag={m.flag ?? undefined}
                    data-selected={(sel?.itemId === m.item.id && sel.lane === m.lane) || undefined}
                    data-chain={inChain.has(m.item.id) || undefined}
                    role="button"
                    tabIndex={0}
                    aria-label={label}
                    onClick={() => pick(m)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        pick(m);
                      }
                    }}
                  >
                    <circle r={9} className="tl-hit" />
                    <Mark state={m.state} flag={m.flag} />
                    <title>{label}</title>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
        {chain && follow ? (
          <FollowWork
            machineId={machine.machine.id}
            chain={chain}
            fromId={follow}
            socket={socket}
            cache={bodies.current}
            onClose={() => setFollow(null)}
          />
        ) : (
          <HandoffPanel
            machineId={machine.machine.id}
            selection={selection}
            mode="pinned"
            pinned={false}
            socket={socket}
            cache={bodies.current}
            showMode={false}
            onPick={(id) => sel && setSel({ ...sel, itemId: id })}
            onMode={() => undefined}
            onClose={() => setSel(null)}
            onFollow={setFollow}
            keys={keys}
            lineWord="lane"
            onLine={(dir) => {
              // Views K: on the timeline a "line" is a lane: ] / [ = next / previous lane, newest.
              const order = tl.lanes.filter((l) => l.items.length);
              const i = order.findIndex((l) => l.id === sel?.lane);
              const next = order[(i + dir + order.length) % order.length];
              if (next) setSel({ lane: next.id, itemId: next.items[next.items.length - 1]!.id });
            }}
          />
        )}
      </div>
      <ul className="tl-key" aria-label="What the marks mean" data-testid="timeline-key">
        {(['done', 'handed-on', 'open', 'stopped'] as const).map((s) => (
          <li key={s} className="tl-state" data-state={s}>
            {STATE_GLYPH[s]} {DOT_STATE_LABEL[s]}
          </li>
        ))}
        <li>▼ came in from you / another rig</li>
        <li>▲ went out to you / another rig</li>
        <li>
          Bands = phases (a pause over 20 min starts a new one; the pause is squeezed to {BREAK_PX}{' '}
          px)
        </li>
      </ul>
    </section>
  );
}
