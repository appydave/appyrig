import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RigFileOutput, RigFilesOutput } from '@appydave/shared';
import { callVerb } from '../../../fleet/coreCall.js';
import MarkdownView from '../../../components/MarkdownView.js';
import '../../data/coverage.css';
import './missions.css';
import { DocsDrawer, FakeControl, MockMark, PageHeader, SampleData } from '../../kit/index.js';
import { useUrlParam } from '../../shell/urlState.js';
import { useRigDoc } from '../run/useRigDoc.js';
import type { V2PageDef, V2PageProps } from '../../types.js';
import {
  deriveMissions,
  deriveUnattributed,
  missionDocSummary,
  pct,
  sampleMission,
  untaggedMissionCount,
  type Mission,
  type Slice,
} from './model.js';

const SHOWN_JOBS = 6;
const firstLine = (s: string | null) => (s ?? '').split('\n')[0]!.trim();

function Bar({ value, label }: { value: number; label: string }) {
  return (
    <span
      className="ms-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      <span className="ms-bar-fill" style={{ width: pct(value) }} />
    </span>
  );
}

/**
 * The mission's own MISSION.md, read from ITS machine's rig only (rig.files / rig.file with that
 * machine), never from a same-named rig on another machine.
 */
function MissionDoc({ mission, ctx }: { mission: Mission; ctx: V2PageProps['ctx'] }) {
  const [doc, setDoc] = useState<{ rig: string; machineId: string; text: string } | 'none' | null>(
    null
  );
  const { getSocket } = ctx;
  // A stable key: every snapshot tick makes a new `rigs` array, but only a change in WHICH rigs
  // the mission touches may re-read its files.
  const rigsKey = mission.rigs.map((r) => `${r.machineId}:${r.rig}`).join('|');
  const rigsRef = useRef(mission.rigs);
  rigsRef.current = mission.rigs;
  useEffect(() => {
    let live = true;
    const socket = getSocket();
    void (async () => {
      for (const r of rigsRef.current) {
        const files = await callVerb<RigFilesOutput>(socket, 'rig.files', {
          machine: r.machineId,
          rig: r.rig,
        });
        const f = files.ok ? files.value.files.find((x) => /^MISSION.*\.md$/i.test(x.name)) : null;
        if (!f) continue;
        const got = await callVerb<RigFileOutput>(socket, 'rig.file', {
          machine: r.machineId,
          rig: r.rig,
          fileId: f.id,
        });
        if (got.ok) {
          if (live) setDoc({ rig: r.rig, machineId: r.machineId, text: got.value.file.content });
          return;
        }
      }
      if (live) setDoc('none');
    })();
    return () => {
      live = false;
    };
  }, [mission.key, rigsKey, getSocket]);
  if (doc === null) return <p className="quiet">Looking for a MISSION.md in its rigs…</p>;
  if (doc === 'none')
    return (
      <p className="quiet" data-testid="ms-nodoc">
        No MISSION.md found in {mission.rig} on {mission.machineLabel} (or its collector has not
        sent one).
      </p>
    );
  const { title } = missionDocSummary(doc.text);
  return (
    <div className="ms-doc" data-testid="ms-doc">
      <p>
        <b>{title}</b> <span className="quiet">from {doc.rig}&apos;s MISSION.md</span>{' '}
        <button
          type="button"
          className="pill-btn"
          onClick={() => ctx.onOpenFiles(doc.machineId, doc.rig)}
        >
          Open its files
        </button>
      </p>
      <div className="ms-doc-md" data-testid="ms-doc-md">
        <MarkdownView source={doc.text} />
      </div>
    </div>
  );
}

/** Which rig's MISSION.md the reader is open on. */
interface MissionTarget {
  machineId: string;
  rig: string;
}

function ReadMission({ onRead, label }: { onRead: () => void; label?: string }) {
  return (
    <button
      type="button"
      className="pill-btn ms-read"
      data-testid="ms-read-mission"
      onClick={onRead}
    >
      {label ?? 'Read MISSION.md'}
    </button>
  );
}

/**
 * The picked rig's own mission, at the top of the page: its MISSION.md title and a Read action.
 * Missions below come from queue tags; this one is the rig's file, so a rig with a mission file
 * (d09-crew) always shows it, tagged jobs or not.
 */
