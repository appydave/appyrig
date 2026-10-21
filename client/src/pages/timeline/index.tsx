import { useMemo } from 'react';
import RigPicker from '../../kit/RigPicker.js';
import { DOT_STATE_LABEL, dotState, timeScale } from '../../domain/fleet/timeline.js';
import { PageHeader } from '../../kit/index.js';
import type { PageDef, PageProps } from '../../app/types.js';
import { buildRun, dur, OUTCOME, OUTSIDE_LANE } from '../../domain/timeline/model.js';
import '../w4.css';

const clock = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const day = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

const LANE_H = 28;
const LABEL_W = 150;

/**
 * v2 Run Timeline: the run at a glance. Its outcome first (one word and why), then a compact strip
 * of every seat's handoffs across the run's phases (pauses squeezed out), then each phase in words
 * (when, how long, who did the work) and who waited on whom. Seat names open the agent panel.
 */
function TimelinePage({ ctx }: PageProps) {
  // The rig is the ONE shared choice (App's activeRig), the same on every rig page, old and new:
  // picking here, flipping with B or V, or moving to another page never changes it.
  const rig = ctx.activeRig;
  const fm = rig ? ctx.allMachines.find((m) => m.machine.id === rig.machineId) : undefined;
  const tenMin = Math.floor(ctx.now / 600_000) * 600_000;
  const run = useMemo(() => (fm && rig ? buildRun(fm, rig.name, tenMin) : null), [fm, rig, tenMin]);

  const seat = (name: string) => {
    const key = run?.seatOf[name];

    return key ? (
      <button
        type="button"
        className="w4-seat mono"
        data-testid="tl2-seat"
        data-seat-key={key}
        onClick={() => ctx.openAgentPage(key)}
        title="Open the agent page"
      >
        {name}
      </button>
    ) : (
      <span className="mono">{name}</span>
    );
  };

  return (
    <main className="view w4-page" data-testid="ar-timeline">
      <RigPicker
        rigs={ctx.rigs}
        selected={rig?.key ?? null}
        onSelect={ctx.chooseRig}
        info={false}
      />
      <PageHeader
        title="Run Timeline"
        facts={[
          rig ? `${rig.name} on ${rig.machineLabel}` : 'no rig chosen',
          ...(run ? [`${OUTCOME[run.outcome].glyph} ${OUTCOME[run.outcome].word}`] : []),
          ...(run ? [`${run.timeline.total} handoffs`] : []),
        ]}
      />
      {!rig && <p className="empty">Pick a rig.</p>}
      {rig && !run && (
        <p className="empty" data-testid="tl2-empty">
          {rig.name} has no handoffs in its queue yet, so there is no run to show.
        </p>
      )}
      {run && rig && (
        <>
          <section className="w4-hero" data-testid="tl2-outcome" data-outcome={run.outcome}>
            <span className="w4-hero-big">
              {OUTCOME[run.outcome].glyph} {OUTCOME[run.outcome].word}
            </span>
            <span className="w4-hero-why">{OUTCOME[run.outcome].says}</span>
            <dl className="w4-stats mono">
              <div>
                <dt>handoffs</dt>
                <dd data-testid="tl2-total">{run.timeline.total}</dd>
              </div>
              <div>
                <dt>done / passed on</dt>
                <dd>{run.done}</dd>
              </div>
              <div>
                <dt>still open</dt>
                <dd data-testid="tl2-open">{run.open}</dd>
              </div>
              <div>
                <dt>phases</dt>
                <dd>{run.phases.length}</dd>
              </div>
              <div>
                <dt>working time</dt>
                <dd>{dur(run.activeMs)}</dd>
              </div>
              <div>
                <dt>first → last</dt>
                <dd>
                  {day(run.timeline.start)} {clock(run.timeline.start)} → {day(run.timeline.end)}{' '}
                  {clock(run.timeline.end)}
                </dd>
              </div>
            </dl>
          </section>

          <Strip run={run} />

          <section className="w4-section">
            <h3 className="w4-h">Phases</h3>
            <p className="quiet">A new phase starts after a pause of more than 20 minutes.</p>
            <ol className="tl2-phases" data-testid="tl2-phases">
              {run.phases.map((p) => (
                <li key={p.index} className="w4-card" data-testid="tl2-phase">
                  <b className="w4-num">Phase {p.index}</b>{' '}
                  <span className="mono">
                    {day(p.start)} · {clock(p.start)}–{clock(p.end)}
                  </span>{' '}
                  · {dur(p.end - p.start)} · <span className="mono">{p.count}</span> handoff
                  {p.count === 1 ? '' : 's'}
                  <div className="tl2-senders">
                    Who sent:{' '}
                    {p.senders.slice(0, 5).map((s, i) => (
                      <span key={s.name}>
                        {i > 0 && ', '}
                        {seat(s.name)} <span className="mono">×{s.count}</span>
                      </span>
                    ))}
                  </div>
                  <div className="quiet tl2-firstlast">
                    starts: “{p.first.summary ?? p.first.id}” · ends: “{p.last.summary ?? p.last.id}
                    ” ({DOT_STATE_LABEL[dotState(p.last.state)]})
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="w4-section">
            <h3 className="w4-h">Who waited on whom</h3>
            <p className="quiet">
              Each row: one seat handed work to another and waited. The queue holds no closure time,
              so a closed handoff counts from created to last update; open ones count until now.
            </p>
            {run.waits.length === 0 ? (
              <p className="empty">No handoffs between this rig&apos;s own seats.</p>
            ) : (
              <table className="w4-table" data-testid="tl2-waits">
                <thead>
                  <tr>
                    <th>waited</th>
                    <th>on</th>
                    <th className="num">handoffs</th>
                    <th className="num">median (created → last update)</th>
                    <th className="num">longest</th>
                    <th className="num">open now</th>
                  </tr>
                </thead>
                <tbody>
                  {run.waits.slice(0, 12).map((w) => (
                    <tr key={`${w.from}→${w.to}`} data-testid="tl2-wait">
                      <td>{seat(w.from)}</td>
                      <td>{seat(w.to)}</td>
                      <td className="num mono">{w.count}</td>
                      <td className="num mono">{dur(w.medianMs)}</td>
                      <td className="num mono">{dur(w.longestMs)}</td>
                      <td className="num mono" data-open={w.open > 0 || undefined}>
                        {w.open}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </main>
  );
}

/** Every seat's handoffs on one compact strip, pauses squeezed to a fixed break. */
function Strip({ run }: { run: NonNullable<ReturnType<typeof buildRun>> }) {
  const { timeline } = run;
  const activeMin = run.activeMs / 60_000 + timeline.phases.length * 6;
  const pxPerMin = Math.max(0.3, Math.min(8, 1000 / Math.max(1, activeMin)));
  const scale = timeScale(timeline.phases, pxPerMin);
  const lanes = timeline.lanes;
  const h = lanes.length * LANE_H + 26;

  return (
    <section className="w4-section">
      <h3 className="w4-h">The run on one strip</h3>
      <div className="tl2-strip" data-testid="tl2-strip">
        <svg
          width={LABEL_W + scale.width + 20}
          height={h}
          role="img"
          aria-label="Handoffs per seat over the run"
        >
          {scale.spans.map((s) => (
            <g key={s.phase.index}>
              <rect
                x={LABEL_W + s.x0}
                y={0}
                width={s.x1 - s.x0}
                height={h - 20}
                className="tl2-band"
              />
              <text x={LABEL_W + s.x0 + 4} y={h - 6} className="tl2-tick">
                P{s.phase.index} {clock(s.phase.start)}
              </text>
            </g>
          ))}
          {scale.breaks.map((b, i) => (
            <text key={i} x={LABEL_W + b.x} y={12} className="tl2-break" textAnchor="middle">
              ⋯ {dur(b.gapMs)}
            </text>
          ))}
          {lanes.map((l, i) => (
            <g key={l.id} transform={`translate(0, ${i * LANE_H + 6})`}>
              <text x={4} y={LANE_H / 2 + 4} className="tl2-lane mono">
                {l.id === OUTSIDE_LANE ? 'you / other rigs' : l.label}
              </text>
              <line
                x1={LABEL_W}
                x2={LABEL_W + scale.width}
                y1={LANE_H / 2}
                y2={LANE_H / 2}
                className="tl2-axis"
              />
            </g>
          ))}
          {timeline.marks.map((m, i) => {
            const li = lanes.findIndex((l) => l.id === m.lane);

            return (
              <circle
                key={`${m.item.id}-${m.lane}-${i}`}
                cx={LABEL_W + scale.x(m.at)}
                cy={li * LANE_H + 6 + LANE_H / 2}
                r={4}
                className="tl2-dot"
                data-state={m.state}
              >
                <title>
                  {clock(m.at)} · {m.item.source} → {m.item.destination} · {m.item.state}
                  {m.item.summary ? ` · ${m.item.summary}` : ''}
                </title>
              </circle>
            );
          })}
        </svg>
      </div>
      <p className="quiet tl2-key">
        <span className="tl2-key-dot" data-state="done" /> done{' '}
        <span className="tl2-key-dot" data-state="handed-on" /> handed on{' '}
        <span className="tl2-key-dot" data-state="open" /> still open{' '}
        <span className="tl2-key-dot" data-state="stopped" /> stopped · a pause is squeezed to ⋯
      </p>
    </section>
  );
}

export const page: PageDef = {
  key: 'timeline',
  label: 'Run Timeline',
  group: 'work',
  component: TimelinePage,
  blurb: 'The run at a glance: outcome, phases, who waited on whom.',
};
