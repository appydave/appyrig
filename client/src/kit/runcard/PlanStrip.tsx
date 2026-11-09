import { useMemo } from 'react';
import type { QueueItem } from '@appydave/shared';
import { choosePlan, type PlanSource, type PlanStep } from '@client/domain/fleet/plan.js';

interface Props {
  /** Plan candidates from the rig's files; null while they are read. */
  sources: PlanSource[] | null;
  items: QueueItem[];
  /** Why there are no files to look in (from rig.files), or null when there are. */
  why: string | null;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });

type Mark = 'done' | 'live' | 'worked' | 'todo';
type Accepted = { phrase: string; item: QueueItem };

/** What each mark shows: its glyph, and the note a screen reader gets. */
const MARKS: Record<Mark, { glyph: string; note: string }> = {
  done: { glyph: '✓', note: ' (accepted)' },
  live: { glyph: '●', note: ' (the newest handoff names it)' },
  worked: { glyph: '◐', note: ' (worked on, no acceptance found)' },
  todo: { glyph: '○', note: ' (not reached: no handoff names it)' },
};

/** Accepted beats live beats named-only beats not reached. */
function markOf(done: boolean, live: boolean, named: boolean): Mark {
  if (done) {
    return 'done';
  }

  if (live) {
    return 'live';
  }

  return named ? 'worked' : 'todo';
}

function titleOf(step: PlanStep, accepted: Accepted | undefined): string {
  const head = `${step.id}: ${step.title}`;

  if (!accepted) {
    return head;
  }

  const by = accepted.item.source?.split('@')[0] ?? '?';

  return `${head}\n✓ “${accepted.phrase}” (${by}, ${clock(accepted.item.createdAt)})`;
}

function StepRow({
  step,
  accepted,
  live,
  mark,
}: {
  step: PlanStep;
  accepted: Accepted | undefined;
  live: boolean;
  mark: Mark;
}) {
  return (
    <li
      className="plan-step"
      data-testid="run-plan-step"
      data-id={step.id}
      data-mark={mark}
      data-live={live || undefined}
      title={titleOf(step, accepted)}
    >
      <span aria-hidden="true">{MARKS[mark].glyph}</span> <b>{step.id}</b>{' '}
      <span className="plan-title">{step.title}</span>
      {accepted && (
        <span className="plan-why" data-testid="run-plan-why">
          {' '}
          · “{accepted.phrase}”, {clock(accepted.item.createdAt)}
        </span>
      )}
      {live && <span className="plan-live"> · latest named</span>}
      <span className="sr-only">{MARKS[mark].note}</span>
    </li>
  );
}

/**
 * Run card R3: the plan as a strip of steps. ✓ a handoff called it accepted; ● the step the
 * newest handoff names; ○ not reached. Says which file the plan came from and how steps were
 * matched; with no plan, says so and shows nothing.
 */
export default function PlanStrip({ sources, items, why }: Props) {
  const plan = useMemo(() => (sources ? choosePlan(sources, items) : null), [sources, items]);

  if (!sources) {
    return <span className="run-from">{why ?? 'reading the rig’s mission and briefs…'}</span>;
  }

  if (!plan) {
    return (
      <span className="run-from" data-testid="run-plan-none">
        {sources.length > 1
          ? `no plan: ${sources.length} files have steps, and no handoff names any of them, so AppyRig won't pick one`
          : `no plan file: no slice table, numbered steps or change orders in its mission or briefs${why && !/next to its rig.yaml/.test(why) ? ` (${why})` : ''}`}
      </span>
    );
  }

  return (
    <div data-testid="run-plan" data-kind={plan.kind}>
      <ol className="plan-strip" aria-label="Plan steps">
        {plan.steps.map((s) => {
          const accepted = plan.done.get(s.id);
          const live = plan.live?.id === s.id;
          // QA R3 MEDIUM-1: named by handoffs but never accepted is "worked on", not "not reached".
          const mark = markOf(!!accepted, live, plan.named.has(s.id));

          return <StepRow key={s.id} step={s} accepted={accepted} live={live} mark={mark} />;
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
