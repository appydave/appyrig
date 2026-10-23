import { type QueueItem } from '@appydave/shared';
import { modelChip, seatKey, seatName } from '@client/domain/fleet/model.js';
import { OUTSIDE, roleLabel, stageOf } from '@client/domain/fleet/views/flow/stages.js';
import {
  type FlowLayout,
  type FlowMode,
  type FlowRun,
  type FlowStageView,
} from '@client/domain/fleet/views/flow/types.js';
import { ms } from '@client/domain/fleet/views/core/time.js';

export function stageViews(run: FlowRun): FlowStageView[] {
  const seatsBy = seatsByNode(run);
  const hasLead = hasLeadRole(run);

  return run.layout.order.map((id) => stageView(run, { id, seatsBy, hasLead }));
}

/** The rig's seats, each under the box it sits in. */
function seatsByNode(run: FlowRun): Map<string, FlowStageView['seats']> {
  const { rigSeats, mode, nodeOf } = run.layout;
  const seatsBy = new Map<string, FlowStageView['seats']>();

  for (const s of rigSeats) {
    const id = mode === 'roles' ? stageOf(seatName(s)) : nodeOf(`${seatName(s)}@${run.rig}`);
    const chip = modelChip(s);

    seatsBy.set(id, [
      ...(seatsBy.get(id) ?? []),
      {
        name: seatName(s),
        key: seatKey(run.fm.machine.id, s.id),
        family: chip.family,
        model: chip.text,
      },
    ]);
  }

  return seatsBy;
}

/** A lead exists when a seat of the rig, or an endpoint of the rig's queue, reads as one. */
function hasLeadRole(run: FlowRun): boolean {
  const { rigSeats, inRig, nameOf } = run.layout;

  return (
    rigSeats.some((s) => stageOf(seatName(s)) === 'lead') ||
    run.items.some((q) =>
      [q.source, q.destination].some((raw) => inRig(raw) && stageOf(nameOf(raw)) === 'lead')
    )
  );
}

interface StageParts {
  id: string;
  seatsBy: Map<string, FlowStageView['seats']>;
  hasLead: boolean;
}

function stageView(run: FlowRun, parts: StageParts): FlowStageView {
  const { id, seatsBy, hasLead } = parts;
  const { mode } = run.layout;
  const w = run.waiting.get(id) ?? [];
  const st = run.stale.get(id) ?? [];

  return {
    stage: id,
    label: boxLabel(mode, id),
    seats: seatsBy.get(id) ?? [],
    outside: isOutsideBox(run.layout, id),
    noLead: mode === 'roles' && id === 'lead' && !hasLead,
    waiting: w.length,
    oldestWaitMs: oldestAge(w, run.at),
    stale: st.length,
    oldestStaleMs: oldestAge(st, run.at),
  };
}

/** A role's name in roles mode, the seat's name in seats mode. */
function boxLabel(mode: FlowMode, id: string): string {
  return mode === 'roles' ? roleLabel(id) : id;
}

/** Roles mode: the outside box. Seats mode: an endpoint that is not a seat of the rig (not "others"). */
function isOutsideBox(layout: FlowLayout, id: string): boolean {
  return layout.mode === 'roles'
    ? id === OUTSIDE
    : id !== 'others' && !layout.rigSeats.some((s) => seatName(s) === id);
}

/** How long the oldest of these items had been waiting at the replay time, or null for none. */
function oldestAge(list: QueueItem[], at: number): number | null {
  return list.reduce<number | null>((acc, q) => {
    const age = at - ms(q.createdAt);

    return acc === null || age > acc ? age : acc;
  }, null);
}

/** The box holding the most fresh waiting items, if any. */
export function bottleneckOf(stages: FlowStageView[]): string | null {
  const top = [...stages].sort((a, b) => b.waiting - a.waiting)[0];

  return top && top.waiting > 0 ? top.stage : null;
}
