import { useEffect, useState } from 'react';
import type { RigFileMeta } from '@appydave/shared';
import type { PageProps } from '@client/app/types.js';
import { readRigFile } from '@client/kit/data/rigReads.js';

type GetSocket = PageProps['ctx']['getSocket'];

type Text =
  | { phase: 'loading' }
  | { phase: 'ok'; fileId: string; content: string; truncated: boolean }
  | { phase: 'refused'; fileId: string; why: string };

interface Target {
  machine: string;
  rig: string;
}

const textOf = (fileId: string, a: Awaited<ReturnType<typeof readRigFile>>): Text =>
  a.ok
    ? { phase: 'ok', fileId, content: a.value.file.content, truncated: a.value.file.truncated }
    : { phase: 'refused', fileId, why: `${a.error.failureMode}: ${a.error.message}` };

/** One file's text (`rig.file`). Fetched when the file or its modified time changes; the old text stays meanwhile. */
function useFileText(getSocket: GetSocket, t: Target, file: RigFileMeta | null): Text {
  const [text, setText] = useState<Text>({ phase: 'loading' });
  const fileId = file?.id ?? null;
  const stamp = file?.modifiedAt ?? null;

  useEffect(() => {
    if (!fileId) {
      return;
    }

    let live = true;

    void readRigFile(getSocket(), { ...t, fileId }).then((a) => live && setText(textOf(fileId, a)));

    return () => {
      live = false;
    };
    // `t` is rebuilt every render; its two strings are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getSocket, t.machine, t.rig, fileId, stamp]);

  return text;
}

const SCOPE_WORD: Record<RigFileMeta['scope'], string> = {
  spec: '',
  mission: 'mission folder',
  rig: '',
};

/** Two groups, so the same name in both reads as two files, not a repeat. Order inside each group is kept. */
const GROUPS: { key: string; label: string; has: (f: RigFileMeta) => boolean }[] = [
  { key: 'next', label: 'Next to rig.yaml', has: (f) => f.scope !== 'rig' },
  { key: 'named', label: 'Named in rig.yaml', has: (f) => f.scope === 'rig' },
];

const KB = 1024;
const sizeOf = (n: number) => (n < KB ? `${n} B` : `${(n / KB).toFixed(1)} KB`);

function FileRow({ f, on, onPick }: { f: RigFileMeta; on: boolean; onPick: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        className="rs-file"
        data-testid="rs-file"
        data-file-id={f.id}
        aria-pressed={on}
        onClick={() => onPick(f.id)}
      >
        <span className="rs-file-name">{f.name}</span>
        <span className="quiet rs-file-meta">
          {sizeOf(f.bytes)}
          {SCOPE_WORD[f.scope] ? ` · ${SCOPE_WORD[f.scope]}` : ''}
        </span>
      </button>
    </li>
  );
}

function FileGroups({
  files,
  current,
  onPick,
}: {
  files: RigFileMeta[];
  current: RigFileMeta | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="rs-file-groups" data-testid="rs-file-groups">
      {GROUPS.map((g) => ({ g, inGroup: files.filter(g.has) }))
        .filter((x) => x.inGroup.length > 0)
        .map(({ g, inGroup }) => (
          <div key={g.key} role="group" aria-labelledby={`rs-fg-${g.key}`}>
            <div id={`rs-fg-${g.key}`} className="rs-file-group-label" data-testid="rs-file-group">
              {g.label}
            </div>
            <ul className="rs-file-list" aria-label={g.label}>
              {inGroup.map((f) => (
                <FileRow key={f.id} f={f} on={f.id === current?.id} onPick={onPick} />
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}

/** The file list and, beside it, the chosen file's text. */
export function FilePicker({
  getSocket,
  target,
  files,
}: {
  getSocket: GetSocket;
  target: Target;
  files: RigFileMeta[];
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const file = files.find((f) => f.id === picked) ?? files[0] ?? null;
  const text = useFileText(getSocket, target, file);
  const shown = text.phase !== 'loading' && file && text.fileId === file.id ? text : null;

  return (
    <div className="rs-files" data-testid="rs-files">
      <FileGroups files={files} current={file} onPick={setPicked} />
      <FileText file={file} shown={shown} />
    </div>
  );
}

function OkNote({
  shown,
  file,
}: {
  shown: Extract<Text, { phase: 'ok' }>;
  file: RigFileMeta | null;
}) {
  if (shown.truncated || file?.truncated) {
    return (
      <p className="rs-warn rs-file-note" data-testid="rs-file-truncated">
        This file is longer than the hub keeps (256 KB). Only the start of it is shown.
      </p>
    );
  }

  return shown.content === '' ? <p className="quiet rs-file-note">This file is empty.</p> : null;
}

function FileNote({ shown, file }: { shown: Text | null; file: RigFileMeta | null }) {
  if (shown?.phase === 'refused') {
    return (
      <p className="rs-warn rs-file-note" data-testid="rs-file-refused">
        This file cannot be read: {shown.why}
      </p>
    );
  }

  return shown?.phase === 'ok' ? <OkNote shown={shown} file={file} /> : null;
}

/** The text exactly as sent: monospace, read-only, no rewriting; long lines scroll inside the box. */
function FileText({ file, shown }: { file: RigFileMeta | null; shown: Text | null }) {
  const body = shown?.phase === 'ok' ? shown.content : shown ? '' : 'Opening…';

  return (
    <div className="rs-file-view">
      <div className="rs-file-bar quiet mono" data-testid="rs-file-bar">
        {file ? `${file.name} · ${sizeOf(file.bytes)}` : ''}
      </div>
      <FileNote shown={shown} file={file} />
      <pre className="rs-file-text" tabIndex={0} data-testid="rs-file-text">
        {body}
      </pre>
    </div>
  );
}
