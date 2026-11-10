/**
 * The seat-detail read: one GET per seat the snapshot lists (GET /api/rigs/:rigId/nodes/:logicalId),
 * one push per seat. A 404 on a seat is `not-found` (the daemon does not know this seat or rig) unless
 * the rig's node list is a 404 too, which means this OpenRig has no node routes: `unsupported`. Any
 * other failure pushes nothing for that seat and is logged once for all seats together.
 */
import { errorMessage } from '@collector/adapters/narrow/errors.js';
import { parseSeatDetail } from '@collector/adapters/daemondata/parse/seatDetail.js';
import { isNotFound, settle, type DaemonGet } from '@collector/adapters/daemondata/reads/get.js';
import {
  okOutcome,
  unsupportedOutcome,
  type FailureLog,
  type Outcome,
} from '@collector/adapters/daemondata/reads/outcome.js';

export interface SeatTarget {
  /** The seat id (canonical session name). */
  seat: string;
  rigId: string;
  logicalId: string;
}

const FAILURE_KEY = 'seatdetail:seats';

const nodePath = (t: SeatTarget) =>
  `/api/rigs/${encodeURIComponent(t.rigId)}/nodes/${encodeURIComponent(t.logicalId)}`;

/**
 * Per rig, once per round: is the node-list route missing (true), there (false), or unknown because
 * the probe itself failed (null, not remembered)?
 */
function routeProbe(get: DaemonGet): (rigId: string) => Promise<boolean | null> {
  const routeMissing = new Map<string, boolean>();

  return async (rigId) => {
    if (routeMissing.has(rigId)) {
      return routeMissing.get(rigId)!;
    }

    const r = await settle(get, `/api/rigs/${encodeURIComponent(rigId)}/nodes`);

    if (!r.ok && !r.notFound) {
      return null;
    }

    routeMissing.set(rigId, !r.ok);

    return !r.ok;
  };
}

/** What a seat's failed GET becomes: an outcome for a 404 the probe could explain, else null. */
async function outcomeOfFailure(
  e: unknown,
  t: SeatTarget,
  probe: (rigId: string) => Promise<boolean | null>
): Promise<Outcome | null> {
  const missing = isNotFound(e) ? await probe(t.rigId) : null;

  if (missing === true) {
    return unsupportedOutcome('this OpenRig has no node routes for this rig', t.seat);
  }

  return missing === false
    ? { key: t.seat, status: 'not-found', reason: 'the daemon does not know this seat', data: null }
    : null;
}

/** One line for every seat that failed this round, or recovery when none did. */
function logSeatFailures(failures: FailureLog, failed: number, firstError: string): void {
  if (failed > 0) {
    failures.fail(FAILURE_KEY, `seat detail unreadable for ${failed} seat(s), first ${firstError}`);
  } else {
    failures.recovered(FAILURE_KEY);
  }
}

export async function readSeatDetails(
  ctx: { get: DaemonGet; failures: FailureLog },
  targets: SeatTarget[]
): Promise<Outcome[]> {
  const out: Outcome[] = [];
  const probe = routeProbe(ctx.get);
  let failed = 0;
  let firstError = '';

  for (const t of targets) {
    try {
      out.push(okOutcome(parseSeatDetail(await ctx.get(nodePath(t))), t.seat));
    } catch (e) {
      const outcome = await outcomeOfFailure(e, t, probe);

      if (outcome) {
        out.push(outcome);
      } else {
        failed += 1;
        firstError ||= `${t.seat}: ${errorMessage(e)}`;
      }
    }
  }

  logSeatFailures(ctx.failures, failed, firstError);

  return out;
}
