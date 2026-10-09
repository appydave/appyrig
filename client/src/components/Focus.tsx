import { useEffect, useMemo, useRef, useState } from 'react';
import type { QueueItem } from '@appydave/shared';
import {
  PIP,
  ago,
  blockedBecause,
  freshness,
  modelChip,
  pipFor,
  seatName,
  stripAnsi,
  visibleTail,
  type TileRef,
} from '../fleet/model.js';
import FocusTerminal from './FocusTerminal.js';

type Mode = 'terminal' | 'rich';

const QUEUE_ROWS = 6;

/**
 * Rich text: the terminal text as readable prose. Strip ANSI, drop rule/box lines, and treat
 * each "⏺" (an agent turn marker) or blank line as a paragraph break. The terminal stays the
 * source of truth; this only makes it easier to read.
 */
export function toParagraphs(lines: string[]): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) out.push(cur.join('\n'));
    cur = [];
  };
  for (const raw of lines) {
    const line = stripAnsi(raw).replace(/\s+$/, '');
    if (/^[\s─━═│┃╭╮╰╯┌┐└┘├┤┬┴┼-]*$/.test(line)) {
      flush();
      continue;
    }
    if (line.trimStart().startsWith('⏺')) flush();
    cur.push(line.trim());
  }
  flush();
  return out;
}

function queueFor(t: TileRef): QueueItem[] {
  return t.machine.snapshot.queue
    .filter((q) => q.destination === t.seat.id || q.source === t.seat.id)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, QUEUE_ROWS);
}

interface Props {
  tile: TileRef;
  now: number;
  hubConnected: boolean;
  onClose: () => void;
}

export default function Focus({ tile, now, hubConnected, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('terminal');
  const closeRef = useRef<HTMLButtonElement>(null);
  const { seat, machine } = tile;
  const pip = pipFor(seat, machine);
  const chip = modelChip(seat);
  const fresh = freshness(machine, now, hubConnected);
  const lines = useMemo(
    () => (seat.tail ? visibleTail(seat.tail.lines, Infinity) : []),
    [seat.tail]
  );
  const paragraphs = useMemo(() => toParagraphs(lines), [lines]);
  const queue = queueFor(tile);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const w = seat.work;
  const rows: [string, string][] = [
    ['Rig / pod', `${seat.rig ?? '—'} · ${seat.pod ?? '—'}`],
    ['Seat', seat.logicalId ?? seat.id],
    ['Runtime', seat.runtime ?? 'unknown'],
    ['Model', seat.model ?? 'not reported'],
    [
      'Machine',
      `${machine.machine.label}${machine.machine.hostname ? ` · ${machine.machine.hostname}` : ''}`,
    ],
    ['Lifecycle', [seat.lifecycleState, seat.sessionStatus].filter(Boolean).join(' · ') || '—'],
    ['Context used', seat.contextUsedPct === null ? '—' : `${seat.contextUsedPct}%`],
    [
      'Last activity',
      seat.lastActivityAt ? `${ago(now - Date.parse(seat.lastActivityAt))} ago` : '—',
    ],
    ['Queue', `${w.pending} waiting · ${w.inProgress} in progress · ${w.blocked} blocked`],
    ['Folder', seat.cwd ?? '—'],
  ];

  return (
    <div
      className="focus"
      role="dialog"
      aria-modal="true"
      aria-label={`Focus: ${seatName(seat)}`}
      data-testid="focus-view"
      data-seat-id={seat.id}
      data-machine-id={machine.machine.id}
      data-mode={mode}
    >
      <header className="focus-head">
        <button
          ref={closeRef}
          type="button"
          className="pill-btn"
          data-testid="focus-close"
          onClick={onClose}
        >
          ← Wall · Esc
        </button>
        <span className="focus-title">{seatName(seat)}</span>
        <span className="focus-sub">
          @{seat.rig ?? 'tmux'} · {machine.machine.label}
        </span>
        <span
          className="chip"
          data-family={chip.family}
          style={{ fontSize: 11, padding: '2px 8px' }}
        >
          {chip.text}
        </span>
        <span className="state-badge" data-pip={pip}>
          {PIP[pip].glyph} {PIP[pip].label}
          {pip === 'blocked' ? ` · ${blockedBecause(seat)}` : ''}
        </span>
        <span className="fresh">{fresh.label}</span>
        <span className="controls">
          <button
            type="button"
            className="pill-btn"
            data-testid="focus-mode-toggle"
            aria-pressed={mode === 'rich'}
            onClick={() => setMode((m) => (m === 'terminal' ? 'rich' : 'terminal'))}
          >
            {mode === 'terminal' ? 'Rich text' : 'Terminal'}
          </button>
          <span className="label">⌘↵ back to wall</span>
        </span>
      </header>

      <div className="focus-body">
        <div className="focus-main">
          <FocusTerminal lines={lines} hidden={mode !== 'terminal'} />
          <article className="focus-rich" data-testid="focus-rich" hidden={mode !== 'rich'}>
            {paragraphs.length === 0 ? (
              <p className="note">No terminal text for this seat.</p>
            ) : (
              paragraphs.map((p, i) => <p key={i}>{p}</p>)
            )}
            <p className="note">
              Rich text is the terminal text without colours and frames. The terminal stays the
              source of truth.
            </p>
          </article>
        </div>

        <aside className="side" data-testid="focus-side" aria-label="Seat details">
          {pip === 'blocked' && (
            <section className="because" data-testid="blocked-because">
              <span className="label">Blocked because</span>
              <span>{blockedBecause(seat)}</span>
              {seat.recoveryGuidance && <span>{seat.recoveryGuidance}</span>}
              <span style={{ fontSize: 12, color: 'var(--ar-ink-muted)' }}>
                Answer it in the seat&rsquo;s own terminal. AppyRig only shows it.
              </span>
            </section>
          )}
          {pip === 'asleep' && (
            <section className="because" data-kind="asleep">
              <span className="label">Machine asleep</span>
              <span>
                {machine.machine.label} has not reported since{' '}
                {new Date(machine.lastSeen).toLocaleTimeString()}. Last known state of this seat:{' '}
                {PIP[seat.status].label}.
              </span>
            </section>
          )}
          {pip !== 'blocked' && seat.recoveryGuidance && (
            <section className="because" data-kind="asleep">
              <span className="label">Recovery guidance</span>
              <span>{seat.recoveryGuidance}</span>
            </section>
          )}
          <section>
            <div className="label" style={{ marginBottom: 4 }}>
              Seat
            </div>
            {rows.map(([k, v]) => (
              <div className="row" key={k}>
                <span>{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </section>
          <section>
            <div className="label" style={{ marginBottom: 4 }}>
              Queue · latest {queue.length}
            </div>
            {queue.length === 0 && <p className="fresh">No queue rows to or from this seat.</p>}
            {queue.map((q) => (
              <div className="qrow" key={q.id}>
                <span>{q.summary ?? q.tags.join(', ') ?? q.id}</span>
                <span className="fresh">{q.state}</span>
                <span className="mono">
                  {q.source === seat.id ? `→ ${q.destination ?? '?'}` : `← ${q.source ?? '?'}`}
                </span>
                <span className="mono">{ago(now - Date.parse(q.updatedAt))} ago</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
