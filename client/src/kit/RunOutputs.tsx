import { useEffect, useState } from 'react';
import type { RigFilesOutput, RigOutputsOutput } from '@appydave/shared';
import { callVerb } from '../domain/fleet/coreCall.js';
import type { FleetSocket } from '../domain/fleet/useFleet.js';

interface Props {
  machineId: string;
  rig: string;
  /** The rig's file list (rig.files); null when it could not be read, 'loading' while it is. */
  files: RigFilesOutput | null | 'loading';
  socket?: FleetSocket;
}

const SHOWN = 6;
const OUTPUT_FILE = /^(REPORT|DEBRIEF|LEARNED)[A-Za-z0-9._-]*\.md$/;
const clock = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const who = (raw: string | null) => (raw ?? '?').split('@')[0];
const where = (scope: string) => (scope === 'mission' ? 'mission folder' : 'next to rig.yaml');

/**
 * Run card R4: what the run produced. Its report, debrief and learned files (from rig.files),
 * the commits its handoffs name, and the FliStudio resources and gates they name (rig.outputs).
 * Every item says where it came from; subfolders such as checks/ are not read, and it says so.
 */
export default function RunOutputs({ machineId, rig, files, socket }: Props) {
  const [out, setOut] = useState<RigOutputsOutput | null | 'loading'>('loading');

  useEffect(() => {
    setOut('loading');
    if (!socket) {
      setOut(null);

      return;
    }

    let live = true;

    void callVerb<RigOutputsOutput>(socket, 'rig.outputs', { machine: machineId, rig }).then(
      (a) => live && setOut(a.ok ? a.value : null)
    );

    return () => {
      live = false;
    };
  }, [socket, machineId, rig]);

  const list = files === 'loading' || !files ? null : files;
  const outFiles = list?.status === 'ok' ? list.files.filter((f) => OUTPUT_FILE.test(f.name)) : [];
  const got = out === 'loading' ? null : out;
  const commits = got?.commits ?? [];
  const fli = got?.flistudio ?? [];
  const resources = fli.filter((f) => f.kind === 'resource');
  const gates = fli.filter((f) => f.kind === 'gate');

  return (
    <div className="run-outputs" data-testid="run-outputs">
      <p data-testid="run-out-files">
        <b>Files</b>{' '}
        {files === 'loading' ? (
          <span className="run-from">reading…</span>
        ) : outFiles.length ? (
          outFiles.map((f, i) => (
            <span key={f.id} data-testid="run-out-file">
              {i > 0 && ', '}
              <code>{f.name}</code> <span className="run-from">({where(f.scope)})</span>
            </span>
          ))
        ) : (
          <span className="run-from">
            {/* r1 R4 LOW-2: an empty list is only "none" when the hub actually listed the files. */}
            {list?.status === 'ok'
              ? 'no REPORT, DEBRIEF or LEARNED file in its folders'
              : !list
                ? 'not checked: the hub did not answer'
                : list.status === 'no-spec'
                  ? 'not checked: no rig.yaml for this rig, so there is no folder to look in'
                  : list.status === 'no-data'
                    ? "not checked: this machine's collector does not send rig files"
                    : 'not received yet: the machine sends rig files when it reports'}
          </span>
        )}
        <span className="run-from">
          {' '}
          · Files · O opens them. Subfolders (checks/ and the like) are not read.
        </span>
      </p>
      <p data-testid="run-out-commits">
        {/* r1 R4 LOW-1: a handoff can quote another run's commit; say "named", not "made". */}
        <b>Commits named in its handoffs</b>{' '}
        {out === 'loading' ? (
          <span className="run-from">reading its handoffs…</span>
        ) : !got ? (
          <span className="run-from">the hub did not answer</span>
        ) : commits.length ? (
          <>
            {commits.slice(0, SHOWN).map((c, i) => (
              <span key={c.sha} data-testid="run-out-commit" title={`“${c.context}”`}>
                {i > 0 && ', '}
                <code>{c.sha}</code>{' '}
                <span className="run-from">
                  ({who(c.from)} → {who(c.to)}, {clock(c.at)}
                  {c.mentions > 1 ? `, named in ${c.mentions} handoffs` : ''})
                </span>
              </span>
            ))}
            {commits.length > SHOWN && (
              <span className="run-from"> and {commits.length - SHOWN} more</span>
            )}
          </>
        ) : (
          <span className="run-from">no commit id in its handoffs</span>
        )}
      </p>
      <p data-testid="run-out-flistudio">
        <b>FliStudio ids named</b>{' '}
        {!got ? (
          <span className="run-from">{out === 'loading' ? 'reading…' : '—'}</span>
        ) : fli.length ? (
          <>
            {resources.length > 0 && (
              <span data-testid="run-out-resources">
                {resources.length} resource{resources.length === 1 ? '' : 's'}{' '}
                <span className="run-from">
                  (
                  {resources
                    .slice(0, SHOWN)
                    .map((r) => r.id)
                    .join(', ')}
                  {resources.length > SHOWN ? ', …' : ''})
                </span>
              </span>
            )}
            {gates.length > 0 && (
              <span data-testid="run-out-gates">
                {resources.length > 0 && ' · '}
                {gates.length} gate{gates.length === 1 ? '' : 's'}{' '}
                {gates.slice(0, SHOWN).map((g) =>
                  g.link ? (
                    <a key={g.id} href={g.link} target="_blank" rel="noreferrer">
                      {g.id} ↗{' '}
                    </a>
                  ) : (
                    <code key={g.id}>{g.id} </code>
                  )
                )}
              </span>
            )}
            <span className="run-from"> · named in its handoffs</span>
          </>
        ) : (
          <span className="run-from">no FliStudio id in its handoffs</span>
        )}
      </p>
      {got && got.bodiesMissing > 0 && (
        <p className="run-from" data-testid="run-out-missing">
          {got.bodiesMissing} of its {got.scanned} handoffs have no message on the hub yet; those
          were read by their one-line summary only.
        </p>
      )}
    </div>
  );
}
