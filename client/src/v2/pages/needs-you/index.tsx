import { useEffect, useMemo, useState } from 'react';
import type { RigWaitingOutput } from '@appydave/shared';
import { callVerb } from '../../../fleet/coreCall.js';
import { FakeControl, MockMark, SampleData } from '../../kit/index.js';
import type { V2PageDef, V2PageProps } from '../../types.js';
import {
  FILTERS,
  KIND_LABEL,
  SUBSCRIPTION_KINDS,
  STALE_DAYS,
  buildNeeds,
  countsByFilter,
  matches,
  sampleNeeds,
  waited,
  type GatesByRig,
  type NeedFilter,
  type NeedItem,
} from './model.js';

type Pretend = 'Approved' | 'Dismissed' | 'Snoozed' | 'Replied';
const ACTIONS: { label: string; done: Pretend; kinds?: NeedItem['kind'][] }[] = [
  { label: 'Approve', done: 'Approved', kinds: ['action', 'gate', 'approval'] },
  { label: 'Reply', done: 'Replied' },
  { label: 'Snooze', done: 'Snoozed' },
  { label: 'Dismiss', done: 'Dismissed' },
];

/**
 * The four per-card actions. They are mocks: a click only changes this card's own look
 * ("Approved (pretend)") and never calls the hub, the socket or OpenRig.
 */
function ItemActions({ item }: { item: NeedItem }) {
  const [done, setDone] = useState<Pretend | null>(null);
  if (done) {
    return (
      <span className="ny-actions" data-testid="ny-pretend">
        {done} (pretend){' '}
        <button type="button" className="pill-btn" onClick={() => setDone(null)}>
          Undo
        </button>{' '}
        <MockMark />
      </span>
    );
  }
  return (
    <span className="ny-actions">
      {ACTIONS.filter((a) => !a.kinds || a.kinds.includes(item.kind)).map((a) => (
        <button
          key={a.label}
          type="button"
          className="pill-btn"
          data-testid={`ny-${a.label.toLowerCase()}`}
          onClick={() => setDone(a.done)}
        >
          {a.label}
        </button>
      ))}{' '}
      <MockMark />
    </span>
  );
}

