import { useEffect, useMemo, useState } from 'react';
import type { FleetMachine, QueueItem, RigWaitingOutput } from '@appydave/shared';
import {
  PIP,
  ago,
  freshness,
  modelChip,
  pipFor,
  seatName,
  visibleTail,
} from '../../fleet/model.js';
import type { FleetSocket } from '../../fleet/useFleet.js';
import {
  CopyAttach,
  HarnessMark,
  RoleTag,
  pctText,
  tokensText,
} from '../../components/SeatCardLines.js';
import type { AgentPanelTab, AgentPanelTarget } from '../types.js';
import { findTile, seatAddresses } from '../seats.js';
import { DocsLayout, useRead } from './DocsDrawer.js';
import { useTopOffset } from './useTopOffset.js';
import './docs.css';

const TABS: { id: AgentPanelTab; label: string }[] = [
  { id: 'documents', label: 'Documents' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'messages', label: 'Messages' },
];

/** `machineId`, `seatKey` (`machine/seat`, or a bare seat id) and `tab` (default Documents) come from the shared target. */
export interface AgentPanelProps extends AgentPanelTarget {
  onClose: () => void;
  /** "Open full agent page →". The host navigates; the panel only asks. */
  onOpenPage: (seatKey: string) => void;
  /** The same context slice every v2 page has: the machines to find the agent in, the socket, the clock. */
  ctx: { allMachines: FleetMachine[]; getSocket: () => FleetSocket; now: number };
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b?\[[0-9;?]*[ -/]*[@-~]/g;
export const stripAnsi = (s: string) => s.replace(ANSI, '');

/**
 * The right-side Agent panel: opened on top of the current page, never instead of it. Starts below
 * the top bar, so the nav (and the left Rigs drawer) stay clickable. Identity block, then tabs:
 * Documents (the DocsDrawer's list + reader), Terminal (the last lines, colour codes stripped) and
 * Messages (this seat's handoffs from the snapshot). Esc and × close it. Read-only.
 */
export default function AgentPanel(p: AgentPanelProps) {
  const { machineId, onClose, ctx } = p;
  const key = p.seatKey.startsWith(`${machineId}/`) ? p.seatKey : `${machineId}/${p.seatKey}`;
  const tile = useMemo(() => findTile(ctx.allMachines, key), [ctx.allMachines, key]);
  const [tab, setTab] = useState<AgentPanelTab>(p.tab ?? 'documents');
  useEffect(() => setTab(p.tab ?? 'documents'), [p.tab, key]);
  const top = useTopOffset();
  const [wide, setWide] = useState(false);
  // In the narrow peek the page makes room (see docs.css), so its chips and controls stay clickable.
  useEffect(() => {
    const root = document.documentElement;
    if (wide) root.removeAttribute('data-agent-panel');
    else root.setAttribute('data-agent-panel', 'peek');
    return () => root.removeAttribute('data-agent-panel');
  }, [wide]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const rig = tile?.seat.rig ?? null;
  const waiting = useRead<RigWaitingOutput>(
    ctx.getSocket,
    'rig.waiting',
    rig ? { machine: machineId, rig } : null
  );
  if (!tile) {
    return (
      <aside
        className="apanel"
        style={{ top }}
        role="dialog"
        aria-label="Agent"
        data-testid="agent-panel"
      >
        <header className="apanel-head">
          <h3>{p.seatKey}</h3>
          <span className="apanel-spacer" />
          <button
            type="button"
            className="pill-btn apanel-x"
            data-testid="apanel-close"
            aria-label="Close the agent panel"
            title="Close (Esc)"
            onClick={onClose}
          >
            × Close
          </button>
        </header>
        <p className="quiet" style={{ padding: 16 }} data-testid="apanel-gone">
          This agent is no longer reported by its machine.
        </p>
      </aside>
    );
  }
  const { seat, machine } = tile;
  const pip = pipFor(seat, machine);
  const chip = modelChip(seat);
  const name = seatName(seat);
  const ssh = waiting.state === 'ok' ? waiting.value.ssh : null;
  return (
    <aside
      className="apanel"
      style={{ top }}
      role="dialog"
      aria-label={`Agent · ${name}`}
      data-testid="agent-panel"
      data-pip={pip}
      data-wide={wide || undefined}
    >
      <header className="apanel-head">
        <h3 data-testid="apanel-name">{name}</h3>
        <span className="state-badge" data-pip={pip} data-testid="apanel-state">
          {PIP[pip].glyph} {PIP[pip].label}
        </span>
        <span className="mono quiet" data-testid="apanel-address">
          {seat.id}
        </span>
        <span className="apanel-spacer" />
        <CopyAttach session={seat.id} ssh={ssh} />
        <button
          type="button"
          className="pill-btn"
          data-testid="apanel-open-page"
          onClick={() => p.onOpenPage(key)}
        >
          Open full agent page →
        </button>
        <button
          type="button"
          className="pill-btn apanel-x"
          data-testid="apanel-expand"
          aria-pressed={wide}
          title={wide ? 'Back to the narrow peek' : 'Widen the panel for a long document'}
          onClick={() => setWide((v) => !v)}
        >
          {wide ? '⇥ Narrow' : '⇤ Expand'}
        </button>
        <button
          type="button"
          className="pill-btn apanel-x"
          data-testid="apanel-close"
          aria-label="Close the agent panel"
          title="Close (Esc)"
          onClick={onClose}
        >
          × Close
        </button>
      </header>
      <dl className="apanel-id" data-testid="apanel-identity">
        <div>
          <dt>Rig</dt>
          <dd>{seat.rig ?? 'none (plain tmux)'}</dd>
        </div>
        <div>
          <dt>Pod</dt>
          <dd>{seat.pod ?? '—'}</dd>
        </div>
        <div>
          <dt>Member</dt>
          <dd>{seat.logicalId ?? name}</dd>
        </div>
        <div>
          <dt>Harness · model</dt>
          <dd>
            <HarnessMark runtime={seat.runtime} model={seat.model} />{' '}
            <span className="chip" data-family={chip.family}>
              {chip.text}
            </span>{' '}
            <RoleTag agentRole={seat.agentRole} />
          </dd>
        </div>
        <div>
          <dt>Context</dt>
          <dd className="mono">
            {pctText(seat.contextUsedPct)} · {tokensText(seat.contextTokens)} tokens
          </dd>
        </div>
        <div>
          <dt>Machine</dt>
          <dd>
            {machine.machine.label}{' '}
            <span className="quiet">{freshness(machine, ctx.now, true).label}</span>
          </dd>
        </div>
        {seat.cwd && (
          <div>
            <dt>Folder</dt>
            <dd className="mono">{seat.cwd}</dd>
          </div>
        )}
      </dl>
      <div className="apanel-tabs" role="tablist" aria-label="Agent panel">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            className="apanel-tab"
            data-testid={`apanel-tab-${t.id}`}
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="apanel-body" role="tabpanel" data-testid={`apanel-body-${tab}`}>
        {tab === 'documents' && (
          <DocsLayout getSocket={ctx.getSocket} target={{ machineId, seat }} />
        )}
        {tab === 'terminal' && <TerminalTab tail={seat.tail?.lines ?? null} />}
        {tab === 'messages' && (
          <MessagesTab machine={machine} seatId={seat.id} now={ctx.now} seat={seat} />
        )}
      </div>
    </aside>
  );
}

function TerminalTab({ tail }: { tail: string[] | null }) {
  if (!tail)
    return (
      <p className="quiet" style={{ padding: 16 }}>
        No terminal text for this seat.
      </p>
    );
  const lines = visibleTail(tail, 60).map(stripAnsi);
  return (
    <pre className="apanel-term" tabIndex={0} data-testid="apanel-terminal">
      {lines.join('\n')}
    </pre>
  );
}

function MessagesTab({
  machine,
  seat,
  seatId,
  now,
}: {
  machine: FleetMachine;
  seat: import('@appydave/shared').Seat;
  seatId: string;
  now: number;
}) {
  const mine = useMemo(() => seatAddresses(seat), [seat]);
  const rows: QueueItem[] = useMemo(
    () =>
      machine.snapshot.queue
        .filter((q) => mine.has(q.destination ?? '') || mine.has(q.source ?? ''))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [machine.snapshot.queue, mine]
  );
  const inbox = rows.filter((q) => mine.has(q.destination ?? ''));
  const outbox = rows.filter((q) => mine.has(q.source ?? '') && !mine.has(q.destination ?? ''));
  const list = (items: QueueItem[], dir: 'in' | 'out') =>
    items.length === 0 ? (
      <p className="quiet">None.</p>
    ) : (
      <ul>
        {items.slice(0, 30).map((q) => (
          <li key={q.id} data-testid={`apanel-msg-${dir}`}>
            {q.summary || q.tags.join(', ') || q.id}{' '}
            <span className="quiet mono">
              {q.state} · {dir === 'in' ? `← ${q.source ?? '?'}` : `→ ${q.destination ?? '?'}`} ·{' '}
              {ago(now - Date.parse(q.updatedAt))} ago
            </span>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="apanel-msgs" data-testid="apanel-messages" data-seat={seatId}>
      <h4>In · {inbox.length}</h4>
      {list(inbox, 'in')}
      <h4>Out · {outbox.length}</h4>
      {list(outbox, 'out')}
    </div>
  );
}
