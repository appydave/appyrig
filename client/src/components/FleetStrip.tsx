import type { FleetMachine } from '@appydave/shared';
import {
  blockedBecause,
  blockedSeats,
  countSeats,
  freshness,
  seatName,
  type TileRef,
} from '../fleet/model.js';
import type { HubLink } from '../fleet/useFleet.js';

const MAX_BLOCKED_ALERTS = 3;

interface Props {
  machines: FleetMachine[];
  now: number;
  link: HubLink;
  received: boolean;
  error: string | null;
  onOpen: (key: string) => void;
}

function hubMessage(link: HubLink, received: boolean): string | null {
  if (link === 'unauthorised') return 'Not signed in · open this page once with ?token=<hub token>';
  if (link === 'disconnected') return 'Hub disconnected · showing last-known state';
  if (!received) return 'Connecting to hub…';
  return null;
}

export default function FleetStrip({ machines, now, link, received, error, onOpen }: Props) {
  const counts = countSeats(machines);
  const blocked = blockedSeats(machines);
  const hub = hubMessage(link, received);
  const asleep = machines.filter((m) => m.liveness === 'asleep');
  const sourceProblems = machines.flatMap((fm) =>
    (['daemon', 'tmux'] as const)
      .filter((src) => !fm.snapshot.sources[src].ok)
      .map((src) => ({
        key: `${fm.machine.id}:${src}`,
        text: `${fm.machine.label} · ${src} unreadable${fm.snapshot.sources[src].error ? `: ${fm.snapshot.sources[src].error}` : ''}`,
      }))
  );

  return (
    <section
      className="strip"
      aria-label="Fleet"
      data-testid="fleet-strip"
      data-needs-you={blocked.length > 0}
    >
      {hub && (
        <span
          className="alert"
          data-kind={link === 'connected' ? 'muted' : 'error'}
          data-testid="hub-status"
        >
          {hub}
        </span>
      )}
      {machines.map((fm) => {
        const f = freshness(fm, now, link === 'connected');
        const n = fm.snapshot.seats.length;
        return (
          <span
            key={fm.machine.id}
            className="machine"
            data-testid="machine-chip"
            data-machine-id={fm.machine.id}
            data-liveness={fm.liveness}
            data-level={f.level}
            data-pip={f.level === 'live' ? 'working' : 'asleep'}
          >
            <span
              className="dot"
              style={{ background: 'var(--pip)' }}
              data-pulse={f.level === 'live'}
            />
            {fm.machine.label}
            <span className="fresh">
              {f.label} · {n} seat{n === 1 ? '' : 's'}
              {fm.liveness === 'asleep' ? ' paused' : ''}
            </span>
          </span>
        );
      })}
      {received && machines.length === 0 && (
        <span className="fresh">No machine has reported to the hub yet.</span>
      )}
      {machines.length > 0 && <span className="sep" />}
      {machines.length > 0 && (
        <span className="counts" data-testid="fleet-counts">
          <b>{counts.byStatus.working}</b> working · <b>{counts.byStatus.idle}</b> idle ·{' '}
          <b data-status="blocked">{counts.byStatus.blocked}</b> blocked ·{' '}
          <b>{counts.byStatus.stopped}</b> stopped
          {counts.byStatus.unknown > 0 && (
            <>
              {' '}
              · <b>{counts.byStatus.unknown}</b> unknown
            </>
          )}
          {counts.paused > 0 && (
            <>
              {' '}
              · <b>{counts.paused}</b> paused (asleep)
            </>
          )}
        </span>
      )}
      <span className="strip-end">
        {blocked.slice(0, MAX_BLOCKED_ALERTS).map((t: TileRef) => (
          <button
            key={t.key}
            type="button"
            className="alert"
            data-testid="blocked-alert"
            onClick={() => onOpen(t.key)}
          >
            ▲ blocked · {seatName(t.seat)} · {t.machine.machine.label} · {blockedBecause(t.seat)}
          </button>
        ))}
        {blocked.length > MAX_BLOCKED_ALERTS && (
          <span className="alert" data-kind="muted">
            +{blocked.length - MAX_BLOCKED_ALERTS} more blocked
          </span>
        )}
        {sourceProblems.map((p) => (
          <span key={p.key} className="alert" data-kind="error">
            ✕ {p.text}
          </span>
        ))}
        {asleep.length > 0 && blocked.length === 0 && (
          <span className="fresh">
            Handoffs into {asleep.map((m) => m.machine.label).join(', ')} will bounce until it wakes
          </span>
        )}
        {error && (
          <span className="alert" data-kind="error" title={error}>
            ✕ {error}
          </span>
        )}
      </span>
    </section>
  );
}
