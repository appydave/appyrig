import { forwardRef } from 'react';
import { PIP, ago } from '../../../fleet/model.js';
import {
  Address,
  ContextLine,
  CopyAttach,
  harnessOf,
  HarnessMark,
  pctText,
  RoleTag,
  tokensText,
} from '../../../components/SeatCardLines.js';
import { attachLine } from '../../../components/WaitingOnDavid.js';
import { MockMark } from '../../kit/index.js';
import { FakeButton } from './FakeRunner.js';
import type { GraphSeat, FlagFilter } from './model.js';

/**
 * C23 / C24 / C43: a roomier agent card. Ids, addresses and figures in mono with tabular
 * numbers; the full mailbox address on every card; harness mark beside the model; context % and
 * tokens; state. The flags the filters look for (C22) show as small marks in the status colours.
 */
export function SeatCard({
  seat,
  selfCount,
  dim,
  highlight,
  onOpen,
  onHover,
  onLeave,
  onTab,
}: {
  seat: GraphSeat;
  selfCount: number;
  /** A filter is on and this seat does not match it. */
  dim: boolean;
  highlight: boolean;
  onOpen: (key: string) => void;
  onHover: (key: string, el: HTMLElement) => void;
  onLeave: () => void;
  /** Tab from a card: lets the page move focus into the open hover card (its buttons). */
  onTab: (e: React.KeyboardEvent) => void;
}) {
  const unplaced = seat.key.startsWith('?/');
  return (
    <button
      type="button"
      className="g2-card"
      data-node-key={seat.key}
      data-testid="g2-card"
      data-pip={seat.pip}
      data-dim={dim || undefined}
      data-highlight={highlight || undefined}
      onClick={() => !unplaced && onOpen(seat.key)}
      onPointerEnter={(e) => onHover(seat.key, e.currentTarget)}
      onFocus={(e) => onHover(seat.key, e.currentTarget)}
      onPointerLeave={onLeave}
      onBlur={onLeave}
      onKeyDown={(e) => {
        if (e.key === 'Tab' && !e.shiftKey) onTab(e);
      }}
      aria-label={`${seat.name} (${PIP[seat.pip].label}): open agent panel`}
      data-explain="seat"
      data-explain-ctx={`${seat.name} · ${seat.model.text} · ${PIP[seat.pip].label}`}
    >
      <span className="g2-card-top">
        <HarnessMark runtime={seat.runtime} model={seat.modelRaw} />
        <span className="chip" data-family={seat.model.family}>
          {seat.model.text}
        </span>
        <span className="pip" data-pip={seat.pip}>
          <span className="pip-glyph">{PIP[seat.pip].glyph}</span> {PIP[seat.pip].label}
        </span>
      </span>
      <b className="g2-card-name">{seat.name}</b>
      <Address id={seat.address} />
      <RoleTag agentRole={seat.agentRole} />
      <ContextLine pct={seat.contextPct} tokens={seat.contextTokens} />
      <span className="g2-card-badges">
        {seat.flags.needsMe && (
          <span
            className="g2-flag"
            data-flag="needsMe"
            title="Needs you: blocked, or asked you something"
          >
            ▲ needs me
          </span>
        )}
        {seat.flags.failing && (
          <span className="g2-flag" data-flag="failing" title="Down while its rig is running">
            ✕ failing
          </span>
        )}
        {seat.open > 0 && <span className="node-wait">{seat.open} waiting</span>}
        {seat.stale > 0 && (
          <span className="g2-flag" data-flag="stuck">
            ⌛ {seat.stale} left open · {ago(seat.oldestStaleMs ?? 0)}
          </span>
        )}
        {selfCount > 0 && <span className="node-self">↺ {selfCount} to itself</span>}
      </span>
    </button>
  );
}

export const seatMatches = (seat: GraphSeat, f: FlagFilter | null) => !f || seat.flags[f];

/**
 * C44: the hover detail card: activity, session, runtime/model, role, edges, tokens, plus the
 * actions (copy attach, and the mock Restart / Stop). Fixed to the window, so the canvas zoom
 * never moves it. Copy attach only with an ssh address from AppyRig's config: never a guess.
 */
interface SeatDetailProps {
  seat: GraphSeat;
  machineLabel: string;
  edges: string;
  /** undefined: not known yet (or the lookup failed); null: no ssh address configured. */
  ssh: string | null | undefined;
  /** Why there is no attach line when `ssh` is not a string, in words (L4). */
  sshNote?: string;
  at: { x: number; y: number; above: boolean };
  onKeep: () => void;
  onLeave: () => void;
  onKeyDown?: React.KeyboardEventHandler;
}

export const SeatDetail = forwardRef<HTMLDivElement, SeatDetailProps>(function SeatDetail(
  { seat, machineLabel, edges, ssh, sshNote, at, onKeep, onLeave, onKeyDown },
  ref
) {
  const canAttach = typeof ssh === 'string' && attachLine(seat.address, ssh) !== null;
  const h = harnessOf(seat.runtime, seat.modelRaw);
  return (
    <div
      ref={ref}
      onKeyDown={onKeyDown}
      className="seat-detail g2-detail"
      data-testid="g2-detail"
      role="dialog"
      aria-label={`${seat.name} details`}
      style={{
        left: at.x,
        top: at.y,
        transform: at.above ? 'translateY(-100%)' : undefined,
      }}
      onPointerEnter={onKeep}
      onPointerLeave={onLeave}
      onFocus={onKeep}
      onBlur={onLeave}
    >
      <div className="seat-detail-head">
        <b>{seat.name}</b>
        {canAttach ? (
          <CopyAttach session={seat.address} ssh={ssh} />
        ) : (
          <span className="quiet g2-no-attach" data-testid="g2-no-attach">
            {sshNote ??
              (ssh === null
                ? `no attach: ${machineLabel} has no ssh address in AppyRig's config`
                : 'no attach line: the ssh address is not known (yet)')}
          </span>
        )}
      </div>
      <dl className="mono">
        <dt>activity</dt>
        <dd>{seat.activity ?? PIP[seat.pip].label}</dd>
        <dt>session</dt>
        <dd>{seat.address}</dd>
        <dt>runtime</dt>
        <dd>
          {h.label} · {seat.modelRaw ?? '—'}
        </dd>
        <dt>role</dt>
        <dd>{seat.agentRole ?? '—'}</dd>
        <dt>edges</dt>
        <dd>{edges}</dd>
        <dt>tokens</dt>
        <dd>
          {tokensText(seat.contextTokens)} · {pctText(seat.contextPct)}
        </dd>
      </dl>
      <div className="g2-detail-actions">
        <FakeButton
          testId="g2-fake-restart"
          ask={{
            label: 'Restart',
            question: `Restart ${seat.name} on the ${machineLabel}?`,
            result: `${seat.name} restarted (pretend)`,
          }}
        />
        <FakeButton
          testId="g2-fake-stop"
          ask={{
            label: 'Stop',
            question: `Stop ${seat.name} on the ${machineLabel}?`,
            result: `${seat.name} stopped (pretend)`,
          }}
        />
        <MockMark />
      </div>
    </div>
  );
});
