import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DB_ROWS_BYTES_MAX,
  DB_ROWS_MAX,
  type DbCell,
  type DbRowsOutput,
  type Refusal,
} from '@appydave/shared';
import { callVerb } from '@client/domain/fleet/coreCall.js';
import type { FleetSocket } from '@client/domain/fleet/useFleet.js';

const PAGE = 50;

type State =
  { state: 'loading' } | { state: 'ok'; out: DbRowsOutput } | { state: 'refused'; error: Refusal };

const n = (x: number) => x.toLocaleString('en-US');

/** What the rows line says: which rows are shown, of how many, and why some may be missing. */
export function rowsCaption(out: DbRowsOutput): string {
  if (out.held === 0) {
    return out.total === 0 ? 'This table is empty.' : 'No rows held.';
  }

  const from = out.offset + 1;
  const to = out.offset + out.rows.length;
  const order = out.order === 'rowid' ? 'newest first' : 'in stored order';
  const head = `Rows ${n(from)}–${n(to)} of ${n(out.held)} held, ${order}.`;

  return out.truncated
    ? `${head} Showing the newest ${n(out.held)} of ${n(out.total)}: the rest are not sent (at most ${DB_ROWS_MAX} rows and ${Math.round(DB_ROWS_BYTES_MAX / 1024)} KB per table).`
    : head;
}

const show = (c: DbCell) => (c === null ? 'NULL' : String(c));

/**
 * Batch 1 · B5 (fb-0003): a table's rows, read-only, paged 50 at a time. The rows come from what the
 * machine's collector pushed (newest first, capped, redacted); nothing here can write, and nothing
 * asks the collector for more.
 */
export default function SchemaRows({
  socket,
  machineId,
  table,
}: {
  socket: FleetSocket;
  machineId: string;
  table: string;
}) {
  const [offset, setOffset] = useState(0);
  const [got, setGot] = useState<State & { key: string }>({ state: 'loading', key: '' });
  const want = `${machineId}\u0000${table}\u0000${offset}`;
  const latest = useRef(want);

  latest.current = want;

  const load = useCallback(() => {
    const key = `${machineId}\u0000${table}\u0000${offset}`;

    void callVerb<DbRowsOutput>(socket, 'db.rows', {
      machine: machineId,
      table,
      offset,
      limit: PAGE,
    }).then((a) => {
      // An answer for another table or page (a slower, older call) is dropped.
      if (latest.current !== key) {
        return;
      }

      setGot(a.ok ? { state: 'ok', out: a.value, key } : { state: 'refused', error: a.error, key });
    });
  }, [socket, machineId, table, offset]);

  useEffect(() => setOffset(0), [machineId, table]);
  useEffect(() => load(), [load]);

  // What is shown is only ever the answer for THIS table and page; until it arrives, "loading".
  const shown: State = got.key === want ? got : { state: 'loading' };
  const out = shown.state === 'ok' ? shown.out : null;

  return (
    <section
      className="schema-rows"
      data-testid="schema-rows"
      data-state={out?.status ?? shown.state}
    >
      <p className="label">Rows · read-only</p>
      {shown.state === 'loading' && <p className="quiet">Loading rows…</p>}
      {shown.state === 'refused' && (
        <p className="quiet" data-testid="schema-rows-error">
          db.rows refused: {shown.error.failureMode}. {shown.error.message}
        </p>
      )}
      {out && out.status === 'pending' && (
        <p className="quiet" data-testid="schema-rows-pending">
          No rows yet. {out.reason}
          <button type="button" className="pill-btn" onClick={load}>
            Check again
          </button>
        </p>
      )}
      {out && out.status === 'ok' && (
        <>
          <p className="schema-rows-caption" data-testid="schema-rows-caption">
            {rowsCaption(out)}
          </p>
          <p className="quiet" data-testid="schema-rows-redacted">
            Text is redacted before it leaves the machine (keys and tokens show as
            &lt;REDACTED&gt;).
            {out.hiddenColumns.length > 0 &&
              ` Hidden because the column name looks secret: ${out.hiddenColumns.join(', ')}.`}
          </p>
          {out.rows.length > 0 && (
            <div className="schema-rows-scroll" tabIndex={0}>
              <table className="schema-rows-table" data-testid="schema-rows-table">
                <thead>
                  <tr>
                    {out.columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {out.rows.map((r, i) => (
                    <tr key={out.offset + i}>
                      {r.map((c, j) => (
                        <td key={j} title={show(c)} data-null={c === null || undefined}>
                          {show(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="schema-rows-pager">
            <button
              type="button"
              className="pill-btn"
              data-testid="schema-rows-prev"
              disabled={out.offset === 0}
              onClick={() => setOffset(Math.max(0, out.offset - PAGE))}
            >
              ← Newer
            </button>
            <button
              type="button"
              className="pill-btn"
              data-testid="schema-rows-next"
              disabled={out.offset + out.rows.length >= out.held}
              onClick={() => setOffset(out.offset + PAGE)}
            >
              Older →
            </button>
          </p>
        </>
      )}
    </section>
  );
}
