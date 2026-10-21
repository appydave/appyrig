import type { RigRef } from './views.js';

/**
 * The rig every rig page lands on when nobody has chosen one: a rig that is up first (a stopped or
 * asleep rig is the past), then the one with the most handoffs, then the most recent activity.
 * Never an empty rig while a busier one exists. App holds the ONE shared choice; this only decides
 * its first value.
 */
export function busiestRig(rigs: RigRef[]): RigRef | null {
  const up = (r: RigRef) => (r.state === 'stopped' || r.state === 'asleep' ? 1 : 0);
  return (
    [...rigs].sort(
      (a, b) =>
        up(a) - up(b) ||
        b.handoffs - a.handoffs ||
        (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '') ||
        a.key.localeCompare(b.key)
    )[0] ?? null
  );
}
