import { useEffect, useMemo, useRef, useState } from 'react';
import type { RigCommandsOutput, RigSpecsOutput } from '@appydave/shared';
import { callVerb } from '../../../fleet/coreCall.js';
import type { FleetSocket } from '../../../fleet/useFleet.js';
import { plannedWord } from '../../../fleet/views.js';
import { agoFrom, useMachineLabel } from '../../data/index.js';
import { PageHeader } from '../../kit/index.js';
import type { PageKey, V2PageDef, V2PageProps } from '../../types.js';
import {
  AGENT_STATUS_WORD,
  STATE_WORD,
  clockOf,
  outcomeOf,
  profileSummary,
  seatModel,
  shortOutput,
  shownCommands,
  shownSpecs,
  type RigCommandRow,
  type ShownEdge,
  type ShownSpec,
} from './model.js';
import './specs.css';

/** How often the page asks again: specs change as a rig is written, commands as they run. */
export const SPECS_POLL_MS = 15_000;
export const COMMANDS_POLL_MS = 3_000;

type Polled<T> =
  | { phase: 'loading' }
  | { phase: 'ok'; value: T }
  | { phase: 'refused'; message: string; last: T | null };

/** One read verb, asked now and again every `everyMs`; the last good answer stays while it re-asks. */
export function usePolledVerb<T>(
  getSocket: () => FleetSocket,
  verb: string,
  everyMs: number
): Polled<T> {
  const [state, setState] = useState<Polled<T>>({ phase: 'loading' });
  const last = useRef<T | null>(null);
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const ask = () => {
      void callVerb<T>(getSocket(), verb, {}).then((a) => {
        if (!live) return;
        if (a.ok) {
          last.current = a.value;
          setState({ phase: 'ok', value: a.value });
        } else setState({ phase: 'refused', message: a.error.message, last: last.current });
        timer = window.setTimeout(ask, everyMs);
      });
    };
    ask();
    return () => {
      live = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [getSocket, verb, everyMs]);
  return state;
}

const valueOf = <T,>(s: Polled<T>): T | null =>
  s.phase === 'ok' ? s.value : s.phase === 'refused' ? s.last : null;

function Edges({ edges, testId }: { edges: ShownEdge[]; testId: string }) {
  return (
    <ul className="rs-edges" data-testid={testId}>
      {edges.map((e, i) => (
        <li key={`${e.from}>${e.to}:${e.kind}:${i}`} data-testid="rs-edge">
          <code>{e.from}</code> <span className="rs-edge-word">{plannedWord(e.kind)}</span>{' '}
          <code>{e.to}</code> <span className="quiet mono">{e.kind}</span>
        </li>
      ))}
    </ul>
  );
}

