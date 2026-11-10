/**
 * One queue transition (a row of GET /api/telemetry/v1/queue-transitions): kept only with an id of 1
 * to 30 characters, a qitem, a state and a time that parses. Paging over the rows is in
 * transitionsPage.ts; the cursor and the rows held between rounds are the reader's.
 */
import { TEXT_XLONG_MAX, TEXT_SHORT_MAX, type TransitionRow } from '@appydave/shared';
import { isRec, txt } from '@collector/adapters/daemondata/parse/lenient.js';

/** The transition id: a string (trimmed) or a number (as text); anything else has none. */
function idOf(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw.trim();
  }

  return typeof raw === 'number' ? String(raw) : '';
}

/** An id of 1 to 30 characters and a time that parsed: what a row needs besides its qitem and state. */
function hasRequired(id: string, ms: number): boolean {
  return id !== '' && id.length <= 30 && Number.isFinite(ms);
}

/** When the transition happened, in ms: originalTimestamp if present, else createdAt; NaN if neither parses. */
function whenOf(original: unknown, created: unknown): number {
  const when = txt(original, TEXT_SHORT_MAX) ?? txt(created, TEXT_SHORT_MAX);

  return when ? Date.parse(when) : NaN;
}

export function parseTransitionRow(r: unknown): TransitionRow | null {
  if (!isRec(r)) {
    return null;
  }

  const id = idOf(r.transitionId);
  const qitemId = txt(r.qitemId, TEXT_XLONG_MAX);
  const state = txt(r.state, TEXT_SHORT_MAX);
  const ms = whenOf(r.originalTimestamp, r.createdAt);

  if (!qitemId || !state || !hasRequired(id, ms)) {
    return null;
  }

  return {
    id,
    qitemId,
    at: new Date(ms).toISOString(),
    state,
    actor: txt(r.actorSession, TEXT_XLONG_MAX),
    closureReason: txt(r.closureReason, TEXT_XLONG_MAX),
    closureTarget: txt(r.closureTarget, TEXT_XLONG_MAX),
  };
}
