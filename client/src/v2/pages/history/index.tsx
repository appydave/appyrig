import { useEffect, useMemo, useRef, useState } from 'react';
import { callVerb } from '../../../fleet/coreCall.js';
import { seatKey } from '../../../fleet/model.js';
import {
  Coverage,
  Loading,
  agoFrom,
  pick,
  useMachineLabel,
  type HistoryTransitionRow,
  type HistoryTransitionsOutput,
  type VerbState,
} from '../../data/index.js';
import { SampleData } from '../../kit/index.js';
import type { V2PageDef, V2PageProps } from '../../types.js';
import {
  filterHistory,
  fromQueue,
  fromTransitions,
  rigOfAddress,
  sampleEvents,
  statesOf,
  type HistRow,
} from './model.js';

/** Rows asked for per page (the verb's own maximum). */
export const PAGE_SIZE = 200;
/** Rows drawn before "Show more": a long list stays quick, and the caption always says how many are on screen. */
export const RENDER_STEP = 500;
export const SEARCH_DEBOUNCE_MS = 150;

/** Which field the search box searches (sent to the verb as seat, rig or closureReason; "anything" is text). */
export type SearchBy = 'text' | 'seat' | 'rig' | 'closureReason';
const SEARCH_BY: { key: SearchBy; label: string }[] = [
  { key: 'text', label: 'anything' },
  { key: 'seat', label: 'seat' },
  { key: 'rig', label: 'rig' },
  { key: 'closureReason', label: 'closure reason' },
];

function Row({
  r,
  ctx,
  label,
}: {
  r: HistRow;
  ctx: V2PageProps['ctx'];
  label: (id: string) => string;
}) {
  const fm = ctx.allMachines.find((m) => m.machine.id === r.machineId);
  const seatId = [r.actor, r.source].find((a) => a && fm?.snapshot.seats.some((s) => s.id === a));
  const rig = rigOfAddress(fm, r.source ?? r.actor);
  const rigRef = rig
    ? ctx.rigs.find((x) => x.machineId === r.machineId && x.name === rig)
    : undefined;
  return (
    <li className="hist-row" data-testid="hist-row" data-state={r.state} data-origin={r.origin}>
      <div className="hist-main">
        <span className="hist-at" title={r.at}>
          {agoFrom(r.at, ctx.now)}
        </span>{' '}
        <span className="ms-state">{r.state}</span>{' '}
        <span>{(r.summary ?? r.qitemId).split('\n')[0]}</span>
        <br />
        <span className="quiet">
          {r.source || r.destination ? `${r.source ?? '?'} → ${r.destination ?? '?'} · ` : ''}
          {r.actor ? `by ${r.actor} · ` : ''}
          {label(r.machineId)}
        </span>
        {r.closureReason ? (
          <span data-testid="hist-closure">
            {' '}
            · closed: <b>{r.closureReason}</b>
            {r.closureTarget ? ` → ${r.closureTarget}` : ''}
          </span>
        ) : (
          r.origin === 'snapshot' && <span className="quiet"> · closure reason not collected</span>
        )}
      </div>
      <span className="ny-jump hist-jump">
        {seatId && (
          <button
            type="button"
            className="pill-btn"
            data-testid="hist-open-agent"
            onClick={() => ctx.openAgentPage(seatKey(r.machineId, seatId))}
          >
            Open agent
          </button>
        )}
        {rigRef && (
          <button
            type="button"
            className="pill-btn"
            data-testid="hist-open-rig"
            onClick={() => {
              ctx.chooseRig(rigRef.key);
              ctx.goTo('flow');
            }}
          >
            Open rig
          </button>
        )}
      </span>
    </li>
  );
}

/** A value that follows `v` after `ms` of quiet (the search box is sent to the hub, so not on every key). */
function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}

interface Query {
  by: SearchBy;
  text: string;
  state: string;
  machine: string;
}

const toInput = (q: Query, before?: string): Record<string, unknown> => ({
  limit: PAGE_SIZE,
  ...(q.text.trim() ? { [q.by]: q.text.trim() } : {}),
  ...(q.state ? { state: q.state } : {}),
  ...(q.machine ? { machine: q.machine } : {}),
  ...(before ? { before } : {}),
});

