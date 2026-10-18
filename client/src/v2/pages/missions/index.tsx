import { useEffect, useMemo, useState } from 'react';
import type { RigFileOutput, RigFilesOutput } from '@appydave/shared';
import { callVerb } from '../../../fleet/coreCall.js';
import { FakeControl, MockMark, SampleData } from '../../kit/index.js';
import type { V2PageDef, V2PageProps } from '../../types.js';
import {
  deriveMissions,
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

/** The mission's own MISSION.md, when a rig of it has one (read through rig.files / rig.file). */
function MissionDoc({ mission, ctx }: { mission: Mission; ctx: V2PageProps['ctx'] }) {
  const [doc, setDoc] = useState<{ rig: string; machineId: string; text: string } | 'none' | null>(
    null
  );
  const { getSocket } = ctx;
  useEffect(() => {
    let live = true;
    const socket = getSocket();
    void (async () => {
      for (const r of mission.rigs) {
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
  }, [mission.id, mission.rigs, getSocket]);
  if (doc === null) return <p className="quiet">Looking for a MISSION.md in its rigs…</p>;
  if (doc === 'none')
    return (
      <p className="quiet" data-testid="ms-nodoc">
        No MISSION.md found in its rigs&apos; folders (or no collector has sent one).
      </p>
    );
  const { title, lead } = missionDocSummary(doc.text);
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
      <p className="quiet">{lead}</p>
    </div>
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
        </span>
        {slice.holders.length > 0 && (
          <span className="quiet">held by {slice.holders.join(', ')}</span>
        )}
      </div>
      <ul className="ms-jobs">
        {jobs.map((j) => (
          <li key={`${j.machineId}:${j.item.id}`} data-testid="ms-job" data-open={j.open}>
            <span className={`ms-state ${j.open ? 'ms-open' : 'ms-done'}`}>
              {j.open ? 'open' : j.item.state}
            </span>{' '}
            {firstLine(j.item.summary) || j.item.id}{' '}
            <span className="quiet">
              {j.open ? `held by ${j.holder}` : 'closed'} · {j.machineLabel}
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
}: {
  mission: Mission;
  ctx: V2PageProps['ctx'];
  open: boolean;
  toggle: () => void;
}) {
  return (
    <section className="ms-mission" data-testid="ms-mission" data-mission={mission.id}>
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
          {mission.done} of {mission.done + mission.open} jobs done · {mission.slices.length}{' '}
          {mission.slices.length === 1 ? 'slice' : 'slices'}
        </span>
      </h3>
      <p className="quiet">on {mission.machines.join(', ')}</p>
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
  const missions = useMemo(() => deriveMissions(ctx.machines), [ctx.machines]);
  const unresolved = useMemo(() => untaggedMissionCount(ctx.machines), [ctx.machines]);
  const sample = useMemo(() => sampleMission(ctx.allMachines), [ctx.allMachines]);
  const [openId, setOpenId] = useState<string | null>(null);
  const current = openId ?? missions[0]?.id ?? null;

  return (
    <main className="view v2-missions" data-testid="v2-missions">
      <h2>Missions</h2>
      <p className="quiet">
        Mission, then slices, then jobs, with progress and who holds what.{' '}
        <FakeControl
          label="New mission"
          question="Create a new mission?"
          result="Mission created (pretend)"
        />{' '}
        <FakeControl
          label="New slice"
          question="Add a slice to the chosen mission?"
          result="Slice added (pretend)"
        />
      </p>

      <h3>From queue tags</h3>
      <p className="quiet" data-testid="ms-real-note">
        Real, but not OpenRig&apos;s own mission model (that store is empty on this fleet): read
        from <code>mission:</code> and <code>slice:</code> tags on queue items. Each item is a job;
        open means a seat still holds it.
      </p>
      {unresolved > 0 && (
        <p className="v2-note v2-note-warn" data-testid="ms-unresolved">
          {unresolved} items carry a slice tag but no mission tag; they are grouped under &quot;(no
          mission tag)&quot;.
        </p>
      )}
      {missions.length === 0 ? (
        <p className="quiet" data-testid="ms-none">
          No queue item carries a mission: or slice: tag on the machines shown.
        </p>
      ) : (
        missions.map((m) => (
          <MissionCard
            key={m.id}
            mission={m}
            ctx={ctx}
            open={current === m.id}
            toggle={() => setOpenId(current === m.id ? '' : m.id)}
          />
        ))
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
