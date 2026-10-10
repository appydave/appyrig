import { useEffect, useMemo, useState } from 'react';
import type { FleetMachine } from '@appydave/shared';
import { ago } from '../fleet/model.js';
import {
  buildFlow,
  flowRange,
  rigQueue,
  STAGE_LABEL,
  STAGES,
  type FlowEdge,
  type Stage,
} from '../fleet/views.js';

interface Props {
  machine: FleetMachine | null;
  rig: string | null;
  now: number;
}

const W = 1000;
const H = 400;
const BOX_W = 170;
const BOX_H = 92;
const ROW_Y = 200;
const X: Record<Stage, number> = { lead: 110, build: 370, qa: 630, review: 890 };

/** Path for an edge between stage boxes: straight for forward neighbours, arcs otherwise. */
function edgePath(e: FlowEdge): {
  d: string;
  lx: number;
  ly: number;
  kind: 'forward' | 'report' | 'rework';
} {
  const a = X[e.from];
  const b = X[e.to];
  const gap = Math.abs(STAGES.indexOf(e.to) - STAGES.indexOf(e.from));
  if (!e.rework && b > a && gap === 1) {
    const y = ROW_Y;
    return {
      d: `M${a + BOX_W / 2},${y} L${b - BOX_W / 2},${y}`,
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
  // Above the row: briefs that skip a stage, and reports back to the lead.
  const y0 = ROW_Y - BOX_H / 2;
  // Reports back to the lead fly higher than briefs going out, so A→B and B→A never share a line.
  const rise = (b < a ? 78 : 40) + gap * 18;
  return {
    d: `M${a},${y0} C${a},${y0 - rise} ${b},${y0 - rise} ${b},${y0}`,
    lx: (a + b) / 2,
    ly: y0 - rise * 0.75 - 4,
    kind: b < a ? 'report' : 'forward',
  };
}

const REPLAY_SECONDS = 40;

const clock = (t: number) =>
  new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Concept 4 · Handoff Flow: queue handoffs moving lead → builders → QA → reviewer, as pulses.
 * Amber arcs below the row are rework (a FAIL sent back). The scrubber replays a finished run.
 */
export default function HandoffFlow({ machine, rig, now }: Props) {
  const range = useMemo(
    () => (machine && rig ? flowRange(rigQueue(machine, rig)) : null),
    [machine, rig]
  );
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  // A new rig starts at its end (the current state).
  useEffect(() => {
    setAt(null);
    setPlaying(false);
  }, [machine?.machine.id, rig]);

  useEffect(() => {
    if (!playing || !range) return;
    const step = (range.end - range.start) / (REPLAY_SECONDS * 10);
    const id = window.setInterval(() => {
      setAt((t) => {
        const next = (t ?? range.start) + step;
        if (next >= range.end) {
          setPlaying(false);
          return range.end;
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [playing, range]);

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

  return (
    <section className="flow" data-testid="handoff-flow" aria-label={`Handoff flow of ${rig}`}>
      <div className="flow-stats">
        <span data-testid="flow-total">
          <b>{flow.total}</b> handoffs
        </span>
        <span data-testid="flow-rework">
          <b className="amber">{flow.rework}</b> sent back for rework
        </span>
        <span>
          <b>
            {flow.medianTurnaroundMin === null ? '–' : `${flow.medianTurnaroundMin.toFixed(1)} min`}
          </b>{' '}
          median handoff → close
        </span>
        <span data-testid="flow-bottleneck">
          {flow.bottleneck ? (
            <>
              queue builds at <b className="amber">{STAGE_LABEL[flow.bottleneck]}</b>
            </>
          ) : (
            'nothing waiting'
          )}
        </span>
      </div>

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
          const p = edgePath(e);
          const id = `hf-edge-${i}`;
          return (
            <g
              key={`${e.from}→${e.to}`}
              data-testid="flow-edge"
              data-kind={p.kind}
              data-in-flight={e.inFlight.length}
            >
              <path
                id={id}
                d={p.d}
                className={`flow-edge ${p.kind}`}
                strokeWidth={1.5 + (e.count / max) * 6}
                markerEnd={p.kind === 'rework' ? 'url(#hf-arrow-amber)' : 'url(#hf-arrow)'}
              />
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
        {flow.stages.map((s) => (
          <g key={s.stage} data-testid="flow-stage" data-stage={s.stage} data-waiting={s.waiting}>
            <rect
              x={X[s.stage] - BOX_W / 2}
              y={ROW_Y - BOX_H / 2}
              width={BOX_W}
              height={BOX_H}
              rx={10}
              className={s.waiting ? 'flow-box waiting' : 'flow-box'}
            />
            <text x={X[s.stage]} y={ROW_Y - 14} className="flow-stage-name">
              {STAGE_LABEL[s.stage]}
            </text>
            <text x={X[s.stage]} y={ROW_Y + 8} className="flow-seats">
              {s.seats.length ? s.seats.map((x) => x.model).join(' · ') : 'no seat'}
            </text>
            <text
              x={X[s.stage]}
              y={ROW_Y + 30}
              className={s.waiting ? 'flow-wait amber' : 'flow-wait'}
            >
              {s.waiting
                ? `${s.waiting} waiting · oldest ${ago(s.oldestWaitMs ?? 0)}`
                : 'nothing waiting'}
            </text>
          </g>
        ))}
      </svg>

      <ul className="flow-legend" aria-label="Seats per stage">
        {flow.stages.map((s) => (
          <li key={s.stage}>
            <b>{STAGE_LABEL[s.stage]}</b>{' '}
            {s.seats.map((x) => (
              <span key={x.name} className="chip" data-family={x.family}>
                {x.name}
              </span>
            ))}
          </li>
        ))}
      </ul>

      <div className="flow-replay" data-testid="flow-replay">
        <button
          type="button"
          className="pill-btn cta"
          data-testid="flow-play"
          onClick={() => {
            if (!playing && t >= range.end) setAt(range.start);
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
            setAt(Number(e.target.value));
          }}
        />
        <span className="label" data-testid="flow-time">
          {t >= range.end ? 'now' : clock(t)} · run {clock(range.start)} → {clock(range.end)}
        </span>
      </div>
    </section>
  );
}
