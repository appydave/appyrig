import { type QueueItem } from '@appydave/shared';
import { type FlowMode, type Stage } from '@client/domain/fleet/views/flow/types.js';

const STAGES: Stage[] = ['lead', 'build', 'qa', 'review'];

/**
 * Roles mode only: senders and receivers that are not in this rig (openrig-orch, David / human, a
 * seat of another rig) sit in their own box at the left edge, never inside the Lead stage.
 */
export const OUTSIDE = 'outside';

const OUTSIDE_LABEL = 'From outside the rig';

const STAGE_LABEL: Record<Stage, string> = {
  lead: 'Lead',
  build: 'Builders',
  qa: 'QA',
  review: 'Reviewer',
};

function isStage(id: string): id is Stage {
  return Object.hasOwn(STAGE_LABEL, id);
}

/** The box title in roles mode: a role's name, or the outside box's. */
export function roleLabel(id: string): string {
  if (id === OUTSIDE) {
    return OUTSIDE_LABEL;
  }

  return isStage(id) ? STAGE_LABEL[id] : id;
}

/** Role from the seat's name: the convention every rig so far follows (orch-lead, dev-qa, review-r1). */
export function stageOf(name: string): Stage {
  const n = name.toLowerCase();

  if (/(^|-)qa(-|$)|tester/.test(n)) {
    return 'qa';
  }

  if (/(^|-)review|(^|-)r\d+$/.test(n)) {
    return 'review';
  }

  if (/orch|lead|boss|operator|advisor|kernel/.test(n)) {
    return 'lead';
  }

  return 'build';
}

export function flowModeOf(names: string[]): FlowMode {
  return names.some((n) => ['qa', 'review'].includes(stageOf(n))) ? 'roles' : 'seats';
}

/** Roles mode: anyone outside the rig gets their own box, at the left edge (only when there is one). */
export function rolesOrder(items: QueueItem[], inRig: (raw: string | null) => boolean): string[] {
  const hasOutside = items.some((q) => !inRig(q.source) || !inRig(q.destination));

  return hasOutside ? [OUTSIDE, ...STAGES] : STAGES;
}
