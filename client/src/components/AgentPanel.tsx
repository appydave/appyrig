import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  LoadoutLayer,
  QueueItem,
  Refusal,
  RigFileOutput,
  RigFilesOutput,
  SeatLoadoutOutput,
} from '@appydave/shared';
import { callVerb } from '../fleet/coreCall.js';
import type { FleetSocket } from '../fleet/useFleet.js';
import {
  PIP,
  ago,
  blockedBecause,
  modelChip,
  pipFor,
  seatName,
  visibleTail,
  type TileRef,
} from '../fleet/model.js';
import FocusTerminal from './FocusTerminal.js';
import MarkdownView from './MarkdownView.js';
import YamlView from './YamlView.js';

/** What each prompt layer is, in plain words (the same wording as the Debug view). */
const LAYER_ABOUT: Record<LoadoutLayer['id'], string> = {
  role: 'Its role: the instructions OpenRig types into the agent, from its agent spec.',
  'claude-md': "The agent's own CLAUDE.md, in its working folder.",
  'claude-local':
    'CLAUDE.local.md in its working folder. OpenRig merges the startup files into it.',
  culture: "The team's culture file.",
  recap: 'A recap, if one was written.',
  learned: 'What this agent learned, if written.',
};

/** Instructions first: role, then the folder's CLAUDE files, then team culture, then notes. */
const LAYER_ORDER: LoadoutLayer['id'][] = [
  'role',
  'claude-md',
  'claude-local',
  'culture',
  'recap',
  'learned',
];

const RIG_FILE_ABOUT: Record<string, string> = {
  'rig.yaml': 'The rig spec: who is on the team and how it starts.',
  'MISSION.md': 'What this team was set up to do.',
  'CULTURE.md': 'How this team works together.',
  'brief.md': 'The brief this team works from.',
};

