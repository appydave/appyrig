/**
 * One page of GET /api/telemetry/v1/queue-transitions: its rows, where the next page starts, and the
 * source it came from (host id and boot epoch, so the reader can tell when the daemon's history is a
 * different one). Throws on a reply without {rows, page}.
 */
import { TEXT_MEDIUM_MAX, type TransitionRow } from '@appydave/shared';
import { isRec, recOf, txt } from '@collector/adapters/daemondata/parse/lenient.js';
import { parseTransitionRow } from '@collector/adapters/daemondata/parse/transitionRow.js';

const CURSOR_MAX = 2000;

/** The retained high-water mark (the newest retained transition id): a non-negative number, rounded, or null. */
function watermarkOf(v: unknown): number | null {
  const h = Number(v);

  return Number.isFinite(h) && h >= 0 ? Math.round(h) : null;
}

/** What a page of GET /api/telemetry/v1/queue-transitions carries that the reader needs. */
export function parseTransitionsPage(raw: unknown): {
  rows: TransitionRow[];
  nextCursor: string | null;
  hasMore: boolean;
  retainedHigh: number | null;
  hostId: string | null;
  bootEpoch: string | null;
} {
  if (!isRec(raw) || !Array.isArray(raw.rows) || !isRec(raw.page)) {
    throw new Error('queue-transitions: expected {rows, page}');
  }

  const source = recOf(raw.source);

  return {
    rows: raw.rows.flatMap((r) => parseTransitionRow(r) ?? []),
    nextCursor: txt(raw.page.nextCursor, CURSOR_MAX),
    hasMore: raw.page.hasMore === true,
    retainedHigh: watermarkOf(raw.page.retainedHighWatermark),
    hostId: txt(source.hostId, TEXT_MEDIUM_MAX),
    bootEpoch: txt(source.bootEpoch, TEXT_MEDIUM_MAX),
  };
}