function RigMission({
  ctx,
  machineId,
  rig,
  machineLabel,
  onRead,
}: {
  ctx: V2PageProps['ctx'];
  machineId: string;
  rig: string;
  machineLabel: string;
  onRead: () => void;
}) {
  const doc = useRigDoc(ctx.getSocket, machineId, rig, 'MISSION.md', true);
  if (doc.status === 'loading')
    return (
      <p className="quiet ms-rig-mission" data-testid="ms-rig-mission" data-state="loading">
        Looking for {rig}&apos;s MISSION.md…
      </p>
    );
  if (doc.status !== 'ok')
    return (
      <p className="quiet ms-rig-mission" data-testid="ms-rig-mission" data-state={doc.status}>
        {doc.status === 'missing'
          ? `${rig} on ${machineLabel} has no MISSION.md.`
          : `${rig}'s MISSION.md could not be read from ${machineLabel}${doc.why ? ` (${doc.why})` : ''}.`}
      </p>
    );
  const { title, lead } = missionDocSummary(doc.text ?? '');
  return (
    <section className="ms-rig-mission" data-testid="ms-rig-mission" data-state="ok">
      <div className="ms-rig-mission-k">
        {rig}&apos;s mission <span className="quiet">· {machineLabel} · MISSION.md</span>
      </div>
      <div className="ms-rig-mission-row">
        <b className="ms-rig-mission-title" data-testid="ms-rig-mission-title">
          {title || 'MISSION.md'}
        </b>
        <ReadMission onRead={onRead} />
      </div>
      {lead && <p className="quiet ms-rig-mission-lead">{lead.replace(/\*\*|__|`/g, '')}</p>}
    </section>
  );
}

function SliceRow({ slice }: { slice: Slice }) {
  const [all, setAll] = useState(false);
  const jobs = all ? slice.jobs : slice.jobs.slice(0, SHOWN_JOBS);
  return (
    <li className="ms-slice" data-testid="ms-slice" data-slice={slice.id}>
      <div className="ms-slice-head">
        <b>{slice.id}</b>
        <Bar value={slice.progress} label={`${slice.id} progress`} />
        <span className="ms-num">
          {slice.done} of {slice.jobs.length} jobs done
          {slice.notDone > 0 && `, ${slice.notDone} closed without being done`}
        </span>
        {slice.holders.length > 0 && (
          <span className="quiet">held by {slice.holders.join(', ')}</span>
        )}
      </div>
      <ul className="ms-jobs">
        {jobs.map((j) => (
          <li key={`${j.machineId}:${j.item.id}`} data-testid="ms-job" data-open={j.open}>
            <span
              className={`ms-state ${j.open ? 'ms-open' : j.outcome === 'done' ? 'ms-done' : 'ms-notdone'}`}
              data-outcome={j.outcome}
            >
              {j.open ? 'open' : j.item.state}
            </span>{' '}
            {firstLine(j.item.summary) || j.item.id}{' '}
            <span className="quiet">
              {j.open
                ? `held by ${j.holder}`
                : j.outcome === 'done'
                  ? 'closed'
                  : 'closed, not done'}{' '}
              · {j.machineLabel}
            </span>
          </li>
        ))}
        {slice.jobs.length > SHOWN_JOBS && (
          <li>
            <button type="button" className="pill-btn" onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `and ${slice.jobs.length - SHOWN_JOBS} more`}
            </button>
          </li>
        )}
      </ul>
    </li>
  );
}

function MissionCard({
  mission,
  ctx,
  open,
  toggle,
  onRead,
}: {
  mission: Mission;
  ctx: V2PageProps['ctx'];
  open: boolean;
  toggle: () => void;
  onRead: (t: MissionTarget) => void;
}) {
  return (
    <section
      className="ms-mission"
      data-testid="ms-mission"
      data-mission={mission.id}
      data-mission-key={mission.key}
      data-machine={mission.machineId}
    >
      <h3>
        <button
          type="button"
          className="ms-toggle"
          aria-expanded={open}
          onClick={toggle}
          data-testid="ms-toggle"
        >
          {open ? '▾' : '▸'} {mission.id}
        </button>{' '}
        <Bar value={mission.progress} label={`${mission.id} progress`} />
        <span className="ms-num">
          {mission.done} of {mission.done + mission.open + mission.notDone} jobs done
          {mission.notDone > 0 && `, ${mission.notDone} closed without being done`} ·{' '}
          {mission.slices.length} {mission.slices.length === 1 ? 'slice' : 'slices'}
        </span>
      </h3>
      <p className="quiet">
        on{' '}
        <span
          className="chip ms-machine"
          data-testid="ms-machine"
          title="The machine this mission runs on"
        >
          {mission.machineLabel}
        </span>{' '}
        · rig <span className="mono">{mission.rig}</span>{' '}
        <ReadMission onRead={() => onRead({ machineId: mission.machineId, rig: mission.rig })} />
      </p>
      {open && (
        <>
          <MissionDoc mission={mission} ctx={ctx} />
          <ul className="ms-slices">
            {mission.slices.map((s) => (
              <SliceRow key={s.id} slice={s} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Assign({ job }: { job: string }) {
  const [to, setTo] = useState<string | null>(null);
  return to ? (
    <span data-testid="ms-assigned">
      assigned to {to} (pretend) <MockMark />
    </span>
  ) : (
    <span>
      <button
        type="button"
        className="pill-btn"
        data-testid="ms-assign"
        onClick={() => setTo('you')}
      >
        Assign
      </button>
      <span className="visually-hidden"> {job}</span>
    </span>
  );
}

function Missions({ ctx }: V2PageProps) {
  const allMissions = useMemo(() => deriveMissions(ctx.machines), [ctx.machines]);
  const unresolved = useMemo(() => untaggedMissionCount(ctx.machines), [ctx.machines]);
  const allLoose = useMemo(() => deriveUnattributed(ctx.machines), [ctx.machines]);
  const sample = useMemo(() => sampleMission(ctx.allMachines), [ctx.allMachines]);
  const [openId, setOpenId] = useState<string | null>(null);
  // Navigation model: a rig picked in the Rigs drawer filters Missions to that rig, until the viewer
  // asks for "× all rigs" (remembered for that pick only: a new pick filters again).
  const pick = ctx.pickedRig;
  const [allFor, setAllFor] = useState<string | null>(null);
  // Every pick in the drawer filters again, the same rig picked twice included (focusNonce).
  useEffect(() => setAllFor(null), [ctx.focusNonce]);
  const scoped = !!pick && allFor !== pick.key;
  const inPick = (m: { machineId: string; rig: string }) =>
    !!pick && m.machineId === pick.machineId && m.rig === pick.name;
  const missions = scoped ? allMissions.filter(inPick) : allMissions;
  const loose = scoped ? allLoose.filter(inPick) : allLoose;
  const current = openId ?? missions[0]?.key ?? null;

  // The MISSION.md reader. `doc=mission` in the address opens it (on the picked rig, or the rig a
  // Read button named), so `page=missions&rig=d09-crew@m2&doc=mission` is a link to the mission.
  const [docUrl, setDocUrl] = useUrlParam('doc');
  const [readFor, setReadFor] = useState<MissionTarget | null>(null);
  const reading =
    docUrl === 'mission'
      ? (readFor ?? (pick ? { machineId: pick.machineId, rig: pick.name } : null))
      : null;
  const readMission = useCallback(
    (t: MissionTarget) => {
      setReadFor(t);
      setDocUrl('mission');
    },
    [setDocUrl]
  );
  const closeReader = useCallback(() => {
    setReadFor(null);
    setDocUrl(null);
  }, [setDocUrl]);

  return (
    <main className="view v2-missions" data-testid="v2-missions">
      <PageHeader
        title="Missions"
        facts={[
          scoped
            ? `${missions.length} of ${allMissions.length} missions`
            : `${missions.length} mission${missions.length === 1 ? '' : 's'} from queue tags`,
          ...(unresolved > 0 ? [`${unresolved} jobs with no mission`] : []),
        ]}
        mocks={
          <>
            <FakeControl
              label="New mission"
              question="Create a new mission?"
              result="Mission created (pretend)"
            />
            <FakeControl
              label="New slice"
              question="Add a slice to the chosen mission?"
              result="Slice added (pretend)"
            />
          </>
        }
      />
      {pick && (
        <p className="ms-scope" data-testid="ms-scope" data-scoped={scoped}>
          {scoped ? (
            <>
              <span className="chip ms-scope-chip" data-testid="ms-scope-chip">
                Only {pick.name} · {pick.machineLabel}
              </span>{' '}
              <button
                type="button"
                className="pill-btn"
                data-testid="ms-all-rigs"
                onClick={() => setAllFor(pick.key)}
              >
                × all rigs
              </button>
            </>
          ) : (
            <button
              type="button"
              className="pill-btn"
              data-testid="ms-only-rig"
              onClick={() => setAllFor(null)}
            >
              Only {pick.name} · {pick.machineLabel}
            </button>
          )}
        </p>
      )}
      {pick && (
        <RigMission
          key={`rig-mission:${pick.key}`}
          ctx={ctx}
          machineId={pick.machineId}
          rig={pick.name}
          machineLabel={pick.machineLabel}
          onRead={() => readMission({ machineId: pick.machineId, rig: pick.name })}
        />
      )}
      <div className="v2-explainer">
        <p className="quiet">Mission, then slices, then jobs, with progress and who holds what.</p>
        <p className="quiet" data-testid="ms-real-note">
          Real, but not OpenRig&apos;s own mission model (that store is empty on this fleet): read
          from <code>mission:</code> and <code>slice:</code> tags on queue items. Each item is a
          job; open means a seat still holds it.
        </p>
      </div>
      {unresolved > 0 && (
        <p className="quiet v2-explainer" data-testid="ms-unresolved">
          {unresolved} jobs carry a slice tag but no mission tag, so they belong to no mission. They
          are listed below as unattributed jobs, with no progress.
        </p>
      )}
      {missions.length === 0 ? (
        <p className="quiet" data-testid="ms-none">
          {scoped
            ? `No mission in ${pick!.name} on ${pick!.machineLabel}: no queue item there carries a mission: tag.`
            : 'No queue item carries a mission: or slice: tag on the machines shown.'}
        </p>
      ) : (
        missions.map((m) => (
          <MissionCard
            key={m.key}
            mission={m}
            ctx={ctx}
            open={current === m.key}
            toggle={() => setOpenId(current === m.key ? '' : m.key)}
            onRead={readMission}
          />
        ))
      )}

      {loose.length > 0 && (
        <section data-testid="ms-unattributed">
          <h3>Unattributed jobs</h3>
          <p className="quiet">
            Tagged with a slice but not a mission, so there is nothing to measure progress against.
          </p>
          {loose.map((g) => (
            <div key={`${g.machineId}:${g.rig}`} className="ms-mission" data-testid="ms-unattr-rig">
              <b>{g.rig}</b>{' '}
              <span className="quiet">
                on {g.machineLabel} · {g.jobs.length} {g.jobs.length === 1 ? 'job' : 'jobs'}
              </span>
              <ul className="ms-jobs">
                {g.jobs.slice(0, SHOWN_JOBS).map((j) => (
                  <li key={j.item.id} data-testid="ms-job" data-open={j.open}>
                    <span className="ms-state" data-outcome={j.outcome}>
                      {j.open ? 'open' : j.item.state}
                    </span>{' '}
                    {firstLine(j.item.summary) || j.item.id}{' '}
                    <span className="quiet">
                      {(j.item.tags.find((t) => t.startsWith('slice')) ?? 'slice').replace(
                        'slice:',
                        'slice '
                      )}
                    </span>
                  </li>
                ))}
                {g.jobs.length > SHOWN_JOBS && (
                  <li className="quiet">and {g.jobs.length - SHOWN_JOBS} more</li>
                )}
              </ul>
            </div>
          ))}
        </section>
      )}

      <SampleData
        title={`Example mission: ${sample.name}`}
        what="A made-up mission tree, with real rig and seat names, to show the shape OpenRig's mission store would give: slices, progress per slice, and which agent holds which job."
      >
        <ul className="ms-slices" data-testid="ms-sample">
          {sample.slices.map((s) => (
            <li key={s.name} className="ms-slice" data-testid="ms-sample-slice">
              <div className="ms-slice-head">
                <b>{s.name}</b>
                <Bar value={s.progress} label={`${s.name} progress`} />
                <span className="ms-num">{pct(s.progress)}</span>
              </div>
              <ul className="ms-jobs">
                {s.jobs.map((j) => (
                  <li key={j.title}>
                    <span className={`ms-state ms-${j.state}`}>{j.state}</span> {j.title}{' '}
                    <span className="quiet">
                      held by {j.holder} in {j.rig} on {j.machine}
                    </span>{' '}
                    {j.state !== 'done' && <Assign job={j.title} />}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </SampleData>
      {reading && (
        <DocsDrawer
          key={`reader:${reading.machineId}:${reading.rig}`}
          getSocket={ctx.getSocket}
          target={{ machineId: reading.machineId, rig: reading.rig, open: 'MISSION.md' }}
          onClose={closeReader}
        />
      )}
    </main>
  );
}

export const page: V2PageDef = {
  key: 'missions',
  label: 'Missions',
  group: 'work',
  component: Missions,
  blurb: 'Mission, slices, jobs and progress: read from queue tags, plus a labelled example tree.',
};
