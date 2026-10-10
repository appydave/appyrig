import { useEffect, useMemo, useRef, useState } from 'react';
import type { FleetMachine } from '@appydave/shared';
import { ago } from '../fleet/model.js';
import { buildFlow, flowChapters, flowRange, rigQueue, type FlowEdge } from '../fleet/views.js';

interface Props {
  machine: FleetMachine | null;
  rig: string | null;
  now: number;
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
    // Below the row, amber: work sent back to an earlier stage.
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

const REPLAY_SECONDS = 40;
/** Replay holds on each chapter for this many 100 ms ticks, so the narration can be read. */
const CHAPTER_HOLD_TICKS = 30;

const clock = (t: number) =>
  new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Concept 4 · Handoff Flow: queue handoffs moving lead → builders → QA → reviewer, as pulses.
 * Amber arcs below the row are rework (a FAIL sent back). The scrubber replays a finished run.
 * A team with no QA or review seat is drawn one box per seat instead of being squashed into roles.
 */
export default function HandoffFlow({ machine, rig, now }: Props) {
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
  const jump = (t: number | null) => {
    atRef.current = t;
    setAt(t);
  };

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
            <b className="amber">{flow.rework}</b> sent back for rework
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

      {chapter && (
        <p className="flow-narration" data-testid="flow-narration" data-kind={chapter.kind}>
          <b>{chapter.title}</b> {chapter.text}
        </p>
      )}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="flow-svg"
        role="img"
        aria-label="Handoff flow diagram"
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
              data-kind={p.kind}
              data-in-flight={e.inFlight.length}
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
                <circle key={q.id} r={6} className={`pulse ${p.kind}`} data-testid="flow-pulse">
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
            </g>
          );
        })}
      </svg>

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
    </section>
  );
}
