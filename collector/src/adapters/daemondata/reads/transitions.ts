/**
 * Queue transitions, read incrementally (GET /api/telemetry/v1/queue-transitions). The first read
 * starts at the daemon's retained start (`start=retained`); every later one continues from the cursor
 * it handed back (a cursor and `start` are mutually exclusive). The newest TRANSITIONS_MAX rows are
 * kept and the hub replaces, never appends. Starting over:
 *  - a REJECTED cursor (400/410: the daemon's epoch or history changed) drops everything held, and the
 *    next round starts again from the retained start. A timeout or 5xx says nothing about the cursor:
 *    what is held is kept and the read retried.
 *  - a page from a different boot epoch drops the rows held (they belong to the old history).
 */
import { TRANSITIONS_MAX, type TransitionRow, type TransitionsData } from '@appydave/shared';
import { errorMessage } from '@collector/adapters/narrow/errors.js';
import { parseTransitionsPage } from '@collector/adapters/daemondata/parse/transitionsPage.js';
import { isNotFound, type DaemonGet } from '@collector/adapters/daemondata/reads/get.js';
import {
  okOutcome,
  unsupportedOutcome,
  type Outcome,
} from '@collector/adapters/daemondata/reads/outcome.js';

/** The daemon's page size cap for the telemetry streams is 128 (limit above it is a 400). */
const TRANSITIONS_PAGE = 128;

/** Pages read per round, so the first read of a long history is spread over a few rounds. */
const TRANSITIONS_PAGES_PER_ROUND = 12;

type Page = ReturnType<typeof parseTransitionsPage>;

/** What the feed holds between rounds: the cursor to continue from and the newest rows (oldest first). */
interface FeedState {
  cursor: string | null;
  rows: TransitionRow[];
  /** Rows read in this history so far (more than `rows` once the oldest were dropped). */
  read: number;
  hostId: string | null;
  bootEpoch: string | null;
  /** page.retainedHighWatermark: the newest retained transition id. */
  high: number | null;
}

const fresh = (): FeedState => ({
  cursor: null,
  rows: [],
  read: 0,
  hostId: null,
  bootEpoch: null,
  high: null,
});

/** The query for the next page: continue from the cursor, or start at the retained start. */
const pageQuery = (cursor: string | null): string =>
  `/api/telemetry/v1/queue-transitions?limit=${TRANSITIONS_PAGE}&${
    cursor ? `cursor=${encodeURIComponent(cursor)}` : 'start=retained'
  }`;

/** A different boot epoch on both sides: the daemon's history is a different one now. */
const isNewHistory = (held: string | null, got: string | null): boolean =>
  Boolean(held && got && held !== got);

/** What the round pushes: the rows held, how many the daemon retains, and whether some were dropped. */
const dataOf = (st: FeedState): TransitionsData => ({
  rows: st.rows,
  // L1: the daemon's own retained high-water mark (its newest transition id), else rows read
  retained: st.high ?? st.read,
  // rows read vs rows held: ids are not counts once the daemon has pruned its history
  truncated: st.read > st.rows.length,
  hostId: st.hostId,
  bootEpoch: st.bootEpoch,
});

/** The page's host, boot epoch and high-water mark, where it gives them; the held ones otherwise. */
function mergeSource(st: FeedState, got: Page): void {
  st.hostId = got.hostId ?? st.hostId;
  st.bootEpoch = got.bootEpoch ?? st.bootEpoch;
  st.high = got.retainedHigh ?? st.high;
}

export class TransitionsFeed {
  private st: FeedState = fresh();

  constructor(private readonly get: DaemonGet) {}

  /** One round: up to TRANSITIONS_PAGES_PER_ROUND pages, then everything held. */
  async read(): Promise<Outcome[]> {
    for (let page = 0; page < TRANSITIONS_PAGES_PER_ROUND; page++) {
      const got = await this.nextPage();

      if (got === 'unsupported') {
        return [unsupportedOutcome('this OpenRig has no queue-transition telemetry')];
      }

      if (!this.take(got)) {
        break;
      }
    }

    return [okOutcome(dataOf(this.st))];
  }

  /** The next page; 'unsupported' on a 404; throws on any other failure (after a rejected cursor, from scratch). */
  private async nextPage(): Promise<Page | 'unsupported'> {
    try {
      return parseTransitionsPage(await this.get(pageQuery(this.st.cursor)));
    } catch (e) {
      if (isNotFound(e)) {
        return 'unsupported';
      }

      if (this.st.cursor && /HTTP (400|410)\b/.test(errorMessage(e))) {
        this.st = fresh();
      }

      throw e;
    }
  }

  /** Folds one page into what is held; false when there is no next page to read this round. */
  private take(got: Page): boolean {
    const st = this.st;

    if (isNewHistory(st.bootEpoch, got.bootEpoch)) {
      st.rows = [];
      st.read = 0;
    }

    mergeSource(st, got);
    st.read += got.rows.length;

    // L2: a row is held once, whichever page it arrives on
    const have = new Set(st.rows.map((r) => r.id));

    st.rows = [...st.rows, ...got.rows.filter((r) => !have.has(r.id))].slice(-TRANSITIONS_MAX);
    st.cursor = got.nextCursor ?? st.cursor;

    return got.hasMore && got.rows.length > 0;
  }
}
