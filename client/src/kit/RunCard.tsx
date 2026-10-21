import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { FleetMachine, RigFileOutput, RigFilesOutput } from '@appydave/shared';
import { callVerb } from '../domain/fleet/coreCall.js';
import type { FleetSocket } from '../domain/fleet/useFleet.js';
import WaitingOnDavid from './WaitingOnDavid.js';
import PlanStrip from './PlanStrip.js';
import RunOutputs from './RunOutputs.js';
import { changeOrders, planIn, type PlanSource } from '../domain/fleet/plan.js';
import { rigQueue } from '../domain/fleet/views.js';
import {
  RUN_WORD,
  clip,
  missionLine,
  plain,
  reportLine,
  runCard,
  stepText,
} from '../domain/fleet/runcard.js';

interface Props {
  machine: FleetMachine;
  rig: string;
  now: number;
  socket?: FleetSocket;
  /** D09 W0: shown first inside Details (the chosen rig's info box). */
  details?: ReactNode;
}

/** D09 W0: Details open or closed, remembered per viewer; closed until the viewer opens it. */
const OPEN_KEY = 'appyrig.runCardOpen';
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Where a line came from, said on screen. */
interface Sourced {
  text: string | null;
  from: string;
}

const MISSION_IDS = ['mission:MISSION.md', 'spec:MISSION.md', 'spec:brief.md', 'mission:brief.md'];
const REPORT_IDS = ['spec:REPORT.md', 'mission:REPORT.md'];
/** R3: a variant run's own mission or report (`spec:MISSION-d10.md`), never a change order. */
const variantDoc = (have: Set<string>, kind: 'MISSION' | 'REPORT') =>
  [...have].filter((id) => new RegExp(`^spec:${kind}-(?!.*-change-)[^:]+\\.md$`).test(id)).sort();
/** R3: files that may hold the plan: missions and batch briefs (change orders are read by name). */
const PLAN_FILE =
  /^(?:spec|mission):(?:MISSION(?:-(?!.*-change-)[^:]+)?|[A-Za-z0-9._-]+-brief|brief)\.md$/;
const MAX_PLAN_FILES = 8;

const clock = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const fileWhere = (id: string) =>
  `${id.split(':')[1]} (${id.startsWith('mission:') ? 'mission folder' : 'next to rig.yaml'})`;

/** Why there is no file to read, from rig.files' status, in words. */
function missingWhy(files: RigFilesOutput | null, machineLabel: string, what: string): string {
  if (!files) return `couldn't ask the hub for this rig's files`;
  switch (files.status) {
    case 'no-spec':
      return `no ${what} file found: no rig.yaml for this rig, so there is no folder to look in`;
    case 'no-data':
      return `no ${what} file found: ${machineLabel}'s collector does not send rig files`;
    case 'pending':
      return `${what} file not received yet: ${machineLabel} sends rig files when it reports`;
    default:
      return `no ${what} file found next to its rig.yaml`;
  }
}

/**
 * Run card R1, at the top of the Rig Map, Handoff Flow and Run Timeline: the run's mission in one
 * line, its state in words (with the evidence), the live step (the newest handoff) and, for an
 * ended rig, what it ended with. Each line names its source; a missing one is said in words.
 */