function History({ ctx }: V2PageProps) {
  const label = useMachineLabel(ctx.allMachines);
  const [by, setBy] = useState<SearchBy>('text');
  const [text, setText] = useState('');
  const [state, setState] = useState('');
  const [machine, setMachine] = useState('');
  const [limit, setLimit] = useState(RENDER_STEP);
  const typed = useDebounced(text, SEARCH_DEBOUNCE_MS);
  // The query the hub is asked: the debounced text plus the filters. A change starts again from the newest page.
  const query = useMemo<Query>(
    () => ({ by, text: typed, state, machine }),
    [by, typed, state, machine]
  );
  const qKey = JSON.stringify(query);

  // First page (kept while the next query loads, so the list does not flash), older pages, cursor.
  const [first, setFirst] = useState<VerbState<HistoryTransitionsOutput>>({ phase: 'loading' });
  const [older, setOlder] = useState<HistoryTransitionRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [olderErr, setOlderErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const { getSocket } = ctx;

  // Reset and re-ask when the query changes or the socket (the live source) changes.
  useEffect(() => {
    const gen = ++generation.current;
    setOlder([]);
    setOlderErr(null);
    setBusy(false);
    setLimit(RENDER_STEP);
    void callVerb<HistoryTransitionsOutput>(
      getSocket(),
      'history.transitions',
      toInput(JSON.parse(qKey) as Query)
    ).then((a) => {
      if (gen !== generation.current) return;
      if (a.ok) {
        setFirst({ phase: 'ok', value: a.value });
        setCursor(a.value.nextCursor);
      } else {
        setFirst({ phase: 'refused', message: a.error.message });
        setCursor(null);
      }
    });
  }, [qKey, getSocket]);

  const src = pick(first, (v) => v.machines, label);
  const live = src.kind === 'live' ? src.value : null;

  const loadOlder = () => {
    if (!cursor || busy) return;
    const gen = generation.current;
    setBusy(true);
    setOlderErr(null);
    void callVerb<HistoryTransitionsOutput>(
      getSocket(),
      'history.transitions',
      toInput(query, cursor)
    ).then((a) => {
      if (gen !== generation.current) return;
      setBusy(false);
      if (!a.ok) return setOlderErr(a.error.message);
      setOlder((o) => [...o, ...a.value.rows]);
      setCursor(a.value.nextCursor);
    });
  };

  const loaded = useMemo(
    () => (live ? fromTransitions([...live.rows, ...older]) : fromQueue(ctx.machines)),
    [live, older, ctx.machines]
  );
  // Instant client-side narrowing over what is loaded (the hub already filtered; this only tightens).
  const found = useMemo(
    () => filterHistory(loaded, { text, state, machine }),
    [loaded, text, state, machine]
  );
  const shown = found.slice(0, limit);
  const events = useMemo(() => sampleEvents(ctx.allMachines, ctx.now), [ctx.allMachines, ctx.now]);
  const ok = live?.machines.filter((m) => m.status === 'ok') ?? [];
  const held = ok.reduce((n, m) => n + m.held, 0);
  const filtering = !!(query.text.trim() || query.state || query.machine);

  return (
    <main className="view v2-history" data-testid="v2-history">
      <h2>History</h2>
      <p className="quiet">
        Each handoff and the state it went into, with the reason it was closed.
      </p>
      {src.kind === 'loading' && <Loading what="the history" />}
      <Coverage
        src={src}
        tail={live ? `${held} transitions held, newest only` : "showing each item's latest state"}
        details={
          live ? (
            <ul className="quiet" data-testid="hist-retention">
              {ok.map((m) => (
                <li key={m.machine}>
                  {label(m.machine)}: {m.held} transitions held
                  {m.earliestAt ? `, from ${new Date(m.earliestAt).toLocaleDateString()}` : ''}
                  {m.truncated || (m.retained != null && m.held < m.retained)
                    ? ` (older ones exist: ${m.retained ?? 'more'} retained, newest ${m.held} held)`
                    : ''}
                  . This is not all history.
                </li>
              ))}
            </ul>
          ) : src.kind === 'sample' ? (
            <p className="quiet" data-testid="hist-fallback">
              Until then the list below is real but thin: each queue item&apos;s latest state from
              the machines&apos; snapshots. Earlier steps and closure reasons are not in a snapshot.
            </p>
          ) : null
        }
      />

      {src.kind !== 'loading' && (
        <>
          <div className="lib-controls">
            <input
              type="search"
              className="lib-search"
              placeholder="Search"
              aria-label="Search history"
              data-testid="hist-search"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setLimit(RENDER_STEP);
              }}
            />
            <label>
              in{' '}
              <select
                value={by}
                data-testid="hist-by"
                onChange={(e) => setBy(e.target.value as SearchBy)}
              >
                {SEARCH_BY.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              State{' '}
              <select
                value={state}
                data-testid="hist-state"
                onChange={(e) => setState(e.target.value)}
              >
                <option value="">all</option>
                {[...new Set([...statesOf(loaded), ...(state ? [state] : [])])].sort().map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Machine{' '}
              <select
                value={machine}
                data-testid="hist-machine"
                onChange={(e) => setMachine(e.target.value)}
              >
                <option value="">all</option>
                {ctx.allMachines.map((m) => (
                  <option key={m.machine.id} value={m.machine.id}>
                    {m.machine.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="quiet" data-testid="hist-count">
            {live ? (
              <>
                {shown.length} on screen · {loaded.length} loaded
                {found.length < loaded.length
                  ? ` (${loaded.length - found.length} hidden by the box)`
                  : ''}{' '}
                · {live.total} {filtering ? 'match this search' : 'in all'} ({held} held across
                machines, newest only).
                {cursor
                  ? ` Searched the newest ${loaded.length} of ${live.total}: Load older reads more.`
                  : ''}
              </>
            ) : (
              <>
                {shown.length} of {loaded.length} shown.
              </>
            )}
          </p>
          {found.length === 0 ? (
            <p data-testid="hist-empty">
              {loaded.length === 0 && !filtering
                ? 'No rows to search: no machine has reported any.'
                : 'Nothing matches this search and filter among the rows loaded.'}
            </p>
          ) : (
            <ul className="hist-list" data-testid="hist-list">
              {shown.map((r) => (
                <Row key={r.key} r={r} ctx={ctx} label={label} />
              ))}
              {found.length > limit && (
                <li>
                  <button
                    type="button"
                    className="pill-btn"
                    data-testid="hist-more"
                    onClick={() => setLimit((n) => n + RENDER_STEP)}
                  >
                    Show {Math.min(RENDER_STEP, found.length - limit)} more on screen
                  </button>
                </li>
              )}
            </ul>
          )}
          {live && cursor && (
            <p>
              <button
                type="button"
                className="pill-btn"
                data-testid="hist-older"
                disabled={busy}
                onClick={loadOlder}
              >
                {busy ? 'Reading…' : 'Load older'}
              </button>
              {olderErr && <span className="quiet"> {olderErr}</span>}
            </p>
          )}
        </>
      )}

      <SampleData
        title="Event lane"
        what="Seat start-up and session events from OpenRig's event stream. AppyRig has no read for it yet, so these are made up on real seat names."
      >
        <ul className="hist-list" data-testid="hist-events">
          {events.map((e) => (
            <li key={`${e.type}:${e.seat}:${e.at}`} className="hist-row">
              <div className="hist-main">
                <span className="hist-at">{agoFrom(new Date(e.at).toISOString(), ctx.now)}</span>{' '}
                <code>{e.type}</code>{' '}
                <span className="quiet">
                  {e.seat} · {e.rig} · {e.machine}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </SampleData>
    </main>
  );
}

export const page: V2PageDef = {
  key: 'history',
  label: 'History',
  group: 'work',
  component: History,
  blurb: 'Queue transitions with closure reasons, searchable; an event lane (sample).',
};