const kb = (n: number) =>
  n >= 10_240 ? `${Math.round(n / 1024)} KB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;

export type AgentTab = 'documents' | 'terminal' | 'messages';
const TABS: { id: AgentTab; label: string }[] = [
  { id: 'documents', label: 'Documents' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'messages', label: 'Messages' },
];

type LoadoutState =
  | { state: 'loading' }
  | { state: 'ok'; out: SeatLoadoutOutput }
  | { state: 'refused'; error: Refusal };
type FilesState =
  | { state: 'loading' }
  | { state: 'ok'; out: RigFilesOutput }
  | { state: 'refused'; error: Refusal };
type OpenFile =
  | { state: 'loading'; id: string }
  | { state: 'ok'; id: string; name: string; bytes: number; truncated: boolean; content: string }
  | { state: 'refused'; id: string; error: Refusal };

/** One document, however it was fetched: the same shape for a prompt layer and a rig file. */
interface Doc {
  /** `layer:<id>` or `file:<id>` */
  id: string;
  name: string;
  about: string;
  where: string;
  bytes: number;
  truncated: boolean;
}

interface Props {
  tile: TileRef;
  socket: FleetSocket;
  now: number;
  hubConnected: boolean;
  onClose: () => void;
  /** Open this seat's full-screen Focus (the big terminal). */
  onOpenFocus?: (key: string) => void;
  /** Debug: skills by source and prompt layers. */
  onOpenDebug?: (machineId: string, seatId: string) => void;
  /** The rig's own files viewer. */
  onOpenRigFiles?: (machineId: string, rig: string) => void;
  /** False while something sits on top (the files viewer, Debug, feedback): Esc is theirs. */
  keys?: boolean;
  initialTab?: AgentTab;
}

function DocBody({ name, content }: { name: string; content: string }) {
  const [source, setSource] = useState(false);
  const isMd = /\.md$/i.test(name) || !/\.[a-z]+$/i.test(name);
  const isYaml = /\.ya?ml$/i.test(name);
  return (
    <div className="agent-doc-body" data-testid="agent-doc-body" data-doc-name={name}>
      {isMd && (
        <button
          type="button"
          className="pill-btn"
          data-testid="agent-doc-source"
          aria-pressed={source}
          onClick={() => setSource((v) => !v)}
        >
          {source ? 'Show formatted' : 'Show source'}
        </button>
      )}
      {isMd && !source ? (
        <MarkdownView source={content} />
      ) : isYaml ? (
        <YamlView source={content} />
      ) : (
        <pre className="md-code" tabIndex={0}>
          <code>{content}</code>
        </pre>
      )}
    </div>
  );
}

/**
 * D15 · UI-B: the ONE agent panel. "The documents belong to the agent, not to either screen": the
 * Rig Map and the Handoff Flow open this same side panel for a seat. Its first view is the agent's
 * documents, all listed at once (instructions, startup files, the rig's files), each opening inline.
 * The terminal and the agent's messages (queue items) are the other two tabs.
 *
 * No new data source: the prompt layers come from `seat.loadout` (what Debug reads) and the rig's
 * files from `rig.files` / `rig.file` (what the Rig files viewer reads).
 */
export default function AgentPanel({
  tile,
  socket,
  now,
  hubConnected,
  onClose,
  onOpenFocus,
  onOpenDebug,
  onOpenRigFiles,
  keys = true,
  initialTab = 'documents',
}: Props) {
  const { seat, machine } = tile;
  const machineId = machine.machine.id;
  const seatId = seat.id;
  const rig = seat.rig;
  const [tab, setTab] = useState<AgentTab>(initialTab);
  const [loadout, setLoadout] = useState<LoadoutState>({ state: 'loading' });
  const [files, setFiles] = useState<FilesState>({ state: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<OpenFile | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let current = true;
    setTab(initialTab);
    setSelected(null);
    setOpened(null);
    setLoadout({ state: 'loading' });
    void callVerb<SeatLoadoutOutput>(socket, 'seat.loadout', {
      machine: machineId,
      seat: seatId,
    }).then((a) => {
      if (current)
        setLoadout(a.ok ? { state: 'ok', out: a.value } : { state: 'refused', error: a.error });
    });
    return () => {
      current = false;
    };
  }, [socket, machineId, seatId, initialTab]);

  useEffect(() => {
    if (!rig) {
      setFiles({
        state: 'ok',
        out: { machine: machineId, rig: '', status: 'no-spec', reason: null, files: [] },
      });
      return;
    }
    let current = true;
    setFiles({ state: 'loading' });
    void callVerb<RigFilesOutput>(socket, 'rig.files', { machine: machineId, rig }).then((a) => {
      if (current)
        setFiles(a.ok ? { state: 'ok', out: a.value } : { state: 'refused', error: a.error });
    });
    return () => {
      current = false;
    };
  }, [socket, machineId, rig]);

  useEffect(() => {
    closeRef.current?.focus();
  }, [seatId]);

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [keys, onClose]);

  const layers = useMemo(() => {
    const all = loadout.state === 'ok' ? (loadout.out.loadout?.layers ?? []) : [];
    return [...all].sort((a, b) => LAYER_ORDER.indexOf(a.id) - LAYER_ORDER.indexOf(b.id));
  }, [loadout]);
  const layerDocs: Doc[] = layers
    .filter((l) => l.present && l.content !== null)
    .map((l) => ({
      id: `layer:${l.id}`,
      name: l.name,
      about: LAYER_ABOUT[l.id],
      where: l.path ?? '',
      bytes: l.bytes ?? 0,
      truncated: l.truncated,
    }));
  const absentLayers = layers.filter((l) => !(l.present && l.content !== null));
  const fileDocs: Doc[] =
    files.state === 'ok'
      ? files.out.files.map((f) => ({
          id: `file:${f.id}`,
          name: f.name,
          about: RIG_FILE_ABOUT[f.name] ?? '',
          where: f.scope === 'spec' ? 'team folder' : 'mission folder',
          bytes: f.bytes,
          truncated: f.truncated,
        }))
      : [];

  // The first thing on show is the agent's role (or, failing that, whatever instruction file there
  // is): the page is useful before anyone clicks.
  const firstDoc = layerDocs[0]?.id ?? fileDocs[0]?.id ?? null;
  const shown = selected ?? firstDoc;
  useEffect(() => {
    if (!shown) {
      setOpened(null);
      return;
    }
    if (shown.startsWith('layer:')) {
      const l = layers.find((x) => `layer:${x.id}` === shown);
      setOpened(
        l
          ? {
              state: 'ok',
              id: shown,
              name: l.name,
              bytes: l.bytes ?? 0,
              truncated: l.truncated,
              content: l.content ?? '',
            }
          : null
      );
      return;
    }
    if (!rig) return;
    const fileId = shown.slice('file:'.length);
    let current = true;
    setOpened({ state: 'loading', id: shown });
    void callVerb<RigFileOutput>(socket, 'rig.file', { machine: machineId, rig, fileId }).then(
      (a) => {
        if (!current) return;
        setOpened(
          a.ok
            ? {
                state: 'ok',
                id: shown,
                name: a.value.file.name,
                bytes: a.value.file.bytes,
                truncated: a.value.file.truncated,
                content: a.value.file.content,
              }
            : { state: 'refused', id: shown, error: a.error }
        );
      }
    );
    return () => {
      current = false;
    };
  }, [shown, layers, socket, machineId, rig]);

  const pip = pipFor(seat, machine);
  const chip = modelChip(seat);
  const lines = useMemo(
    () => (tab === 'terminal' && seat.tail ? visibleTail(seat.tail.lines, Infinity) : []),
    [tab, seat.tail]
  );
  // A row may address the seat by its session id or by its logical id (`dev.qa@rig`).
  const mine = useMemo(() => {
    const ids = new Set([seat.id]);
    if (seat.logicalId) {
      ids.add(seat.logicalId);
      if (seat.rig) ids.add(`${seat.logicalId}@${seat.rig}`);
    }
    return ids;
  }, [seat.id, seat.logicalId, seat.rig]);
  const messages: QueueItem[] = useMemo(
    () =>
      machine.snapshot.queue
        .filter((q) => mine.has(q.destination ?? '') || mine.has(q.source ?? ''))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [machine.snapshot.queue, mine]
  );

  const docButton = (d: Doc) => (
    <li key={d.id}>
      <button
        type="button"
        className="agent-doc"
        data-testid="agent-doc"
        data-doc-id={d.id}
        aria-current={d.id === shown ? 'true' : undefined}
        onClick={() => setSelected(d.id)}
      >
        <b>{d.name}</b>
        <span className="files-sub">
          {d.where ? `${d.where} · ` : ''}
          {kb(d.bytes)}
          {d.truncated ? ' · cut' : ''}
        </span>
        {d.about && <span className="files-about">{d.about}</span>}
      </button>
    </li>
  );

  return (
    <aside
      className="agent-panel"
      role="dialog"
      aria-label={`Agent: ${seatName(seat)}`}
      data-testid="agent-panel"
      data-seat-id={seatId}
      data-machine-id={machineId}
      data-tab={tab}
    >
      <header className="agent-head">
        <span className="agent-title" data-testid="agent-title">
          {seatName(seat)}
        </span>
        <span className="focus-sub">
          @{seat.rig ?? 'tmux'} · {machine.machine.label}
        </span>
        <span className="chip" data-family={chip.family}>
          {chip.text}
        </span>
        <span className="state-badge" data-pip={pip}>
          {PIP[pip].glyph} {PIP[pip].label}
          {pip === 'blocked' ? ` · ${blockedBecause(seat)}` : ''}
        </span>
        {!hubConnected && <span className="fresh">hub not connected</span>}
        <button
          ref={closeRef}
          type="button"
          className="pill-btn"
          data-testid="agent-close"
          aria-label="Close agent panel"
          onClick={onClose}
        >
          ✕ Esc
        </button>
      </header>
      <div className="agent-actions">
        {onOpenFocus && (
          <button
            type="button"
            className="pill-btn"
            data-testid="agent-open-focus"
            title="The seat's full-screen view: the big terminal and seat facts"
            onClick={() => onOpenFocus(tile.key)}
          >
            Full screen
          </button>
        )}
        {onOpenRigFiles && seat.rig && (
          <button
            type="button"
            className="pill-btn"
            data-testid="agent-rig-files"
            title="Open this rig's files in the full viewer"
            onClick={() => onOpenRigFiles(machineId, seat.rig!)}
          >
            Rig files
          </button>
        )}
        {onOpenDebug && (
          <button
            type="button"
            className="pill-btn"
            data-testid="agent-debug"
            title="Debug: the skills this agent was listed, by source"
            onClick={() => onOpenDebug(machineId, seatId)}
          >
            Skills · Debug
          </button>
        )}
      </div>
      <div className="agent-tabs" role="tablist" aria-label="Agent views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="agent-tab"
            data-testid={`agent-tab-${t.id}`}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'messages' ? ` · ${messages.length}` : ''}
          </button>
        ))}
      </div>

      {tab === 'documents' && (
        <div className="agent-docs" data-testid="agent-documents">
          <section aria-label="Instructions and startup files">
            <div className="label">This agent&rsquo;s instructions and startup files</div>
            {loadout.state === 'loading' && <p className="quiet">Reading its documents…</p>}
            {loadout.state === 'refused' && (
              <p className="quiet" data-testid="agent-docs-error">
                Could not read its documents: {loadout.error.failureMode}. {loadout.error.message}
              </p>
            )}
            {loadout.state === 'ok' && loadout.out.status === 'pending' && (
              <p className="quiet">No document list has arrived for this agent yet.</p>
            )}
            {layerDocs.length > 0 && <ul className="agent-doc-list">{layerDocs.map(docButton)}</ul>}
            {loadout.state === 'ok' &&
              layerDocs.length === 0 &&
              loadout.out.status !== 'pending' && (
                <p className="quiet" data-testid="agent-docs-none">
                  No instruction files found for this agent.
                </p>
              )}
            {absentLayers.length > 0 && (
              <p className="quiet" data-testid="agent-docs-absent">
                Not present: {absentLayers.map((l) => l.name).join(' · ')}
              </p>
            )}
          </section>
          <section aria-label="Rig files">
            <div className="label">{rig ? `Files of its rig · ${rig}` : 'Files of its rig'}</div>
            {files.state === 'loading' && <p className="quiet">Reading the rig&rsquo;s files…</p>}
            {files.state === 'refused' && (
              <p className="quiet">
                Could not list the rig&rsquo;s files: {files.error.failureMode}.{' '}
                {files.error.message}
              </p>
            )}
            {files.state === 'ok' && files.out.status !== 'ok' && (
              <p className="quiet" data-testid="agent-rigfiles-status">
                {files.out.reason ??
                  (rig
                    ? 'No rig files are available for this rig yet.'
                    : 'This agent is not part of a rig.')}
              </p>
            )}
            {fileDocs.length > 0 && <ul className="agent-doc-list">{fileDocs.map(docButton)}</ul>}
          </section>
          <section className="agent-doc-view" aria-label="Open document">
            {opened?.state === 'loading' && <p className="quiet">Opening…</p>}
            {opened?.state === 'refused' && (
              <p className="quiet">
                Could not open it: {opened.error.failureMode}. {opened.error.message}
              </p>
            )}
            {opened?.state === 'ok' && (
              <>
                <p className="label" data-testid="agent-doc-name">
                  {opened.name} · {kb(opened.bytes)}
                </p>
                {opened.truncated && (
                  <p className="files-cut" role="note">
                    Showing the first part of this file. The rest is not stored here.
                  </p>
                )}
                <DocBody key={opened.id} name={opened.name} content={opened.content} />
              </>
            )}
            {!opened && !shown && <p className="quiet">Nothing to open yet.</p>}
          </section>
        </div>
      )}

      {tab === 'terminal' && (
        <div className="agent-terminal" data-testid="agent-terminal">
          <p className="channel-caption">
            <b>Terminal</b> · the seat&rsquo;s own screen. Read-only; the big version is{' '}
            <i>Full screen</i>.
          </p>
          {seat.tail ? (
            <FocusTerminal lines={lines} hidden={false} />
          ) : (
            <p className="quiet">No terminal text for this seat.</p>
          )}
        </div>
      )}

      {tab === 'messages' && (
        <div className="agent-messages" data-testid="agent-messages">
          <p className="channel-caption">
            Formal handoffs through the OpenRig queue, to or from this agent. → sent · ← received.
          </p>
          {messages.length === 0 && <p className="quiet">No queue rows to or from this agent.</p>}
          {messages.map((q) => (
            <div className="qrow" key={q.id} data-testid="agent-message">
              <span>{q.summary || q.tags.join(', ') || q.id}</span>
              <span className="fresh">{q.state}</span>
              <span className="mono">
                {mine.has(q.source ?? '') ? `→ ${q.destination ?? '?'}` : `← ${q.source ?? '?'}`}
              </span>
              <span className="mono">{ago(now - Date.parse(q.updatedAt))} ago</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