export default function RunCard({ machine, rig, now, socket, details }: Props) {
  const [open, setOpen] = useState<boolean>(readOpen);
  const [gates, setGates] = useState<number | null | 'loading'>('loading');
  const bodyId = useId();
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? 'on' : 'off');
    } catch {
      // per-viewer convenience only
    }
  };
  const minute = Math.floor(now / 60_000) * 60_000;
  const model = useMemo(() => runCard(machine, rig, minute), [machine, rig, minute]);
  const items = useMemo(() => rigQueue(machine, rig), [machine, rig]);
  const summary = machine.snapshot.rigs.find((r) => r.name === rig)?.summary ?? null;
  const ended = model?.state.word === 'ended';
  const [files, setFiles] = useState<RigFilesOutput | null | 'loading'>('loading');
  const [mission, setMission] = useState<Sourced | null>(null);
  const [report, setReport] = useState<Sourced | null>(null);
  /** R3: plan candidates read from the rig's files (null while reading). */
  const [sources, setSources] = useState<PlanSource[] | null>(null);
  const machineId = machine.machine.id;

  useEffect(() => {
    setFiles('loading');
    setMission(null);
    setReport(null);
    setSources(null);
    if (!socket) {
      setFiles(null);
      return;
    }
    let live = true;
    const read = async (ids: string[], have: Set<string>) => {
      const id = ids.find((x) => have.has(x));
      if (!id) return null;
      const a = await callVerb<RigFileOutput>(socket, 'rig.file', {
        machine: machineId,
        rig,
        fileId: id,
      });
      return a.ok ? { id, content: a.value.file.content } : null;
    };
    void (async () => {
      const a = await callVerb<RigFilesOutput>(socket, 'rig.files', { machine: machineId, rig });
      if (!live) return;
      const list = a.ok ? a.value : null;
      setFiles(list);
      const have = new Set(list?.status === 'ok' ? list.files.map((f) => f.id) : []);
      const m = await read(
        [...MISSION_IDS.slice(0, 2), ...variantDoc(have, 'MISSION'), ...MISSION_IDS.slice(2)],
        have
      );
      if (!live) return;
      const line = m ? missionLine(m.content) : null;
      setMission(line && m ? { text: line, from: `from ${fileWhere(m.id)}` } : null);
      const r = await read([...REPORT_IDS, ...variantDoc(have, 'REPORT')], have);
      if (!live) return;
      const rl = r ? reportLine(r.content) : null;
      setReport(rl && r ? { text: rl, from: `from ${fileWhere(r.id)}` } : null);
      // R3: every mission and brief may hold the plan; change orders count by their names.
      const found: PlanSource[] = [];
      for (const id of [...have]
        .filter((x) => PLAN_FILE.test(x))
        .sort()
        .slice(0, MAX_PLAN_FILES)) {
        const f = id === m?.id ? m : await read([id], have);
        if (!live) return;
        const p = f ? planIn(f.content, fileWhere(id)) : null;
        if (p) found.push(p);
      }
      const orders = changeOrders(
        [...have].filter((x) => x.startsWith('spec:')).map((x) => x.slice(5)),
        line
      );
      setSources(orders ? [...found, orders] : found);
    })();
    return () => {
      live = false;
    };
  }, [socket, machineId, rig]);

  if (!model) return null;
  const list = files === 'loading' ? null : files;
  const missionShown: Sourced =
    mission ??
    (files === 'loading'
      ? { text: null, from: 'reading the rig’s files…' }
      : summary
        ? {
            // QA R1 LOW-2: a rig.yaml summary can run to ~480 characters; one line, like the rest.
            text: clip(plain(summary)),
            from: `from rig.yaml summary (${missingWhy(list, machine.machine.label, 'mission')})`,
          }
        : { text: null, from: missingWhy(list, machine.machine.label, 'mission') });
  const last = model.live;
  const endedWith: Sourced | null = !ended
    ? null
    : (report ??
      (last
        ? {
            text: stepText(last.item),
            from: `from the last handoff, ${clock(last.item.createdAt)} (${files === 'loading' ? 'reading REPORT.md…' : missingWhy(list, machine.machine.label, 'REPORT.md').replace('REPORT.md file', 'REPORT.md')})`,
          }
        : { text: null, from: 'no REPORT.md and no handoffs to go by' }));
  const w = RUN_WORD[model.state.word];
  // D09 W0: the folded card is one sentence: rig · state · the newest handoff in words · how many
  // open items wait on David (a count only; Details lists them).
  // QA MEDIUM-1: open items to David plus the FliStudio gates Details lists, so the two agree.
  const waiting = model.toDavid.length + (typeof gates === 'number' ? gates : 0);
  const waitingWords = `${waiting === 0 ? 'nothing' : waiting} waiting on you${
    gates === 'loading' ? ' (checking gates…)' : gates === null ? ' (gates not checked)' : ''
  }`;
  const lastWords = last
    ? `${ended ? 'ended with' : 'last'}: ${clip(last.text, 110)}`
    : 'no handoffs yet';

  return (
    <section
      className="run-card"
      data-testid="run-card"
      data-state={model.state.word}
      data-open={open}
      aria-label={`Run card of ${rig}`}
    >
      <p className="run-line" data-testid="run-line">
        {/* QA MEDIUM-2: only the step's words shrink (ellipsis, full text in the title); the
            rig, state, time and count always show whole. */}
        <span className="run-line-text">
          <b className="run-line-fixed">{rig} ·</b>
          <b className="run-word run-line-fixed" data-word={model.state.word}>
            {w.glyph} {w.label}
          </b>
          <span
            className="run-line-last"
            data-testid="run-line-last"
            title={last ? `${ended ? 'ended with' : 'last'}: ${last.text}` : lastWords}
          >
            · {lastWords}
          </span>
          {last && <span className="run-line-fixed">· {clock(last.item.createdAt)}</span>}
          <span className="run-line-fixed" data-testid="run-line-waiting">
            · {waitingWords}
          </span>
        </span>
        <button
          type="button"
          className="pill-btn run-details-toggle"
          data-testid="run-details-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggle}
        >
          Details {open ? '▾' : '▸'}
        </button>
      </p>
      <div id={bodyId} className="run-card-body" hidden={!open}>
        {details}
        <dl>
          <dt>Mission</dt>
          <dd data-testid="run-mission" data-found={!!missionShown.text}>
            {missionShown.text && <span>{missionShown.text} </span>}
            <span className="run-from">{missionShown.from}</span>
          </dd>
          <dt>State</dt>
          <dd data-testid="run-state" data-word={model.state.word}>
            <b className="run-word" data-word={model.state.word}>
              {w.glyph} {w.label}
            </b>{' '}
            <span className="run-from">{model.state.why}</span>
          </dd>
          {endedWith ? (
            <>
              <dt>Ended with</dt>
              <dd data-testid="run-ended" data-from={report ? 'report' : 'handoff'}>
                {endedWith.text && <span>{endedWith.text} </span>}
                <span className="run-from">{endedWith.from}</span>
              </dd>
            </>
          ) : (
            <>
              <dt>Live step</dt>
              <dd data-testid="run-live">
                {last ? (
                  <>
                    <span>{last.text}</span>{' '}
                    <span className="run-from">
                      {clock(last.item.createdAt)} · {last.item.state} · the newest handoff
                      {model.sweeps > 0
                        ? ` (OpenRig's ${model.sweeps} stuck-sweep notices left out)`
                        : ''}
                    </span>
                  </>
                ) : (
                  <span className="run-from">no handoffs through the queue yet</span>
                )}
              </dd>
            </>
          )}
          <dt>Plan</dt>
          <dd data-testid="run-plan-row">
            <PlanStrip
              sources={sources}
              items={items}
              why={files === 'loading' ? null : missingWhy(list, machine.machine.label, 'plan')}
            />
          </dd>
          <dt>Waiting on David</dt>
          <dd data-testid="run-waiting-row">
            <WaitingOnDavid
              machine={machine}
              rig={rig}
              toDavid={model.toDavid}
              socket={socket}
              onGates={setGates}
            />
          </dd>
          <dt>Outputs</dt>
          <dd data-testid="run-outputs-row">
            <RunOutputs machineId={machineId} rig={rig} files={files} socket={socket} />
          </dd>
        </dl>
      </div>
    </section>
  );
}
