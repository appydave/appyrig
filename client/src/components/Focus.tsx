import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { UI_PRINCIPAL, type QueueItem, type Refusal, type SeatGetOutput } from '@appydave/shared';
import { callVerb } from '../fleet/coreCall.js';
import type { FleetSocket } from '../fleet/useFleet.js';
import {
  PIP,
  ago,
  blockedBecause,
  blockedDetail,
  freshness,
  modelChip,
  pipFor,
  seatName,
  stripAnsi,
  visibleTail,
  type TileRef,
} from '../fleet/model.js';
import { isShortcutBlocked } from '../lib/keys.js';
import FocusTerminal from './FocusTerminal.js';
import SkillPill from './SkillPill.js';

type Mode = 'terminal' | 'rich';

const QUEUE_ROWS = 6;

/** Agent turn markers: Claude Code prints "⏺" (some fonts and captures give "●"). */
const TURN = /^\s*[⏺●]/;
/** Lines that start a new visual line in prose: list items, tool results, numbered options. */
const LINE_START = /^\s*(?:[-*•⎿└❯›>]|\d+[.)]\s|[✓✕✗✔✘✻✽✳◐○▲])/;
/** Rules, frames and box-drawing only. */
const RULE = /^[\s─━═│┃╭╮╰╯┌┐└┘├┤┬┴┼-]*$/;

/** The agent's latest turn: from the last turn marker to the end. Falls back to the last 40 lines. */
export function lastTurn(lines: string[]): string[] {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (TURN.test(stripAnsi(lines[i]))) return lines.slice(i);
  }
  return lines.slice(-40);
}

/**
 * Rich text: the agent's latest turn as readable prose. Strip ANSI, drop rule/box lines, break
 * paragraphs on blank lines and turn markers, and re-join the terminal's hard wraps, keeping
 * list items and options on their own lines. The terminal stays the source of truth.
 */
