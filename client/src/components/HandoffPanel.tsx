import { useEffect, useState } from 'react';
import type { HandoffGetOutput, QueueItem, Refusal } from '@appydave/shared';
import { callVerb } from '../fleet/coreCall.js';
import type { FleetSocket } from '../fleet/useFleet.js';

export type PanelMode = 'hover' | 'pinned';

/** What the panel shows: the handoffs on one line (an edge), or one packet, plus the one in view. */
export interface PanelSelection {
  /** Edge key `from→to`, or null for a lone packet. */
  edge: string | null;
  /** Readable from → to (stage or seat labels). */
  title: string;
  /** Items on that line up to the replay time, oldest first. */
  items: QueueItem[];
  /** The item whose message is shown; defaults to the latest on the line. */
  itemId: string;
}

type Got =
  | { state: 'loading' }
  | { state: 'ok'; value: HandoffGetOutput }
  | { state: 'refused'; error: Refusal };

interface Props {
  machineId: string;
  selection: PanelSelection | null;
  mode: PanelMode;
  pinned: boolean;
  socket?: FleetSocket;
  /** Bodies already fetched, kept by the parent so moving between lines does not refetch. */
  cache: Map<string, HandoffGetOutput>;
  onPick: (itemId: string) => void;
  onMode: (m: PanelMode) => void;
  onClose: () => void;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const who = (raw: string | null) => (raw ?? '?').split('@')[0];

/**
 * S4 · the handoff detail panel. Says what a handoff on the Flow is: title, from → to, when, its
 * state, and the full message (verdicts and defects included), wrapped so it can be read. The
 * message comes from the read-only `handoff.get` verb; "pending" means the collector has not sent
 * it yet, which is not the same as an empty message.
 */
export default function HandoffPanel({
  machineId,
  selection,
  mode,
  pinned,
  socket,
  cache,
  onPick,
  onMode,
  onClose,
}: Props) {
  const itemId = selection?.itemId ?? null;
  const [got, setGot] = useState<Got>({ state: 'loading' });

  useEffect(() => {
    if (!itemId) return;
    const cached = cache.get(itemId);
    if (cached && cached.bodyStatus === 'present') {
      setGot({ state: 'ok', value: cached });
      return;
    }
    if (!socket) {
      setGot({
        state: 'refused',
        error: { failureMode: 'unavailable', message: 'No hub connection to read the message.' },
      });
      return;
    }
    let current = true;
    setGot({ state: 'loading' });
    void callVerb<HandoffGetOutput>(socket, 'handoff.get', { machine: machineId, id: itemId }).then(
      (a) => {
        if (!current) return;
        if (a.ok) {
          if (a.value.bodyStatus === 'present') cache.set(itemId, a.value);
          setGot({ state: 'ok', value: a.value });
        } else setGot({ state: 'refused', error: a.error });
      }
    );
    return () => {
      current = false;
    };
  }, [itemId, machineId, socket, cache]);

  const modeToggle = (
    <span className="handoff-mode" role="group" aria-label="Show handoff details">
      {(['hover', 'pinned'] as const).map((m) => (
        <button
          key={m}
          type="button"
          className="pill-btn"
          data-testid={`handoff-mode-${m}`}
          aria-pressed={mode === m}
          onClick={() => onMode(m)}
        >
          {m === 'hover' ? 'On hover' : 'Pinned'}
        </button>
      ))}
    </span>
  );

  if (!selection) {
    return (
      <aside className="handoff-panel" data-testid="handoff-panel" data-empty="true">
        <header>
          <span className="label">Handoff details</span>
          {modeToggle}
        </header>
        <p className="quiet">
          Hover or Tab to a line or a dot to see what was handed over: who, when, its state and the
          full message. Click (or Enter) pins it; Esc closes.
        </p>
      </aside>
    );
  }

  const item = selection.items.find((q) => q.id === selection.itemId) ?? null;
  const v = got.state === 'ok' ? got.value : null;
  return (
    <aside
      className="handoff-panel"
      data-testid="handoff-panel"
      data-pinned={pinned}
      aria-label={`Handoffs ${selection.title}`}
    >
      <header>
        <span className="label">
          {pinned ? 'Pinned · ' : ''}
          {selection.title}
        </span>
        {modeToggle}
        <button
          type="button"
          className="pill-btn"
          data-testid="handoff-close"
          aria-label="Close handoff details"
          onClick={onClose}
        >
          ✕ Esc
        </button>
      </header>
      {item && (
        <div className="handoff-head" data-testid="handoff-head">
          <b data-testid="handoff-title">{item.summary || item.tags.join(', ') || item.id}</b>
          <span>
            {who(item.source)} → {who(item.destination)} · {clock(item.createdAt)} ·{' '}
            <span data-testid="handoff-state">{v?.state ?? item.state}</span>
          </span>
        </div>
      )}
      <div className="handoff-body" data-testid="handoff-body" data-status={bodyStatus(got)}>
        {got.state === 'loading' && <p className="quiet">loading message…</p>}
        {got.state === 'refused' && (
          <p className="quiet">
            Couldn&rsquo;t read the message: {got.error.message} The line and its count are still
            right.
          </p>
        )}
        {v && v.bodyStatus === 'pending' && (
          <p className="quiet">
            loading message… (this machine&rsquo;s collector hasn&rsquo;t sent this message yet; it
            arrives with its next push)
          </p>
        )}
        {v && v.bodyStatus === 'present' && (
          <>
            <pre data-testid="handoff-text">{v.body || '(empty message)'}</pre>
            {v.bodyTruncated && (
              <p className="quiet">
                Cut at 4,000 characters; the rest is in the seat&rsquo;s queue.
              </p>
            )}
          </>
        )}
      </div>
      {selection.items.length > 1 && (
        <ol className="handoff-list" aria-label="Handoffs on this line" data-testid="handoff-list">
          {[...selection.items].reverse().map((q) => (
            <li key={q.id}>
              <button
                type="button"
                data-testid="handoff-pick"
                aria-current={q.id === selection.itemId ? 'true' : undefined}
                onClick={() => onPick(q.id)}
              >
                <span>{clock(q.createdAt)}</span> {q.summary || q.id}
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function bodyStatus(got: Got): string {
  if (got.state !== 'ok') return got.state;
  return got.value.bodyStatus;
}
