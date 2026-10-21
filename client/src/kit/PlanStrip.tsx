import { useMemo } from 'react';
import type { QueueItem } from '@appydave/shared';
import { choosePlan, type PlanSource } from '../domain/fleet/plan.js';

interface Props {
  /** Plan candidates from the rig's files; null while they are read. */
  sources: PlanSource[] | null;
  items: QueueItem[];
  /** Why there are no files to look in (from rig.files), or null when there are. */
  why: string | null;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Run card R3: the plan as a strip of steps. ✓ a handoff called it accepted; ● the step the
 * newest handoff names; ○ not reached. Says which file the plan came from and how steps were
 * matched; with no plan, says so and shows nothing.
 */
export default function PlanStrip({ sources, items, why }: Props) {
  const plan = useMemo(() => (sources ? choosePlan(sources, items) : null), [sources, items]);
  if (!sources)
    return <span className="run-from">{why ?? 'reading the rig’s mission and briefs…'}</span>;
  if (!plan)
    return (
      <span className="run-from" data-testid="run-plan-none">
        {sources.length > 1
          ? `no plan: ${sources.length} files have steps, and no handoff names any of them, so AppyRig won't pick one`
          : `no plan file: no slice table, numbered steps or change orders in its mission or briefs${why && !/next to its rig.yaml/.test(why) ? ` (${why})` : ''}`}
      </span>
    );
  return (
    <div data-testid="run-plan" data-kind={plan.kind}>
      <ol className="plan-strip" aria-label="Plan steps">
        {plan.steps.map((s) => {
          const accepted = plan.done.get(s.id);
          const done = !!accepted;
          const live = plan.live?.id === s.id;
          // QA R3 MEDIUM-1: named by handoffs but never accepted is "worked on", not "not reached".
          const worked = !done && !live && plan.named.has(s.id);
          const mark = done ? 'done' : live ? 'live' : worked ? 'worked' : 'todo';
          return (
            <li
              key={s.id}
              className="plan-step"
              data-testid="run-plan-step"
              data-id={s.id}
              data-mark={mark}
              data-live={live || undefined}
              title={`${s.id}: ${s.title}${accepted ? `\n✓ “${accepted.phrase}” (${accepted.item.source?.split('@')[0] ?? '?'}, ${clock(accepted.item.createdAt)})` : ''}`}
            >
              <span aria-hidden="true">{done ? '✓' : live ? '●' : worked ? '◐' : '○'}</span>{' '}
              <b>{s.id}</b> <span className="plan-title">{s.title}</span>
              {accepted && (
                <span className="plan-why" data-testid="run-plan-why">
                  {' '}
                  · “{accepted.phrase}”, {clock(accepted.item.createdAt)}
                </span>
              )}
              {live && <span className="plan-live"> · latest named</span>}
              <span className="sr-only">
                {done
                  ? ' (accepted)'
                  : live
                    ? ' (the newest handoff names it)'
                    : worked
                      ? ' (worked on, no acceptance found)'
                      : ' (not reached: no handoff names it)'}
              </span>
            </li>
          );
        })}
      </ol>
      <span className="run-from">
        from {plan.file}
        {plan.live
          ? ` · ● = the step the newest handoff names (${clock(plan.live.item.createdAt)})`
          : ' · no handoff names these steps yet'}
        {
          ' · ✓ = a handoff said PASS for merge, accepted, merged, deployed, done or REPORT right next to the step id (shown on the chip) · ◐ = named, no acceptance found · ○ = no handoff names it'
        }
      </span>
    </div>
  );
}