export function toParagraphs(lines: string[]): string[] {
  const out: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur) out.push(cur);
    cur = '';
  };
  for (const raw of lines) {
    const line = stripAnsi(raw).replace(/\s+$/, '');
    if (RULE.test(line)) {
      flush();
      continue;
    }
    if (TURN.test(line)) flush();
    const text = line.trim();
    if (!cur) cur = text;
    else if (LINE_START.test(line)) cur += `\n${text}`;
    else cur += ` ${text}`;
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

type SeatCall =
  | { state: 'pending' }
  | { state: 'ok'; value: SeatGetOutput }
  | { state: 'refused'; error: Refusal };

/**
 * D54: opening Focus is the verb `seat.get` (B13), called once over the socket's `core:call`.
 * Live updates keep arriving through `fleet:update`; Focus shows whichever of the two is newer
 * (by the machine's lastSeen). A refusal is shown as data, never swallowed.
 */
export function newerTile(tile: TileRef, call: SeatCall): TileRef {
  if (call.state !== 'ok') return tile;
  const v = call.value;
  if (Date.parse(v.lastSeen) <= Date.parse(tile.machine.lastSeen)) return tile;
  return {
    ...tile,
    seat: v.seat,
    machine: { ...tile.machine, liveness: v.liveness, lastSeen: v.lastSeen },
  };
}

interface Props {
  tile: TileRef;
  socket: FleetSocket;
  now: number;
  hubConnected: boolean;
  onClose: () => void;
  /** S1 (QA D3): the legend for this panel, rendered under the header when open. */
  legend?: ReactNode;
  legendOpen?: boolean;
  onToggleLegend?: () => void;
  /** S7-ui: open this seat's rig files (its rig.yaml, mission and culture notes). */
  onOpenRigFiles?: (machineId: string, rig: string) => void;
  /** v1.5 · L1: open this seat's Debug view (what it runs with). Also the key D. */
  onOpenDebug?: (machineId: string, seatId: string) => void;
  /**
   * The one pause mechanism (r1): Focus owns Esc and ⌘↵ only while nothing sits on top of it.
   * App passes false while the feedback composer (S8) or the rig files viewer (S7) is open over
   * the panel, so one Esc closes one thing. Same convention as Wall and HandoffFlow.
   */
  keys?: boolean;
}

export default function Focus({
  tile: storeTile,
  socket,
  now,
  hubConnected,
  onClose,
  legend,
  legendOpen = false,
  onToggleLegend,
  onOpenRigFiles,
  onOpenDebug,
  keys = true,
}: Props) {
  const [mode, setMode] = useState<Mode>('terminal');
  const [call, setCall] = useState<SeatCall>({ state: 'pending' });
  const closeRef = useRef<HTMLButtonElement>(null);
  const machineId = storeTile.machine.machine.id;
  const seatId = storeTile.seat.id;

  useEffect(() => {
    let current = true;
    setCall({ state: 'pending' });
    void callVerb<SeatGetOutput>(socket, 'seat.get', { machine: machineId, seat: seatId }).then(
      (answer) => {
        if (!current) return;
        setCall(
          answer.ok
            ? { state: 'ok', value: answer.value }
            : { state: 'refused', error: answer.error }
        );
      }
    );
    return () => {
      current = false;
    };
  }, [socket, machineId, seatId]);

  const tile = newerTile(storeTile, call);
  const { seat, machine } = tile;
  const pip = pipFor(seat, machine);
  const chip = modelChip(seat);
  const fresh = freshness(machine, now, hubConnected);
  const lines = useMemo(
    () => (seat.tail ? visibleTail(seat.tail.lines, Infinity) : []),
    [seat.tail]
  );
  const paragraphs = useMemo(() => toParagraphs(lastTurn(lines)), [lines]);
  const queue = queueFor(tile);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        onClose();
        return;
      }
      if ((e.key === 'd' || e.key === 'D') && onOpenDebug && !isShortcutBlocked(e)) {
        e.preventDefault();
        onOpenDebug(machineId, seatId);
      }
    };
    // Capture phase: Focus sees Esc before anything inside it (the terminal's textarea) can
    // swallow it (QA M1). The keypress that opened Focus is already past window's capture phase
    // when this attaches, so it cannot close Focus straight away.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, onOpenDebug, keys, machineId, seatId]);

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
      className="focus-view"
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
        <SkillPill
          count={seat.skillCount}
          onOpen={onOpenDebug ? () => onOpenDebug(machine.machine.id, seat.id) : undefined}
        />
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
          {onOpenRigFiles && seat.rig && (
            <button
              type="button"
              className="pill-btn"
              data-testid="focus-rig-files"
              data-explain="rig-files"
              title="Open this rig's files: rig.yaml, mission and culture notes"
              onClick={() => onOpenRigFiles(machine.machine.id, seat.rig!)}
            >
              Rig files
            </button>
          )}
          {onOpenDebug && (
            <button
              type="button"
              className="pill-btn"
              data-testid="focus-debug"
              aria-keyshortcuts="D"
              title="Debug: what this seat runs with (listed skills by source, prompt layers)"
              onClick={() => onOpenDebug(machine.machine.id, seat.id)}
            >
              Debug · D
            </button>
          )}
          {onToggleLegend && (
            <button
              type="button"
              className="pill-btn"
              data-testid="focus-legend-toggle"
              aria-pressed={legendOpen}
              aria-keyshortcuts="L"
              onClick={onToggleLegend}
            >
              Legend · L
            </button>
          )}
          <span className="label">⌘↵ back to wall</span>
        </span>
      </header>
      {legend}

      <div className="focus-body">
        <div className="focus-main">
          <p className="channel-caption" data-testid="channel-terminal">
            <b>{mode === 'terminal' ? 'Terminal' : 'Rich text'}</b> · the seat&rsquo;s own screen:
            what it is saying and doing. One channel; the queue on the right is the other.
          </p>
          <FocusTerminal lines={lines} hidden={mode !== 'terminal'} />
          <article className="focus-rich" data-testid="focus-rich" hidden={mode !== 'rich'}>
            {paragraphs.length === 0 ? (
              <p className="note">No terminal text for this seat.</p>
            ) : (
              paragraphs.map((p, i) => <p key={i}>{p}</p>)
            )}
            <p className="note">
              Rich text is the seat&rsquo;s latest turn, without colours, frames or hard wraps.
              Earlier output and the exact screen are in Terminal, which stays the source of truth.
            </p>
          </article>
        </div>

        <aside className="side" data-testid="focus-side" aria-label="Seat details">
          {call.state === 'refused' && (
            <section
              className="because"
              data-kind="error"
              data-testid="focus-call"
              data-state="refused"
            >
              <span className="label">seat.get refused · {call.error.failureMode}</span>
              <span>{call.error.message}</span>
              <span style={{ fontSize: 12, color: 'var(--ar-ink-muted)' }}>
                Showing the last state from the live feed instead.
              </span>
            </section>
          )}
          {pip === 'blocked' && (
            <section className="because" data-testid="blocked-because">
              <span className="label">Blocked because</span>
              <span data-testid="blocked-reason">
                <b>{blockedBecause(seat)}</b>
                {blockedDetail(seat) && <> — {blockedDetail(seat)}</>}
              </span>
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
          {call.state !== 'refused' && (
            <p className="fresh" data-testid="focus-call" data-state={call.state}>
              {call.state === 'pending' ? 'seat.get …' : `seat.get · ok · as ${UI_PRINCIPAL}`}
            </p>
          )}
          <section>
            <div className="label" style={{ marginBottom: 4 }}>
              Queue · latest {queue.length}
            </div>
            <p className="channel-caption" data-testid="channel-queue">
              Formal handoffs through the OpenRig queue, not the terminal. → sent by this seat · ←
              received.
            </p>
            {queue.length === 0 && <p className="fresh">No queue rows to or from this seat.</p>}
            {queue.map((q) => (
              <div className="qrow" key={q.id}>
                <span>{q.summary || q.tags.join(', ') || q.id}</span>
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
