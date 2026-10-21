import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Refusal, RigFileMeta, RigFileOutput, RigFilesOutput } from '@appydave/shared';
import { callVerb } from '../domain/fleet/coreCall.js';
import type { FleetSocket } from '../domain/fleet/useFleet.js';
import { isTextEntry } from '../lib/keys.js';
import MarkdownView from './MarkdownView.js';
import YamlView from './YamlView.js';

/**
 * v1.5 · L1: a file handed to the viewer instead of fetched (the Debug view's prompt layers), so
 * they open in this same viewer. `sub` replaces the "team folder" line under its name.
 */
export interface PresetFile {
  id: string;
  name: string;
  sub: string;
  about?: string;
  bytes: number;
  modifiedAt: string;
  truncated: boolean;
  content: string;
}

interface Props {
  socket: FleetSocket;
  machineId: string;
  machineLabel: string;
  /** The rig's name (what the API calls it). */
  rig: string;
  /** What to call it on screen. */
  title: string;
  onClose: () => void;
  /** v1.5 · L1: show these files (no rig.files / rig.file calls), opened at `initialId`. */
  preset?: { files: PresetFile[]; initialId?: string; what: string };
}

type ListState =
  | { state: 'loading' }
  | { state: 'ok'; out: RigFilesOutput }
  | { state: 'refused'; error: Refusal };

type FileState =
  | { state: 'idle' }
  | { state: 'loading'; id: string }
  | { state: 'ok'; file: RigFileOutput['file'] }
  | { state: 'refused'; id: string; error: Refusal };

