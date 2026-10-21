import { useMemo } from 'react';
import type { FleetMachine } from '@appydave/shared';
import { buildRun as buildTimeline, dur, OUTCOME } from '../../domain/timeline/model.js';
import { clock, type RunModel } from '../../domain/run/model.js';

const hhmm = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Run board, after the run: "How the run went". Shown once at least one job is accepted. The
 * verdict line and stat row are the v2 Run Timeline's (same model, read-only), then one row per job
 * with its time and rounds, then the biggest-queue moment from V1. The Run Timeline page itself is
 * unchanged.
 */
export default function HowRunWent({
  fm,
  rig,
  run,
  now,
}: {
  fm: FleetMachine;
  rig: string;
  run: RunModel;
  now: number;
}) {
  const tenMin = Math.floor(now / 600_000) * 600_000;
  const tl = useMemo(() => buildTimeline(fm, rig, tenMin), [fm, rig, tenMin]);
  const doneJobs = run.jobs.filter((j) => j.status === 'done');
  if (run.sample || doneJobs.length === 0) return null;
  const peak = tl?.timeline.peak ?? null;
  return (
    <section className="run-after" data-testid="run-after" aria-label="How the run went">
      <div className="run-label">How the run went</div>
      {tl && (
        <div className="run-after-top" data-testid="run-after-verdict" data-outcome={tl.outcome}>
          <b className="run-after-big">
            {OUTCOME[tl.outcome].glyph} {OUTCOME[tl.outcome].word}
          </b>
          <span className="quiet">{OUTCOME[tl.outcome].says}</span>
          <dl className="run-after-stats mono" data-testid="run-after-stats">
            <div>
              <dt>handoffs</dt>
              <dd>{tl.timeline.total}</dd>
            </div>
            <div>
              <dt>done / passed on</dt>
              <dd>{tl.done}</dd>
            </div>
            <div>
              <dt>still open</dt>
              <dd>{tl.open}</dd>
            </div>
            <div>
              <dt>phases</dt>
              <dd>{tl.phases.length}</dd>
            </div>
            <div>
              <dt>working time</dt>
              <dd>{dur(tl.activeMs)}</dd>
            </div>
          </dl>
        </div>
      )}
      <ol className="run-after-jobs" data-testid="run-after-jobs">
        {run.jobs.map((j) => (
          <li key={j.job.slice} data-testid="run-after-job" data-status={j.status}>
            <b className="mono">Job {j.job.slice}</b> <span>{j.job.title}</span>
            {j.status === 'waiting' ? (
              <span className="quiet"> · not started</span>
            ) : (
              <span className="mono">
                {' · '}
                {clock(j.durationMs)}
                {j.status === 'current' ? ' so far' : ''}
                {' · '}
                {j.rounds} {j.rounds === 1 ? 'round' : 'rounds'}
                {j.rework > 0 ? ` · ↺${j.rework} sent back` : ''}
              </span>
            )}
          </li>
        ))}
      </ol>
      {peak && (
        <p className="run-after-peak" data-testid="run-after-peak">
          <b>▲ Biggest queue {hhmm(peak.at)}</b> <span className="quiet">{peak.text}</span>
        </p>
      )}
    </section>
  );
}