function Card({ item, ctx }: { item: NeedItem; ctx: V2PageProps['ctx'] }) {
  const rigRef = item.rig
    ? ctx.rigs.find((r) => r.machineId === item.machineId && r.name === item.rig)
    : undefined;
  return (
    <li
      className={`ny-card ny-${item.kind}${item.stale ? ' ny-stale' : ''}`}
      data-testid="ny-card"
      data-kind={item.kind}
      data-real={item.real ? 'real' : 'sample'}
      data-id={item.id}
    >
      <div className="ny-top">
        <span className="ny-kind">{KIND_LABEL[item.kind]}</span>
        <span className="ny-wait" data-testid="ny-wait" title={new Date(item.since).toISOString()}>
          waited {waited(item.waitedMs)}
          {item.stale && ' · stale'}
        </span>
      </div>
      <p className="ny-summary">{item.summary}</p>
      <p className="ny-meta">
        asked by <b>{item.from}</b>
        {item.rig && (
          <>
            {' '}
            in <b>{item.rig}</b>
          </>
        )}{' '}
        on <b>{item.machineLabel}</b>
      </p>
      <div className="ny-row">
        <ItemActions item={item} />
        <span className="ny-jump">
          {item.seatKey && (
            <button
              type="button"
              className="pill-btn"
              data-testid="ny-open-agent"
              onClick={() => ctx.onOpenAgent(item.seatKey!)}
            >
              Open agent
            </button>
          )}
          {rigRef && (
            <button
              type="button"
              className="pill-btn"
              data-testid="ny-open-rig"
              onClick={() => {
                ctx.chooseRig(rigRef.key);
                ctx.goTo('flow');
              }}
            >
              Open rig
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

/** Gates per rig, read through the read-only rig.waiting verb for every running rig on a live machine. */
function useGates(ctx: V2PageProps['ctx']): GatesByRig {
  const [gates, setGates] = useState<GatesByRig>({});
  const targets = useMemo(
    () =>
      ctx.machines
        .filter((m) => m.liveness !== 'asleep')
        .flatMap((m) =>
          m.snapshot.rigs
            .filter((r) => r.status === 'running')
            .map((r) => ({ machine: m.machine.id, rig: r.name }))
        ),
    [ctx.machines]
  );
  const sig = targets.map((t) => `${t.machine}:${t.rig}`).join('|');
  const { getSocket } = ctx;
  useEffect(() => {
    let live = true;
    const socket = getSocket();
    void Promise.all(
      targets.map((t) =>
        callVerb<RigWaitingOutput>(socket, 'rig.waiting', t).then((a) =>
          a.ok ? ([`${t.machine}:${t.rig}`, a.value.gates] as const) : null
        )
      )
    ).then((rows) => {
      if (!live) return;
      setGates(Object.fromEntries(rows.filter((r) => r !== null)));
    });
    return () => {
      live = false;
    };
    // `sig` stands for `targets`: re-ask only when the set of running rigs changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, getSocket]);
  return gates;
}

function NeedsYou({ ctx }: V2PageProps) {
  const [filter, setFilter] = useState<NeedFilter>('all');
  const [showStale, setShowStale] = useState(false);
  const gates = useGates(ctx);
  const real = useMemo(
    () => buildNeeds(ctx.machines, gates, ctx.now),
    [ctx.machines, gates, ctx.now]
  );
  const sample = useMemo(() => sampleNeeds(ctx.allMachines, ctx.now), [ctx.allMachines, ctx.now]);
  const counts = countsByFilter(real);
  const shown = real.filter((i) => matches(i, filter));
  const fresh = shown.filter((i) => !i.stale);
  const stale = shown.filter((i) => i.stale);
  const sampleShown = sample.filter((i) => matches(i, filter));
  const asleep = ctx.machines.filter((m) => m.liveness === 'asleep');
  const [levels, setLevels] = useState<Record<string, string>>({});

  return (
    <main className="view v2-needs" data-testid="v2-needs-you">
      <h2>Needs You</h2>
      <p className="quiet">
        Everything waiting on David, on every machine, in one list. The longest wait is first;
        anything older than {STALE_DAYS} days is filed under Stale at the bottom.
      </p>
      <p className="ny-summary-line" data-testid="ny-total">
        <b>{real.length}</b> waiting ({fresh.length} fresh, {stale.length} stale in this view)
        across {ctx.machines.length} {ctx.machines.length === 1 ? 'machine' : 'machines'}.
        {asleep.length > 0 &&
          ` ${asleep.map((m) => m.machine.label).join(', ')} ${asleep.length === 1 ? 'is' : 'are'} asleep: its items are from its last report.`}
      </p>

      <div className="ny-filters" role="tablist" aria-label="Filter" data-testid="ny-filters">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className="pill-btn ny-filter"
            data-testid={`ny-filter-${f.key}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label} <span className="ny-count">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      {fresh.length === 0 && stale.length === 0 && (
        <p className="quiet" data-testid="ny-empty">
          {filter === 'approval' || filter === 'shipped' || filter === 'progress'
            ? `Nothing real is collected for ${FILTERS.find((f) => f.key === filter)!.label.toLowerCase()} yet; the sample cards below show the shape.`
            : ctx.machines.length === 0
              ? 'No machine is reporting, so this cannot say what is waiting (not the same as nothing waiting).'
              : 'Nothing is waiting on David.'}
        </p>
      )}
      {fresh.length > 0 && (
        <ul className="ny-list" aria-label="Waiting on you" data-testid="ny-fresh">
          {fresh.map((i) => (
            <Card key={i.id} item={i} ctx={ctx} />
          ))}
        </ul>
      )}

      {stale.length > 0 && (
        <section className="ny-stale-band" data-testid="ny-stale-band">
          <h3>
            Stale ({stale.length}){' '}
            <span className="quiet">
              waiting more than {STALE_DAYS} days: probably already dealt with
            </span>
          </h3>
          <p>
            <FakeControl
              label={`Clear ${stale.length} stale`}
              question={`Close all ${stale.length} items older than ${STALE_DAYS} days?`}
              result={`${stale.length} stale items cleared (pretend)`}
            />{' '}
            <button
              type="button"
              className="pill-btn"
              data-testid="ny-toggle-stale"
              onClick={() => setShowStale((v) => !v)}
            >
              {showStale ? 'Hide them' : 'Show them'}
            </button>
          </p>
          {showStale && (
            <ul className="ny-list" aria-label="Stale items" data-testid="ny-stale">
              {stale.map((i) => (
                <Card key={i.id} item={i} ctx={ctx} />
              ))}
            </ul>
          )}
        </section>
      )}

      {sampleShown.length > 0 && (
        <SampleData
          title="Approvals, shipped and progress"
          what="Made up from real machine, rig and seat names: AppyRig does not collect approvals, shipped or progress cards yet. They are not counted above."
        >
          <ul className="ny-list" aria-label="Sample cards" data-testid="ny-sample">
            {sampleShown.map((i) => (
              <Card key={i.id} item={i} ctx={ctx} />
            ))}
          </ul>
        </SampleData>
      )}

      <SampleData
        title="What reaches this inbox"
        what="Subscription levels as OpenRig's For You has them. The choices below are not saved anywhere."
      >
        <ul className="ny-subs" data-testid="ny-subs">
          {SUBSCRIPTION_KINDS.map((s) => (
            <li key={s.kind}>
              <label>
                {s.label}{' '}
                <select
                  value={levels[s.kind] ?? s.level}
                  onChange={(e) => setLevels({ ...levels, [s.kind]: e.target.value })}
                >
                  {['Always', 'Daily digest', 'Off'].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
        <MockMark />
      </SampleData>
    </main>
  );
}

export const page: V2PageDef = {
  key: 'needs-you',
  label: 'Needs You',
  group: 'work',
  component: NeedsYou,
  blurb:
    'Everything waiting on David across all machines, oldest first (real queue items and blocked seats; approvals are sample).',
};
