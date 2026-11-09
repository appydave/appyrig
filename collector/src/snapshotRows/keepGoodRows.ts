import { QueueItemSchema, SeatSchema, type SourceHealth } from '@appydave/shared';

/** The source health text names this many rows and counts the rest, so it stays short. */
const ROWS_NAMED_MAX = 5;

/** A row id goes into the log and the source health; a bad row's id can be any length. */
const ROW_ID_MAX = 80;

interface Row {
  id: string;
}

interface HasRows {
  seats: Row[];
  queue: Row[];
  sources: { daemon: SourceHealth };
}

/** Each refused row is described by field and rule only: never the value, which may be the problem. */
function splitRows<R extends Row>(
  kind: string,
  rows: R[],
  schema: typeof SeatSchema | typeof QueueItemSchema
): { kept: R[]; dropped: string[] } {
  const kept: R[] = [];
  const dropped: string[] = [];

  for (const row of rows) {
    const issue = schema.safeParse(row).error?.issues[0];

    if (issue) {
      dropped.push(
        `${kind} row ${String(row.id).slice(0, ROW_ID_MAX)}: ${issue.path.join('.')}: ${issue.message}`
      );
    } else {
      kept.push(row);
    }
  }

  return { kept, dropped };
}

function droppedSummary(dropped: string[]): string {
  const more = dropped.length - ROWS_NAMED_MAX;
  const named = dropped.slice(0, ROWS_NAMED_MAX).join('; ');
  const count = `${dropped.length} row${dropped.length === 1 ? '' : 's'} dropped`;

  return `${count}: ${named}${more > 0 ? ` and ${more} more` : ''}`;
}

/**
 * A snapshot with any seat or queue row its schema refuses taken out, so one odd row costs that row
 * and not the machine. What went is reported in the daemon's source health and through `note`.
 */
export function keepGoodRows<S extends HasRows>(snapshot: S, note?: (line: string) => void): S {
  const seats = splitRows('seat', snapshot.seats, SeatSchema);
  const queue = splitRows('queue', snapshot.queue, QueueItemSchema);
  const dropped = [...seats.dropped, ...queue.dropped];

  if (dropped.length === 0) {
    return snapshot;
  }

  const summary = droppedSummary(dropped);
  const { daemon } = snapshot.sources;

  note?.(`snapshot: ${summary}`);

  return {
    ...snapshot,
    seats: seats.kept,
    queue: queue.kept,
    sources: {
      ...snapshot.sources,
      daemon: {
        ok: false,
        error: daemon.error ? `${daemon.error} | ${summary}` : summary,
        version: daemon.version,
      },
    },
  };
}