function SpecDetail({
  spec,
  ctx,
  label,
}: {
  spec: ShownSpec;
  ctx: V2PageProps['ctx'];
  label: (id: string) => string;
}) {
  const fm = ctx.allMachines.find((m) => m.machine.id === (spec.liveMachine ?? spec.machine));
  const liveSeat = (session: string) => fm?.snapshot.seats.find((s) => s.id === session);
  const liveKey = spec.liveMachine ? `${spec.liveMachine}:${spec.name}` : spec.key;
  const elsewhere = spec.liveMachine !== null && spec.liveMachine !== spec.machine;
  const open = (page: PageKey) => {
    ctx.chooseRig(liveKey);
    ctx.goTo(page);
  };
  const seatCount = spec.pods?.reduce((n, p) => n + p.seats.length, 0) ?? 0;
  return (
    <section className="rs-detail" data-testid="rs-detail" data-state={spec.state}>
      <header className="rs-detail-head">
        <h3 data-testid="rs-detail-name">{spec.name}</h3>
        <span className="rs-badge" data-state={spec.state} data-testid="rs-detail-state">
          {STATE_WORD[spec.state]}
        </span>
        <span className="quiet">
          spec on {label(spec.machine)}
          {elsewhere ? ` · launched on ${label(spec.liveMachine!)}` : ''}
          {spec.pods ? ` · ${spec.pods.length} pods · ${seatCount} seats` : ''}
        </span>
      </header>
      {spec.summary && <p className="rs-summary">{spec.summary}</p>}
      {spec.specPath && (
        <p className="quiet rs-path">
          File: <code>{spec.specPath}</code>
        </p>
      )}
      {spec.state !== 'draft' && (
        <p className="rs-links" data-testid="rs-links">
          {elsewhere
            ? `This rig is launched on ${label(spec.liveMachine!)}, from its own copy of the spec.`
            : 'This rig is launched.'}{' '}
          See it live:{' '}
          <button type="button" className="pill-btn" onClick={() => open('graph')}>
            Graph
          </button>{' '}
          <button type="button" className="pill-btn" onClick={() => open('map')}>
            Rig Map
          </button>{' '}
          <button type="button" className="pill-btn" onClick={() => open('run')}>
            Run board
          </button>{' '}
          <button
            type="button"
            className="pill-btn"
            onClick={() => ctx.onOpenFiles(spec.liveMachine ?? spec.machine, spec.name)}
          >
            Files
          </button>
        </p>
      )}
      {spec.state === 'draft' && (
        <p className="quiet" data-testid="rs-draft-note">
          Written but not launched: OpenRig does not know this rig yet, so there are no live seats
          to show. This is what <code>rig up</code> would start.
        </p>
      )}
      {!spec.specValid && (
        <p className="rs-warn" data-testid="rs-invalid">
          OpenRig would refuse this rig.yaml as written, so its pods and edges are not shown.
        </p>
      )}
      {(spec.culture || spec.docs.length > 0) && (
        <p className="rs-docs" data-testid="rs-docs">
          {spec.culture && (
            <>
              Culture: <code>{spec.culture}</code>{' '}
            </>
          )}
          {spec.docs.length > 0 && (
            <>
              Docs:{' '}
              {spec.docs.map((d) => (
                <code key={d}>{d} </code>
              ))}
            </>
          )}
        </p>
      )}

      {spec.pods && (
        <>
          <h4>Pods and seats</h4>
          <div className="rs-pods">
            {spec.pods.map((p) => (
              <div className="rs-pod" key={p.id} data-testid="rs-pod" data-pod={p.id}>
                <div className="rs-pod-head">
                  <b>{p.label}</b> <span className="quiet mono">{p.id}</span>
                </div>
                {p.summary && <p className="rs-pod-summary">{p.summary}</p>}
                <ul className="rs-seats">
                  {p.seats.map((s) => {
                    const live = liveSeat(s.session);
                    const prof = profileSummary(spec.agents, s.agentRef, s.profile);
                    const model = seatModel(spec.agents, s);
                    return (
                      <li key={s.id} className="rs-seat" data-testid="rs-seat">
                        <span className="mono rs-session">{s.session}</span>
                        {live && (
                          <span className="quiet rs-live" data-testid="rs-seat-live">
                            {' '}
                            · {live.status}
                          </span>
                        )}
                        <br />
                        <span className="rs-seat-facts">
                          profile <b data-testid="rs-seat-profile">{s.profile ?? 'not sent'}</b>
                          {s.runtime ? ` · ${s.runtime}` : ''}
                          {model ? ` · ${model}` : ''}
                        </span>
                        {prof && <span className="rs-seat-prof quiet">{prof}</span>}
                      </li>
                    );
                  })}
                </ul>
                {p.edges.length > 0 && (
                  <>
                    <div className="quiet rs-sub">Inside this pod</div>
                    <Edges edges={p.edges} testId="rs-pod-edges" />
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {spec.edges && (
        <>
          <h4>Edges between pods</h4>
          {spec.edges.length > 0 ? (
            <Edges edges={spec.edges} testId="rs-rig-edges" />
          ) : (
            <p className="quiet">None written.</p>
          )}
        </>
      )}

      <h4>AgentSpecs and their profiles</h4>
      {spec.agents === null ? (
        <p className="quiet" data-testid="rs-agents-unsent">
          {label(spec.machine)}&apos;s collector does not send AgentSpecs yet (it predates this
          page).
        </p>
      ) : spec.agents.length === 0 ? (
        <p className="quiet">None named.</p>
      ) : (
        spec.agents.map((a) => (
          <div className="rs-agent" key={a.ref} data-testid="rs-agent">
            <div>
              <code>{a.ref}</code>{' '}
              {a.spec ? (
                <b>
                  {a.spec.name} v{a.spec.version}
                </b>
              ) : (
                <span className="rs-warn">{AGENT_STATUS_WORD[a.status]}</span>
              )}{' '}
              <span className="quiet">used by {a.usedBy.length}</span>
            </div>
            {a.spec?.description && <p className="rs-pod-summary">{a.spec.description}</p>}
            {a.spec && (
              <table className="rs-profiles" data-testid="rs-profiles">
                <thead>
                  <tr>
                    <th>Profile</th>
                    <th>Model</th>
                    <th>What it is for</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(a.spec.profiles).map(([name, p]) => (
                    <tr key={name} data-testid="rs-profile">
                      <td className="mono">{name}</td>
                      <td className="mono">{p.preferences?.model ?? '-'}</td>
                      <td>{p.summary ?? p.description ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))
      )}
      {spec.source === 'live-record' && (
        <p className="quiet" data-testid="rs-live-record">
          From the launched rig&apos;s own record: {label(spec.machine)}&apos;s collector does not
          send its spec scan yet, so profiles and AgentSpecs are not shown.
        </p>
      )}
    </section>
  );
}

function Commands({
  rows,
  selected,
  allRigs,
  setAllRigs,
  status,
  ctx,
  label,
}: {
  rows: RigCommandRow[];
  selected: string | null;
  allRigs: boolean;
  setAllRigs: (v: boolean) => void;
  status: string | null;
  ctx: V2PageProps['ctx'];
  label: (id: string) => string;
}) {
  const shown = shownCommands(rows, selected, allRigs);
  return (
    <section className="rs-commands" data-testid="rs-commands">
      <header className="rs-commands-head">
        <h3>Commands</h3>
        <span className="quiet">
          {allRigs || !selected ? 'every rig' : selected} · newest first · live
        </span>
        <label className="rs-toggle">
          <input
            type="checkbox"
            checked={allRigs}
            onChange={(e) => setAllRigs(e.target.checked)}
            data-testid="rs-all-rigs"
          />{' '}
          All rigs
        </label>
      </header>
      {status && (
        <p className="quiet" data-testid="rs-commands-status">
          {status}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="quiet" data-testid="rs-commands-empty">
          {rows.length === 0
            ? 'No rig commands logged yet.'
            : `No rig command names ${selected ?? 'this rig'} yet. Tick "All rigs" to see the rest.`}
        </p>
      ) : (
        <ol className="rs-cmd-list">
          {shown.map((c, i) => {
            const out = shortOutput(c);
            return (
              <li
                key={`${c.machine}:${c.ts}:${i}`}
                className="rs-cmd"
                data-testid="rs-cmd"
                data-phase={c.phase ?? 'unknown'}
              >
                <span className="rs-cmd-time mono" title={`${c.ts} (${agoFrom(c.ts, ctx.now)})`}>
                  {clockOf(c.ts)}
                </span>
                <span className="rs-cmd-who">{c.actor ?? '?'}</span>
                <code className="rs-cmd-text" title={c.raw ?? undefined}>
                  {c.command ?? c.raw ?? '?'}
                </code>
                <span className="rs-cmd-rig">
                  {c.rig ?? c.rigs[0] ?? <span className="quiet">fleet</span>}
                </span>
                <span className="rs-cmd-outcome" data-phase={c.phase ?? 'unknown'}>
                  {outcomeOf(c)}
                </span>
                <span className="quiet rs-cmd-where">
                  {label(c.machine)}
                  {c.targetHost && c.targetHost !== 'local' ? ` → ${c.targetHost}` : ''}
                </span>
                {out && <span className="rs-cmd-out mono">{out}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function RigSpecs({ ctx }: V2PageProps) {
  const label = useMachineLabel(ctx.allMachines);
  const specsQ = usePolledVerb<RigSpecsOutput>(ctx.getSocket, 'rig.specs', SPECS_POLL_MS);
  const cmdsQ = usePolledVerb<RigCommandsOutput>(ctx.getSocket, 'rig.commands', COMMANDS_POLL_MS);
  const specsValue = valueOf(specsQ);
  const specs = useMemo(
    () => shownSpecs(specsValue, ctx.allMachines),
    [specsValue, ctx.allMachines]
  );
  const [picked, setPicked] = useState<string | null>(null);
  const [allRigs, setAllRigs] = useState(false);
  const selected = specs.find((s) => s.key === picked) ?? specs[0] ?? null;
  const cmds = valueOf(cmdsQ);

  const drafts = specs.filter((s) => s.state === 'draft').length;
  const pending = (specsValue?.machines ?? []).filter((m) => m.status !== 'ok');
  const cmdStatus =
    cmdsQ.phase === 'refused' && !cmds
      ? 'The hub does not have the command feed yet (it runs an older AppyRig), so no commands can be shown.'
      : cmdsQ.phase === 'loading'
        ? 'Reading the command log…'
        : cmds && cmds.machines.every((m) => m.status !== 'ok')
          ? 'No machine has sent its command log yet (older collectors).'
          : null;

  return (
    <main className="view v2-specs" data-testid="v2-specs">
      <PageHeader
        title="Rig specs"
        facts={[
          specsQ.phase === 'loading'
            ? 'loading…'
            : `${specs.length} rig specs · ${drafts} not launched`,
        ]}
      />
      {specsQ.phase === 'refused' && !specsValue && (
        <p className="quiet" data-testid="rs-specs-old-hub">
          The hub does not list unlaunched rigs yet (it runs an older AppyRig). Shown: launched
          rigs, from their own records.
        </p>
      )}
      {pending.length > 0 && (
        <p className="quiet" data-testid="rs-specs-pending">
          {pending.map((m) => label(m.machine)).join(', ')}: not sending its spec scan yet, so only
          launched rigs show for {pending.length === 1 ? 'it' : 'them'}.
        </p>
      )}
      <div className="rs-layout">
        <nav className="rs-list" aria-label="Rig specs" data-testid="rs-list">
          {specs.length === 0 && specsQ.phase !== 'loading' && (
            <p className="quiet" data-testid="rs-none">
              No rig.yaml found in any machine&apos;s spec folders.
            </p>
          )}
          {specs.map((s) => (
            <button
              type="button"
              key={s.key}
              className="rs-item"
              data-testid="rs-item"
              data-state={s.state}
              aria-pressed={s.key === selected?.key}
              onClick={() => setPicked(s.key)}
            >
              <span className="rs-item-name">{s.name}</span>
              <span className="rs-badge" data-state={s.state}>
                {STATE_WORD[s.state]}
              </span>
              <span className="quiet rs-item-where">
                {label(s.machine)}
                {s.liveMachine && s.liveMachine !== s.machine
                  ? ` · runs on ${label(s.liveMachine)}`
                  : ''}
              </span>
            </button>
          ))}
        </nav>
        <div className="rs-main">
          {selected ? (
            <SpecDetail spec={selected} ctx={ctx} label={label} />
          ) : (
            specsQ.phase === 'loading' && <p className="quiet">Reading the rig specs…</p>
          )}
          <Commands
            rows={cmds?.commands ?? []}
            selected={selected?.name ?? null}
            allRigs={allRigs}
            setAllRigs={setAllRigs}
            status={cmdStatus}
            ctx={ctx}
            label={label}
          />
        </div>
      </div>
    </main>
  );
}

export const page: V2PageDef = {
  key: 'specs',
  label: 'Rig specs',
  group: 'fleet',
  component: RigSpecs,
  blurb:
    'Every rig spec on every machine, launched or not: pods, seats, profiles and edges, plus a live feed of rig commands.',
};
