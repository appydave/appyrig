import { useMemo, useState } from 'react';
import { callVerb } from '../../../fleet/coreCall.js';
import { seatKey } from '../../../fleet/model.js';
import {
  DataNotes,
  Loading,
  SampleWhy,
  agoFrom,
  pick,
  useMachineLabel,
  useVerb,
  type HistoryTransitionRow,
  type HistoryTransitionsOutput,
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

const SHOWN = 100;
const INPUT = { limit: 200 };

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
      <span className="ny-jump">
        {seatId && (
          <button
            type="button"
            className="pill-btn"
            data-testid="hist-open-agent"
            onClick={() => ctx.onOpenAgent(seatKey(r.machineId, seatId))}
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

function History({ ctx }: V2PageProps) {
  const label = useMachineLabel(ctx.allMachines);
  const s = useVerb<HistoryTransitionsOutput>(ctx.getSocket, 'history.transitions', INPUT);
  const src = pick(s, (v) => v.machines, label);
  const [text, setText] = useState('');
  const [state, setState] = useState('');
  const [machine, setMachine] = useState('');
  const [all, setAll] = useState(false);
  // Older pages, fetched with the keyset cursor (`before`): rows added meanwhile never shift a page.
  const [older, setOlder] = useState<HistoryTransitionRow[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [olderErr, setOlderErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const live = src.kind === 'live' ? src.value : null;
  const rows = useMemo(
    () => (live ? fromTransitions([...live.rows, ...older]) : fromQueue(ctx.machines)),
    [live, older, ctx.machines]
  );
  const found = useMemo(
    () => filterHistory(rows, { text, state, machine }),
    [rows, text, state, machine]
  );
  const shown = all ? found : found.slice(0, SHOWN);
  const events = useMemo(() => sampleEvents(ctx.allMachines, ctx.now), [ctx.allMachines, ctx.now]);
  const nextCursor = cursor === undefined ? (live?.nextCursor ?? null) : cursor;
  const loadOlder = () => {
    if (!nextCursor || busy) return;
    setBusy(true);
    setOlderErr(null);
    void callVerb<HistoryTransitionsOutput>(ctx.getSocket(), 'history.transitions', {
      ...INPUT,
      before: nextCursor,
    }).then((a) => {
      setBusy(false);
      if (!a.ok) return setOlderErr(a.error.message);
      setOlder((o) => [...o, ...a.value.rows]);
      setCursor(a.value.nextCursor);
    });
  };
  const ok = live?.machines.filter((m) => m.status === 'ok') ?? [];

  return (
    <main className="view v2-history" data-testid="v2-history">
      <h2>History</h2>
      <p className="quiet">
        What moved through the queues: each handoff and the state it went into, with the reason it
        was closed. Search by seat, rig, reason or text.
      </p>
      {src.kind === 'loading' && <Loading what="the history" />}
      {src.kind === 'sample' && (
        <>
          <SampleWhy why={src.why} />
          <p className="quiet" data-testid="hist-fallback">
            Until then the list below is real but thin: each queue item&apos;s latest state from the
            machines&apos; snapshots. Earlier steps and closure reasons are not in a snapshot.
          </p>
        </>
      )}
      {live && (
        <>
          <DataNotes notes={src.kind === 'live' ? src.notes : []} />
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
        </>
      )}

      {src.kind !== 'loading' && (
        <>
          <div className="lib-controls">
            <input
              type="search"
              className="lib-search"
              placeholder="Search seat, rig, reason or text"
              aria-label="Search history"
              data-testid="hist-search"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <label>
              State{' '}
              <select
                value={state}
                data-testid="hist-state"
                onChange={(e) => setState(e.target.value)}
              >
                <option value="">all</option>
                {statesOf(rows).map((x) => (
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
                {[...new Set(rows.map((r) => r.machineId))].map((id) => (
                  <option key={id} value={id}>
                    {label(id)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="quiet" data-testid="hist-count">
            {found.length} of {rows.length} shown
            {live && live.total > rows.length
              ? ` (the newest ${rows.length} of ${live.total})`
              : ''}
            .
          </p>
          {found.length === 0 ? (
            <p data-testid="hist-empty">
              {rows.length === 0
                ? 'No rows to search: no machine has reported any.'
                : 'Nothing matches this search and filter.'}
            </p>
          ) : (
            <ul className="hist-list" data-testid="hist-list">
              {shown.map((r) => (
                <Row key={r.key} r={r} ctx={ctx} label={label} />
              ))}
              {nextCursor && (
                <li>
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
                </li>
              )}
              {found.length > SHOWN && (
                <li>
                  <button type="button" className="pill-btn" onClick={() => setAll((v) => !v)}>
                    {all ? 'Show fewer' : `Show all ${found.length}`}
                  </button>
                </li>
              )}
            </ul>
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
              <span className="hist-at">{agoFrom(new Date(e.at).toISOString(), ctx.now)}</span>{' '}
              <code>{e.type}</code>{' '}
              <span className="quiet">
                {e.seat} · {e.rig} · {e.machine}
              </span>
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
