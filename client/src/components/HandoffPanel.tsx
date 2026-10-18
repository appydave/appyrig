import { useEffect, useRef, useState } from 'react';
import type { HandoffGetOutput, QueueItem, Refusal } from '@appydave/shared';
import { callVerb } from '../fleet/coreCall.js';
import type { FleetSocket } from '../fleet/useFleet.js';
import { isShortcutBlocked } from '../lib/keys.js';

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
  /** A stage with several seats: the agents in it, each opening the one agent panel. */
  agents?: { key: string; name: string }[];
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
  /** C6a: false hides the On click / Follow pointer toggle (the Map's drawer opens on click only). */
  showMode?: boolean;
  /** Views V2: shows "Follow this work" on the handoff in view. */
  onFollow?: (itemId: string) => void;
  /** Views K: J/K (and [ ] with onLine) work while the panel shows a handoff. Off under overlays. */
  keys?: boolean;
  /** Views K: ] next / [ previous line (or lane), opening its newest handoff. */
  onLine?: (dir: 1 | -1) => void;
  /** What [ ] step through, in the hint: a map or flow "line", a timeline "lane". */
  lineWord?: string;
  /** D15 · UI-B: opens the one agent panel (documents, terminal, messages) for a seat. */
  onOpenAgent?: (seatKey: string) => void;
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
  showMode = true,
  onFollow,
  keys = false,
  onLine,
  lineWord = 'line',
  onOpenAgent,
}: Props) {
  const itemId = selection?.itemId ?? null;
  const [got, setGot] = useState<Got>({ state: 'loading' });
  const list = useRef<HTMLOListElement>(null);

  // Views K: J = next (older) in the list, K = previous (newer); ] / [ = next / previous line.
  // Only while a handoff is shown, never while typing (isShortcutBlocked), and the list row and
  // the message move together because both follow selection.itemId.
  const items = selection?.items;
  useEffect(() => {
    if (!keys || !items?.length || !itemId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isShortcutBlocked(e)) return;
      const k = e.key.toLowerCase();
      if (k === 'j' || k === 'k') {
        e.preventDefault();
        const i = items.findIndex((q) => q.id === itemId);
        const next = items[Math.max(0, Math.min(items.length - 1, i + (k === 'j' ? -1 : 1)))];
        if (next && next.id !== itemId) onPick(next.id);
      } else if ((e.key === ']' || e.key === '[') && onLine) {
        e.preventDefault();
        onLine(e.key === ']' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys, items, itemId, onPick, onLine]);

  // Keep the highlighted row in view as J/K walk the list.
  useEffect(() => {
    list.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [itemId]);

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

  const modeToggle = !showMode ? null : (
    <span className="handoff-mode" role="group" aria-label="Panel shows">
      <span className="label">Panel shows</span>
      {(['pinned', 'hover'] as const).map((m) => (
        <button
          key={m}
          type="button"
          className="pill-btn"
          data-testid={`handoff-mode-${m}`}
          aria-pressed={mode === m}
          onClick={() => onMode(m)}
        >
          {m === 'hover' ? 'Follow pointer' : 'On click'}
        </button>
      ))}
    </span>
  );

  // B1 (fb-0007): the panel always says which way it works and what it is showing now.
  const status = (
    <p
      className="handoff-status"
      data-testid="handoff-status"
      data-mode={mode}
      data-pinned={pinned}
    >
      {mode === 'hover'
        ? pinned
          ? 'Kept because you clicked it. Esc or ✕ lets it follow the pointer again.'
          : 'Follows the pointer: point at a line, a dot or a box. Click one to keep it here.'
        : selection
          ? 'Showing what you clicked. Click another line, dot or box, or press Esc to clear.'
          : 'Click a line, a dot or a box to show its handoffs here. Pointing only shows a small card.'}
    </p>
  );

  if (!selection) {
    return (
      <aside
        className="handoff-panel"
        data-testid="handoff-panel"
        data-empty="true"
        data-mode={mode}
      >
        <header>
          <span className="label">Handoff details</span>
          {modeToggle}
        </header>
        {status}
        <p className="quiet">
          Each line is work handed from one seat to another; a box is a seat (or a role). You see
          who, when, its state and the full message. Tab and Enter work too; Esc closes.
        </p>
      </aside>
    );
  }

  if (selection.items.length === 0) {
    return (
      <aside
        className="handoff-panel"
        data-testid="handoff-panel"
        data-pinned={pinned}
        data-mode={mode}
        data-none="true"
        aria-label={`Handoffs ${selection.title}`}
      >
        <header>
          <span className="label" data-testid="handoff-none-title">
            {selection.title}: no handoffs through the queue
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
        {status}
        {onOpenAgent && selection.agents && selection.agents.length > 1 && (
          <p className="handoff-agents" data-testid="handoff-agents">
            <span className="label">Open agent</span>
            {selection.agents.map((a) => (
              <button
                key={a.key}
                type="button"
                className="pill-btn"
                data-testid="handoff-agent"
                onClick={() => onOpenAgent(a.key)}
              >
                {a.name}
              </button>
            ))}
          </p>
        )}
        <p className="quiet" data-testid="handoff-none">
          No handoffs through the queue to or from this seat. It may still talk to others directly
          (typed messages), which the queue does not record.
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
      data-mode={mode}
      aria-label={`Handoffs ${selection.title}`}
    >
      <header>
        <span className="label">
          {pinned && mode === 'hover' ? 'Kept · ' : ''}
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
      {status}
      {onOpenAgent && selection.agents && selection.agents.length > 1 && (
        <p className="handoff-agents" data-testid="handoff-agents">
          <span className="label">Open agent</span>
          {selection.agents.map((a) => (
            <button
              key={a.key}
              type="button"
              className="pill-btn"
              data-testid="handoff-agent"
              onClick={() => onOpenAgent(a.key)}
            >
              {a.name}
            </button>
          ))}
        </p>
      )}
      {keys && (
        <p className="handoff-keys" data-testid="handoff-keys-hint">
          <kbd>J</kbd>/<kbd>K</kbd> older / newer handoff
          {onLine && (
            <>
              {' '}
              · <kbd>[</kbd> <kbd>]</kbd> previous / next {lineWord}
            </>
          )}
        </p>
      )}
      {item && (
        <div className="handoff-head" data-testid="handoff-head">
          <b data-testid="handoff-title">{item.summary || item.tags.join(', ') || item.id}</b>
          <span>
            {who(item.source)} → {who(item.destination)} · {clock(item.createdAt)} ·{' '}
            <span data-testid="handoff-state">{v?.state ?? item.state}</span>
          </span>
          {onFollow && (
            <button
              type="button"
              className="pill-btn follow-btn"
              data-testid="handoff-follow"
              onClick={() => onFollow(item.id)}
            >
              Follow this work →
            </button>
          )}
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
        <ol
          ref={list}
          className="handoff-list"
          aria-label="Handoffs on this line"
          data-testid="handoff-list"
        >
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
