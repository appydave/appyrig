import { useMemo, useState } from 'react';
import type { FleetMachine, HistoryTransitionsOutput, QueueItem } from '@appydave/shared';
import MarkdownView from '../../../components/MarkdownView.js';
import RigPicker from '../../../components/RigPicker.js';
import { useVerb } from '../../data/index.js';
import { MockMark, PageHeader, useDocsDrawer } from '../../kit/index.js';
import HowRunWent from './HowRunWent.js';
import type { V2PageDef, V2PageProps } from '../../types.js';
import { parseMissionJobs, type JobRow } from './jobs.js';
import {
  buildRun,
  clock,
  missionsOnRig,
  parseDoneCheck,
  sampleRun,
  topLine,
  verdictOf,
  type JobState,
  type RunModel,
  type Station,
} from './model.js';
import {
  useMissionFile,
  whyNot,
  type MissionFileKind,
  type MissionFileResult,
} from './useMissionFile.js';
import type { FleetSocket } from '../../../fleet/useFleet.js';
import { useRigDoc, type RigDoc } from './useRigDoc.js';
import './run.css';

/**
 * The four documents a viewer can put beside a job, as tabs in the document column next to
 * before / after (navigation brief: nothing appended below the fold). Spec is the tab at load.
 */
export type DocKey = 'spec' | 'rig' | 'culture' | 'mission';
export const DOC_DEFAULT_TAB: DocKey = 'spec';
/** Which documents are shown at load (one tab: Spec). Kept for callers that read it as a map. */
export const DOC_DEFAULTS: Record<DocKey, boolean> = {
  spec: true,
  rig: false,
  culture: false,
  mission: false,
};
const DOC_LABEL: Record<DocKey, string> = {
  spec: 'Spec',
  rig: 'rig.yaml',
  culture: 'CULTURE.md',
  mission: 'MISSION.md',
};
const RIG_FILE: Record<Exclude<DocKey, 'spec'>, string> = {
  rig: 'rig.yaml',
  culture: 'CULTURE.md',
  mission: 'MISSION.md',
};

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const bare = (raw: string | null) => (raw ?? '?').split('@')[0] || '?';

// ---------------------------------------------------------------- the strip

function Strip({
  run,
  selected,
  onSelect,
}: {
  run: RunModel;
  selected: string | null;
  onSelect: (slice: string) => void;
}) {
  return (
    <section aria-label="Jobs" data-testid="run-strip">
      <div className="run-label">The jobs {run.sample && <MockMark label="sample" />}</div>
      <div className="run-jobs">
        {run.jobs.map((j) => (
          <JobTile
            key={j.job.slice}
            j={j}
            picked={selected === j.job.slice}
            onSelect={() => onSelect(j.job.slice)}
          />
        ))}
      </div>
    </section>
  );
}

