import { useEffect, useMemo, useState } from 'react';
import type { RigFileMeta, RigFilesOutput } from '@appydave/shared';
import type { PageProps } from '@client/app/types.js';
import { readRigFiles } from '@client/kit/data/rigReads.js';
import { FilePicker } from './FileView.js';

type GetSocket = PageProps['ctx']['getSocket'];

/** The file list is asked again this often; the view only changes when the answer does. */
const FILES_POLL_MS = 15_000;

type List =
  | { phase: 'loading' }
  | { phase: 'ok'; out: RigFilesOutput }
  | { phase: 'refused'; message: string };

/**
 * The rig's file list (`rig.files`), asked again slowly. An unchanged answer keeps the same object, so a
 * poll does not re-render or reload the text beside it.
 */
function useFileList(getSocket: GetSocket, machine: string, rig: string): List {
  const [list, setList] = useState<List>({ phase: 'loading' });

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const ask = () => {
      void readRigFiles(getSocket(), { machine, rig }).then((a) => {
        if (!live) {
          return;
        }

        setList((cur) => {
          if (!a.ok) {
            return cur.phase === 'ok' ? cur : { phase: 'refused', message: a.error.message };
          }

          return cur.phase === 'ok' && JSON.stringify(cur.out) === JSON.stringify(a.value)
            ? cur
            : { phase: 'ok', out: a.value };
        });
        timer = window.setTimeout(ask, FILES_POLL_MS);
      });
    };

    setList({ phase: 'loading' });
    ask();

    return () => {
      live = false;

      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [getSocket, machine, rig]);

  return list;
}

/** rig.yaml first (the spec's own file, by the name its path ends in), then the rest in the order sent. */
function orderedFiles(out: RigFilesOutput, specPath: string | null): RigFileMeta[] {
  const all = [...out.files, ...(out.specFiles ?? [])];
  const base = specPath?.split('/').pop() ?? 'rig.yaml';
  const isRig = (f: RigFileMeta) => f.scope === 'spec' && f.name === base;

  return [...all.filter(isRig), ...all.filter((f) => !isRig(f))];
}

/** What to tell the reader when the hub has no files for this rig. */
function noFilesWhy(out: RigFilesOutput, machineLabel: string): string {
  if (out.status === 'no-spec') {
    return `${machineLabel} found no rig.yaml for this rig, so there are no files to show.`;
  }

  if (out.status === 'no-data') {
    return `${machineLabel}'s collector is older than the file viewer and does not send rig files.`;
  }

  if (out.status === 'pending') {
    return `${machineLabel} found the rig.yaml but has not sent its files yet; they appear when it reports next.`;
  }

  return 'The hub has no files for this rig.';
}

/**
 * The rig's folder as a file list with the real text beside it: monospace, read-only, exactly as sent.
 * `onNone` tells the page when there is nothing to show, so it can open the Summary instead.
 */
export function SpecFiles({
  getSocket,
  machine,
  machineLabel,
  rig,
  specPath,
  onNone,
}: {
  getSocket: GetSocket;
  /** The machine whose OpenRig knows the rig; null for a draft, which no machine serves files for. */
  machine: string | null;
  machineLabel: string;
  rig: string;
  specPath: string | null;
  onNone: (none: boolean) => void;
}) {
  if (!machine) {
    return (
      <NoFiles
        onNone={onNone}
        why="This rig is not launched, and the hub only serves files for rigs a machine has launched. Its files cannot be read here; the Summary below is built from the spec scan."
      />
    );
  }

  return (
    <LaunchedFiles
      getSocket={getSocket}
      machine={machine}
      machineLabel={machineLabel}
      rig={rig}
      specPath={specPath}
      onNone={onNone}
    />
  );
}

function NoFiles({ why, onNone }: { why: string; onNone: (none: boolean) => void }) {
  useEffect(() => {
    onNone(true);
  }, [onNone]);

  return (
    <p className="quiet rs-files-none" data-testid="rs-files-none">
      {why}
    </p>
  );
}

function FilesNone({ list, machineLabel }: { list: List; machineLabel: string }) {
  return (
    <p className="quiet rs-files-none" data-testid="rs-files-none">
      {list.phase === 'ok'
        ? noFilesWhy(list.out, machineLabel)
        : list.phase === 'refused'
          ? `The hub would not list this rig's files (${list.message}).`
          : ''}
    </p>
  );
}

function LaunchedFiles({
  getSocket,
  machine,
  machineLabel,
  rig,
  specPath,
  onNone,
}: {
  getSocket: GetSocket;
  machine: string;
  machineLabel: string;
  rig: string;
  specPath: string | null;
  onNone: (none: boolean) => void;
}) {
  const list = useFileList(getSocket, machine, rig);
  const files = useMemo(
    () => (list.phase === 'ok' ? orderedFiles(list.out, specPath) : []),
    [list, specPath]
  );
  const none = list.phase === 'refused' || (list.phase === 'ok' && files.length === 0);

  useEffect(() => {
    onNone(none);
  }, [onNone, none]);

  if (list.phase === 'loading') {
    return (
      <p className="quiet" data-testid="rs-files-loading">
        Reading the file list…
      </p>
    );
  }

  if (none) {
    return <FilesNone list={list} machineLabel={machineLabel} />;
  }

  return <FilePicker getSocket={getSocket} target={{ machine, rig }} files={files} />;
}