const kb = (n: number) =>
  n >= 10_240 ? `${Math.round(n / 1024)} KB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;

const ABOUT: Record<string, string> = {
  'rig.yaml': 'The rig spec: who is on the team and how it starts.',
  'MISSION.md': 'What this team was set up to do.',
  'CULTURE.md': 'How this team works together.',
  'brief.md': 'The brief this team works from.',
  'REPORT.md': 'A report the team wrote.',
  'DEBRIEF.md': 'What the team learned when it finished.',
};
const aboutFile = (f: RigFileMeta): string =>
  ABOUT[f.name] ?? (f.name.startsWith('LEARNED') ? 'What a seat learned while working.' : '');

const subOf = (f: RigFileMeta, preset: Props['preset']): string =>
  preset?.files.find((p) => p.id === f.id)?.sub ??
  (f.scope === 'spec' ? 'team folder' : 'mission folder');
const aboutOf = (f: RigFileMeta, preset: Props['preset']): string =>
  preset ? (preset.files.find((p) => p.id === f.id)?.about ?? '') : aboutFile(f);

/** The given files as the list rig.files would have answered. */
function presetList(machine: string, rig: string, files: PresetFile[]): RigFilesOutput {
  return {
    machine,
    rig,
    status: 'ok',
    reason: null,
    files: files.map((f) => ({
      id: f.id,
      name: f.name,
      scope: 'spec',
      bytes: f.bytes,
      modifiedAt: f.modifiedAt,
      truncated: f.truncated,
    })) as RigFilesOutput['files'],
  };
}

const WHY: Record<RigFilesOutput['status'], string> = {
  ok: '',
  'no-spec':
    'No rig.yaml was found for this rig in the configured spec folders, so there are no files to show.',
  'no-data':
    "This machine's collector does not report rig specs yet (it predates v1.4), so AppyRig cannot list files.",
  pending:
    'A rig.yaml was found, but its files have not reached the hub yet. This can take a few seconds after a restart.',
};

/**
 * S7-ui: a rig's own files (rig.yaml, mission and culture notes), read-only and nicely formatted.
 * The viewer asks the hub by {machine, rig, file id} only; the collector decides which files exist.
 * Esc closes; ↑ ↓ move between files.
 */
export default function RigFiles({
  socket,
  machineId,
  machineLabel,
  rig,
  title,
  onClose,
  preset,
}: Props) {
  const [list, setList] = useState<ListState>(() =>
    preset ? { state: 'ok', out: presetList(machineId, rig, preset.files) } : { state: 'loading' }
  );
  const [selected, setSelected] = useState<string | null>(
    () => preset?.initialId ?? preset?.files[0]?.id ?? null
  );
  const [file, setFile] = useState<FileState>({ state: 'idle' });
  const [source, setSource] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const loadList = useCallback(() => {
    if (preset) {
      return;
    }

    setList({ state: 'loading' });
    void callVerb<RigFilesOutput>(socket, 'rig.files', { machine: machineId, rig }).then((a) => {
      if (!a.ok) {
        return setList({ state: 'refused', error: a.error });
      }

      setList({ state: 'ok', out: a.value });
      setSelected(
        (cur) =>
          cur ??
          a.value.files.find((f) => f.name === 'rig.yaml')?.id ??
          a.value.files[0]?.id ??
          null
      );
    });
    // `preset` is fixed for the viewer's life: App mounts a new viewer to show other files.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, machineId, rig]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selected) {
      return setFile({ state: 'idle' });
    }

    const given = preset?.files.find((f) => f.id === selected);

    if (preset) {
      if (given) {
        setFile({ state: 'ok', file: { ...given, scope: 'spec' } as RigFileOutput['file'] });
      }

      return;
    }

    let current = true;

    setFile({ state: 'loading', id: selected });
    void callVerb<RigFileOutput>(socket, 'rig.file', {
      machine: machineId,
      rig,
      fileId: selected,
    }).then((a) => {
      if (!current) {
        return;
      }

      setFile(
        a.ok
          ? { state: 'ok', file: a.value.file }
          : { state: 'refused', id: selected, error: a.error }
      );
    });

    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, machineId, rig, selected]);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const files = useMemo(() => (list.state === 'ok' ? list.out.files : []), [list]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();

        return;
      }

      if (
        (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
        !isTextEntry(e.target) &&
        files.length > 0
      ) {
        const i = files.findIndex((f) => f.id === selected);
        const next =
          files[Math.max(0, Math.min(files.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];

        if (next && next.id !== selected) {
          e.preventDefault();
          setSelected(next.id);
          setSource(false);
        }
      }
    };

    // capture: the screen's own Esc must not also run
    window.addEventListener('keydown', onKey, true);

    return () => window.removeEventListener('keydown', onKey, true);
  }, [files, selected, onClose]);

  // What is shown is the file that has LOADED, never the one just selected: between a click and the
  // answer the old text must not be dressed in the new file's format.
  const loaded = file.state === 'ok' && file.file.id === selected ? file.file : null;
  const isMd = loaded?.name.toLowerCase().endsWith('.md') ?? false;

  return (
    <div className="files-scrim" data-testid="rig-files-scrim" onClick={onClose}>
      <section
        className="files"
        role="dialog"
        aria-modal="true"
        aria-label={`Files of ${title}`}
        data-testid="rig-files"
        data-rig={rig}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="files-head">
          <span>
            <b>{title}</b>
            <span className="label">
              {' '}
              · {preset?.what ?? 'files'} · {machineLabel}
            </span>
          </span>
          <button
            ref={closeRef}
            type="button"
            className="pill-btn"
            data-testid="rig-files-close"
            onClick={onClose}
          >
            Close · Esc
          </button>
        </header>

        {list.state === 'loading' && (
          <p className="empty" data-testid="rig-files-loading">
            Loading files…
          </p>
        )}
        {list.state === 'refused' && (
          <p
            className="empty"
            data-testid="rig-files-error"
            data-failure-mode={list.error.failureMode}
          >
            Could not list files: {list.error.failureMode}. {list.error.message}
            <button type="button" className="pill-btn" onClick={loadList}>
              Try again
            </button>
          </p>
        )}
        {list.state === 'ok' && list.out.status !== 'ok' && (
          <p className="empty" data-testid="rig-files-status" data-status={list.out.status}>
            {list.out.reason ?? WHY[list.out.status]}
            {list.out.status === 'pending' && (
              <button
                type="button"
                className="pill-btn"
                data-testid="rig-files-refresh"
                onClick={loadList}
              >
                Check again
              </button>
            )}
          </p>
        )}

        {list.state === 'ok' && list.out.status === 'ok' && (
          <div className="files-body">
            <ul className="files-list" aria-label="Files">
              {files.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="files-item"
                    data-testid="rig-file-item"
                    data-file-id={f.id}
                    aria-current={f.id === selected ? 'true' : undefined}
                    onClick={() => {
                      setSelected(f.id);
                      setSource(false);
                    }}
                  >
                    <b>{f.name}</b>
                    <span className="files-sub">
                      {subOf(f, preset)} · {kb(f.bytes)}
                      {f.truncated ? ' · cut' : ''}
                    </span>
                    {aboutOf(f, preset) && (
                      <span className="files-about">{aboutOf(f, preset)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <div className="files-view" data-testid="rig-file-view">
              {(file.state === 'loading' || (file.state === 'ok' && !loaded)) && (
                <p className="empty" data-testid="rig-file-loading">
                  Loading {selected}…
                </p>
              )}
              {file.state === 'refused' && (
                <p
                  className="empty"
                  data-testid="rig-file-error"
                  data-failure-mode={file.error.failureMode}
                >
                  Could not open {file.id}: {file.error.failureMode}. {file.error.message}
                </p>
              )}
              {loaded && (
                <>
                  <div className="files-meta">
                    <b data-testid="rig-file-name">{loaded.name}</b>
                    <span className="label">
                      {kb(loaded.bytes)} · changed {new Date(loaded.modifiedAt).toLocaleString()}
                    </span>
                    {isMd && (
                      <button
                        type="button"
                        className="pill-btn"
                        data-testid="rig-file-source"
                        aria-pressed={source}
                        onClick={() => setSource((s) => !s)}
                      >
                        {source ? 'Show formatted' : 'Show source'}
                      </button>
                    )}
                  </div>
                  {loaded.truncated && (
                    <p className="files-cut" role="note" data-testid="rig-file-truncated">
                      Showing the first {kb(loaded.content.length)} of this {kb(loaded.bytes)} file.
                      The rest is not stored here.
                    </p>
                  )}
                  {isMd && !source ? (
                    <MarkdownView source={loaded.content} />
                  ) : isMd || /\.ya?ml$/i.test(loaded.name) ? (
                    isMd ? (
                      <pre className="md-code" tabIndex={0}>
                        <code>{loaded.content}</code>
                      </pre>
                    ) : (
                      <YamlView source={loaded.content} />
                    )
                  ) : (
                    <pre className="md-code" tabIndex={0}>
                      <code>{loaded.content}</code>
                    </pre>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