/** One job: a button; picking it opens its panel below. */
function JobTile({ j, picked, onSelect }: { j: JobState; picked: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`run-job run-job-${j.status}${picked ? ' run-job-picked' : ''}`}
      aria-pressed={picked}
      onClick={onSelect}
      data-testid="run-job"
      data-job={j.job.slice}
      data-status={j.status}
    >
      <span className="run-job-n">
        {j.job.slice}
        {j.status === 'done' ? ' ✓' : ''}
      </span>
      <span className="run-job-repo">{j.job.title}</span>
      <span className="run-job-foot">
        {j.status === 'waiting' ? (
          <span className="mono">waiting</span>
        ) : (
          <>
            <span>{clock(j.durationMs)}</span>
            <span className={j.rework > 0 ? 'run-rework mono' : 'mono'}>
              {j.status === 'current' && j.holder ? `with ${j.holder} · ` : ''}
              {j.rounds} {j.rounds === 1 ? 'round' : 'rounds'}
              {j.rework > 0 ? ` ↺${j.rework}` : ''}
            </span>
          </>
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------- stations

function Stations({ run, onDocs }: { run: RunModel; onDocs?: (seatId: string) => void }) {
  if (run.stations.length === 0)
    return <p className="quiet">This rig has no seats the machine reports.</p>;
  const arrow = (a: string, b: string) => run.forward.find((x) => x.from === a && x.to === b);
  return (
    <div className="run-stations" data-testid="run-stations">
      {run.stations.map((s, i) => (
        <div key={s.key} className="run-station-wrap">
          <StationBox s={s} sample={run.sample} onDocs={onDocs} />
          {i < run.stations.length - 1 && (
            <span className="run-arrow" aria-hidden="true">
              {'→'} <b className="mono">{arrow(s.seat, run.stations[i + 1]!.seat)?.count ?? ''}</b>
            </span>
          )}
        </div>
      ))}
      {run.sentBack.map((b) => (
        <p key={`${b.from}>${b.to}`} className="run-back" data-testid="run-sent-back">
          {'↺'} sent back {b.count}
          {'×'} {'·'} {b.from} {'→'} {b.to} {'·'} verdict changes or fail
        </p>
      ))}
    </div>
  );
}

function StationBox({
  s,
  sample,
  onDocs,
}: {
  s: Station;
  sample: boolean;
  onDocs?: (seatId: string) => void;
}) {
  return (
    <div
      className={`run-station run-station-${s.state}`}
      data-testid="run-station"
      data-state={s.state}
    >
      <div className="run-station-word">{s.word}</div>
      <div className="run-station-seat mono">{s.seat}</div>
      {s.doing && <div className="run-station-doing">{s.doing}</div>}
      <div className="run-station-state mono">
        {s.state}
        {s.holds > 0 ? ` · ${s.holds} open` : ''} {sample && <MockMark label="sample" />}
      </div>
      {onDocs && (
        <button
          type="button"
          className="pill-btn run-station-docs"
          data-testid="run-station-docs"
          onClick={() => onDocs(s.key)}
        >
          Docs
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- documents

function FileView({ r, kind }: { r: MissionFileResult; kind: MissionFileKind }) {
  if (r.status !== 'ok')
    return (
      <p className="quiet" data-testid="run-doc-missing">
        {whyNot(r, kind)}
      </p>
    );
  const isHtml = (r.mime ?? '').includes('html') || /\.html?$/i.test(r.path);
  if (isHtml)
    return (
      <iframe
        title={r.path}
        className="run-frame"
        sandbox=""
        srcDoc={r.text ?? ''}
        data-testid="run-doc-html"
      />
    );
  return (
    <div className="run-md" data-testid="run-doc-md">
      <MarkdownView source={r.text ?? ''} />
    </div>
  );
}

const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** A job's spec: one file, or a small picker when the jobs table names more than one. */
function SpecPanel({
  getSocket,
  machine,
  rig,
  job,
}: {
  getSocket: () => FleetSocket;
  machine: string;
  rig: string;
  job: JobRow;
}) {
  const [pick, setPick] = useState(0);
  const path = job.specPaths[pick] ?? null;
  return (
    <div className="run-doc" data-testid="run-doc-spec">
      <div className="run-doc-head">
        <b>Spec</b>
        {job.specPaths.length > 1 && (
          <span role="tablist" aria-label="Spec files" className="run-spec-tabs">
            {job.specPaths.map((p, i) => (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={pick === i}
                className="pill-btn"
                data-testid="run-spec-tab"
                onClick={() => setPick(i)}
              >
                {base(p)}
              </button>
            ))}
          </span>
        )}
      </div>
      {path ? (
        <>
          <div className="run-doc-src mono">{path}</div>
          <SpecFile getSocket={getSocket} machine={machine} rig={rig} path={path} />
        </>
      ) : (
        <p className="quiet" data-testid="run-spec-none">
          This job&apos;s row names no spec file.
        </p>
      )}
      {job.specNote && (
        <p className="quiet run-doc-note" data-testid="run-spec-note">
          {job.specNote}
        </p>
      )}
    </div>
  );
}

function SpecFile({
  getSocket,
  machine,
  rig,
  path,
}: {
  getSocket: () => FleetSocket;
  machine: string;
  rig: string;
  path: string;
}) {
  return <FileView r={useMissionFile(getSocket, machine, rig, path)} kind="spec" />;
}

function RigFilePanel({ doc, which, name }: { doc: RigDoc; which: DocKey; name: string }) {
  return (
    <div className="run-doc" data-testid={`run-doc-${which}`}>
      <div className="run-doc-head">
        <b>{name}</b>
      </div>
      {doc.status === 'ok' ? (
        name.endsWith('.md') ? (
          <div className="run-md">
            <MarkdownView source={doc.text ?? ''} />
          </div>
        ) : (
          <pre className="run-pre">{doc.text}</pre>
        )
      ) : (
        <p className="quiet" data-testid="run-doc-missing">
          {doc.status === 'loading' ? 'reading…' : (doc.why ?? 'not available')}
        </p>
      )}
    </div>
  );
}

function RigDocs({
  ctx,
  machine,
  rig,
  on,
}: {
  ctx: V2PageProps['ctx'];
  machine: string;
  rig: string;
  on: Record<DocKey, boolean>;
}) {
  const g = ctx.getSocket;
  // Each file is read the first time its tab opens, and kept while the job is shown.
  const rigYaml = useRigDoc(g, machine, rig, RIG_FILE.rig, on.rig);
  const culture = useRigDoc(g, machine, rig, RIG_FILE.culture, on.culture);
  const mission = useRigDoc(g, machine, rig, RIG_FILE.mission, on.mission);
  return (
    <>
      {on.rig && <RigFilePanel doc={rigYaml} which="rig" name="rig.yaml" />}
      {on.culture && <RigFilePanel doc={culture} which="culture" name="CULTURE.md" />}
      {on.mission && <RigFilePanel doc={mission} which="mission" name="MISSION.md" />}
    </>
  );
}

// ---------------------------------------------------------------- the selected job

function Shot({
  getSocket,
  machine,
  rig,
  path,
  label,
}: {
  getSocket: () => FleetSocket;
  machine: string;
  rig: string;
  path: string;
  label: string;
}) {
  const r = useMissionFile(getSocket, machine, rig, path);
  return (
    <figure className="run-shot" data-testid="run-shot">
      {r.status === 'ok' && r.base64 ? (
        <img src={`data:${r.mime ?? 'image/png'};base64,${r.base64}`} alt={label} />
      ) : (
        <div className="run-shot-empty quiet">{whyNot(r, 'shot')}</div>
      )}
      <figcaption className="mono">
        {label} {'·'} {path}
      </figcaption>
    </figure>
  );
}

function DoneCheck({
  getSocket,
  machine,
  rig,
  slice,
}: {
  getSocket: () => FleetSocket;
  machine: string;
  rig: string;
  slice: string;
}) {
  const r = useMissionFile(getSocket, machine, rig, `qa/${slice}.md`);
  const d = r.status === 'ok' ? parseDoneCheck(r.text ?? '') : null;
  const cell = (k: string, v: string | null | undefined) => (
    <div className={`run-chk${v ? ' run-chk-ok' : ''}`} data-testid="run-chk" data-field={k}>
      <div className="run-chk-k">{k.replace('_', ' ')}</div>
      <div className="run-chk-v">{v ?? whyNot(r, 'qa')}</div>
    </div>
  );
  return (
    <div className="run-check" data-testid="run-check">
      {cell('proof', d?.proof)}
      {cell('test_audit', d?.test_audit)}
      {cell('before_after', d?.before_after)}
      {cell('duration', d?.duration)}
    </div>
  );
}

function JobPanel({
  ctx,
  machine,
  rig,
  j,
  tab,
  setTab,
}: {
  ctx: V2PageProps['ctx'];
  machine: string;
  rig: string;
  j: JobState;
  tab: DocKey;
  setTab: (k: DocKey) => void;
}) {
  const on = {
    spec: tab === 'spec',
    rig: tab === 'rig',
    culture: tab === 'culture',
    mission: tab === 'mission',
  };
  return (
    <section className="run-detail" data-testid="run-detail" data-job={j.job.slice}>
      <div className="run-detail-head">
        <div>
          <div className="run-label">
            Selected job {'·'} {j.status}
          </div>
          <h3 className="run-h">
            Job {j.job.slice} {'·'} {j.job.title}
          </h3>
          {j.job.branch && <div className="mono quiet">{j.job.branch}</div>}
        </div>
      </div>
      <div className="run-cols">
        <div className="run-col">
          <div className="run-doc">
            <div className="run-doc-head">
              <b>Before / after</b>
            </div>
            <div className="run-shots">
              <Shot
                getSocket={ctx.getSocket}
                machine={machine}
                rig={rig}
                path={`shots/${j.job.slice}-before.png`}
                label="before"
              />
              <Shot
                getSocket={ctx.getSocket}
                machine={machine}
                rig={rig}
                path={`shots/${j.job.slice}-after.png`}
                label="after"
              />
            </div>
          </div>
          <div className="run-doc">
            <div className="run-doc-head">
              <b>Done-check</b>
            </div>
            <DoneCheck getSocket={ctx.getSocket} machine={machine} rig={rig} slice={j.job.slice} />
          </div>
        </div>
        <div className="run-col run-doc-col" data-testid="run-docs">
          <div className="run-tabs" role="tablist" aria-label="Document beside this job">
            {(Object.keys(DOC_LABEL) as DocKey[]).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                className="run-tab"
                data-testid={`run-tog-${k}`}
                aria-selected={tab === k}
                aria-pressed={tab === k}
                onClick={() => setTab(k)}
              >
                {DOC_LABEL[k]}
              </button>
            ))}
          </div>
          <div className="run-tab-body" role="tabpanel" data-testid="run-tab-body">
            {on.spec && (
              <SpecPanel getSocket={ctx.getSocket} machine={machine} rig={rig} job={j.job} />
            )}
            <RigDocs ctx={ctx} machine={machine} rig={rig} on={on} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- ledger

function Ledger({
  ctx,
  machine,
  rig,
  items,
  fm,
}: {
  ctx: V2PageProps['ctx'];
  machine: string;
  rig: string;
  items: QueueItem[];
  fm: FleetMachine;
}) {
  const t = useVerb<HistoryTransitionsOutput>(ctx.getSocket, 'history.transitions', {
    machine,
    rig,
    limit: 200,
  });
  const byId = useMemo(() => new Map(items.map((q) => [q.id, q])), [items]);
  const rows = useMemo(() => {
    if (t.phase === 'ok' && t.value.rows.length > 0) {
      return t.value.rows
        .filter((r) => byId.has(r.qitemId))
        .map((r) => ({
          key: `t${r.id}`,
          at: r.at,
          q: byId.get(r.qitemId)!,
          state: r.state,
          closure: r.closureReason,
          exact: true,
        }));
    }
    return items.map((q) => ({
      key: q.id,
      at: q.createdAt,
      q,
      state: q.state,
      closure: null as string | null,
      exact: false,
    }));
  }, [t, items, byId]);
  const sorted = [...rows].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);
  void fm;
  return (
    <section data-testid="run-ledger">
      <div className="run-label">What just happened</div>
      {sorted.length === 0 ? (
        <p className="quiet">No handoff of this mission yet.</p>
      ) : (
        <ul className="run-ledger">
          {sorted.map((r) => {
            const v = verdictOf(r.q.tags);
            return (
              <li key={r.key} data-testid="run-ledger-row">
                <span className="mono quiet" title={r.at}>
                  {hhmm(r.at)}
                </span>{' '}
                <b>
                  {bare(r.q.source)} {'→'} {bare(r.q.destination)}
                </b>{' '}
                {v && (
                  <span
                    className={`run-chip run-chip-${v}`}
                    data-testid="run-verdict"
                    data-verdict={v}
                  >
                    {v}
                  </span>
                )}{' '}
                <span className="quiet">{r.state}</span>
                {r.closure ? (
                  <span className="quiet">
                    {' '}
                    {'·'} {r.closure}
                  </span>
                ) : null}
                <br />
                {(r.q.summary ?? r.q.id).split('\n')[0]}
              </li>
            );
          })}
        </ul>
      )}
      {t.phase !== 'ok' && t.phase !== 'loading' && (
        <p className="quiet" data-testid="run-ledger-fallback">
          Exact times need the hub&apos;s history; showing each handoff when it was queued.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- the page

function RunBoard({ ctx }: V2PageProps) {
  const rig = ctx.activeRig;
  const fm = rig ? ctx.allMachines.find((m) => m.machine.id === rig.machineId) : undefined;
  const machine = rig?.machineId ?? '';
  const mdoc = useRigDoc(ctx.getSocket, machine, rig?.name ?? '', 'MISSION.md', !!rig);
  const jobs = useMemo(
    () => (mdoc.status === 'ok' ? parseMissionJobs(mdoc.text ?? '') : []),
    [mdoc]
  );
  const missions = useMemo(() => (fm && rig ? missionsOnRig(fm, rig.name) : []), [fm, rig]);
  const [missionPick, setMissionPick] = useState<string | null>(null);
  const missionId =
    missionPick && missions.includes(missionPick) ? missionPick : (missions[0] ?? null);
  const real = useMemo(
    () => (fm && rig ? buildRun(fm, rig.name, jobs, ctx.now, missionId) : null),
    [fm, rig, jobs, ctx.now, missionId]
  );
  const [preview, setPreview] = useState(false);
  const run = useMemo(
    () =>
      preview && real && fm && rig && real.jobs.length > 0 ? sampleRun(real, fm, rig.name) : real,
    [preview, real, fm, rig]
  );
  const { openDocs, drawer } = useDocsDrawer(ctx);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<DocKey>(DOC_DEFAULT_TAB);

  const selected =
    run && run.jobs.length
      ? (run.jobs.find((j) => j.job.slice === sel) ??
        (run.currentIndex !== null ? run.jobs[run.currentIndex] : run.jobs[0]))
      : null;

  return (
    <main className="view w4-page run-page" data-testid="v2-run">
      <RigPicker
        rigs={ctx.rigs}
        selected={rig?.key ?? null}
        onSelect={ctx.chooseRig}
        info={false}
      />
      {!rig && (
        <>
          <PageHeader title="Run board" facts={['no rig chosen']} />
          <p className="empty">Pick a rig.</p>
        </>
      )}
      {rig && fm && run && (
        <>
          <PageHeader
            title="Run board"
            facts={[
              <span
                key="top"
                className="run-title"
                data-testid="run-topline"
                data-phase={run.phase}
              >
                {mdoc.status === 'unread'
                  ? 'Mission file not read'
                  : mdoc.status === 'missing'
                    ? 'This rig has no MISSION.md'
                    : topLine(run)}{' '}
                {run.sample && <MockMark label="sample" />}
              </span>,
              <span key="meta" className="run-meta mono" data-testid="run-top">
                {rig.name} on {rig.machineLabel}
                {missions.length === 1 && ` \u00b7 mission ${missions[0]}`}
              </span>,
              ...(mdoc.status !== 'ok' && mdoc.status !== 'loading'
                ? [
                    <span key="unread" className="run-note" data-testid="run-mission-unread">
                      MISSION.md not readable from {rig.machineLabel}
                      {mdoc.why ? ` (${mdoc.why})` : ''}: not the same as no jobs
                    </span>,
                  ]
                : []),
              ...(run.phase === 'no-jobs' && mdoc.status === 'ok'
                ? [
                    <span key="nojobs" className="run-note" data-testid="run-no-jobs">
                      This rig&apos;s MISSION.md has no jobs table
                    </span>,
                  ]
                : []),
              ...(run.phase === 'running' && !run.verdictTagged && !run.sample
                ? [
                    <span key="noverdict" className="run-note" data-testid="run-no-verdicts">
                      no <code>verdict:</code> tags, so rework is not counted
                    </span>,
                  ]
                : []),
            ]}
            actions={
              <>
                {missions.length > 1 && (
                  <select
                    aria-label="Mission"
                    value={missionId ?? ''}
                    data-testid="run-mission"
                    onChange={(e) => setMissionPick(e.target.value)}
                  >
                    {missions.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                )}
                {real && real.jobs.length > 0 && (
                  <button
                    type="button"
                    className="pill-btn run-preview"
                    data-testid="run-preview"
                    aria-pressed={preview}
                    onClick={() => setPreview((v) => !v)}
                  >
                    {preview ? 'Back to the real run' : 'Preview a mid-run (sample)'}
                  </button>
                )}
              </>
            }
          />
          {run.jobs.length > 0 && (
            <Strip run={run} selected={selected?.job.slice ?? null} onSelect={setSel} />
          )}
          <Stations
            run={run}
            onDocs={(seatId) =>
              openDocs({
                machineId: machine,
                seat: fm.snapshot.seats.find((x) => x.id === seatId) ?? null,
                rig: rig.name,
                missionPaths: [...new Set(run.jobs.flatMap((j) => j.job.specPaths))],
              })
            }
          />
          <HowRunWent fm={fm} rig={rig.name} run={run} now={ctx.now} />
          <div className="run-lower">
            {selected ? (
              <JobPanel
                ctx={ctx}
                machine={machine}
                rig={rig.name}
                j={selected}
                tab={tab}
                setTab={setTab}
              />
            ) : (
              <div />
            )}
            {!run.sample && (
              <Ledger ctx={ctx} machine={machine} rig={rig.name} items={run.items} fm={fm} />
            )}
          </div>
        </>
      )}
      {drawer}
    </main>
  );
}

export const page: V2PageDef = {
  key: 'run',
  label: 'Run board',
  group: 'fleet',
  component: RunBoard,
  blurb:
    'A mission’s jobs one by one: who holds the job now, rework, and each job’s spec beside its before and after.',
};
