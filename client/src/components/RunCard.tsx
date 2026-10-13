import { useEffect, useMemo, useState } from 'react';
import type { FleetMachine, RigFileOutput, RigFilesOutput } from '@appydave/shared';
import { callVerb } from '../fleet/coreCall.js';
import type { FleetSocket } from '../fleet/useFleet.js';
import {
  RUN_WORD,
  clip,
  missionLine,
  plain,
  reportLine,
  runCard,
  stepText,
} from '../fleet/runcard.js';

interface Props {
  machine: FleetMachine;
  rig: string;
  now: number;
  socket?: FleetSocket;
}

/** Where a line came from, said on screen. */
interface Sourced {
  text: string | null;
  from: string;
}

const MISSION_IDS = ['mission:MISSION.md', 'spec:MISSION.md', 'spec:brief.md', 'mission:brief.md'];
const REPORT_IDS = ['spec:REPORT.md', 'mission:REPORT.md'];

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
export default function RunCard({ machine, rig, now, socket }: Props) {
  const minute = Math.floor(now / 60_000) * 60_000;
  const model = useMemo(() => runCard(machine, rig, minute), [machine, rig, minute]);
  const summary = machine.snapshot.rigs.find((r) => r.name === rig)?.summary ?? null;
  const ended = model?.state.word === 'ended';
  const [files, setFiles] = useState<RigFilesOutput | null | 'loading'>('loading');
  const [mission, setMission] = useState<Sourced | null>(null);
  const [report, setReport] = useState<Sourced | null>(null);
  const machineId = machine.machine.id;

  useEffect(() => {
    setFiles('loading');
    setMission(null);
    setReport(null);
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
      const m = await read(MISSION_IDS, have);
      if (!live) return;
      const line = m ? missionLine(m.content) : null;
      setMission(line && m ? { text: line, from: `from ${fileWhere(m.id)}` } : null);
      const r = await read(REPORT_IDS, have);
      if (!live) return;
      const rl = r ? reportLine(r.content) : null;
      setReport(rl && r ? { text: rl, from: `from ${fileWhere(r.id)}` } : null);
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

  return (
    <section
      className="run-card"
      data-testid="run-card"
      data-state={model.state.word}
      aria-label={`Run card of ${rig}`}
    >
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
                  </span>
                </>
              ) : (
                <span className="run-from">no handoffs through the queue yet</span>
              )}
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
