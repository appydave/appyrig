import type { FleetMachine } from '@appydave/shared';
import { pressureOf } from '../domain/fleet/health.js';
import {
  blockedBecause,
  blockedDetail,
  blockedLine,
  blockedSeats,
  countSeats,
  freshness,
  seatName,
  type TileRef,
} from '../domain/fleet/model.js';
import type { HubLink } from '../domain/fleet/useFleet.js';

const MAX_BLOCKED_ALERTS = 3;
/** The collector's wording when nothing listens on the OpenRig port (collector/src/adapters/sources.ts). */
const NO_DAEMON = /no OpenRig daemon running/;

interface Props {
  machines: FleetMachine[];
  now: number;
  link: HubLink;
  received: boolean;
  error: string | null;
  /** A blocked-seat alert opens that seat. */
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
      .map((src) => {
        const err = fm.snapshot.sources[src].error;
        // A machine that simply doesn't run OpenRig is a fact, not a fault.
        const absent = src === 'daemon' && !!err && NO_DAEMON.test(err);
        return {
          key: `${fm.machine.id}:${src}`,
          absent,
          text: absent
            ? `${fm.machine.label} · no OpenRig on this machine (tmux seats only)`
            : `${fm.machine.label} · ${src} unreadable${err ? `: ${err}` : ''}`,
        };
      })
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
            {/* S6: the per-machine seat count is on the hover and the Machines card, so three
                machines and their pressure marks stay on one row at 1440 px. */}
            <span className="fresh" title={`${n} seat${n === 1 ? '' : 's'}`}>
              {f.label}
              {fm.liveness === 'asleep' ? ` · ${n} seat${n === 1 ? '' : 's'} paused` : ''}
            </span>
            {(() => {
              // S6: memory pressure, glyph + word; the reason or detail on hover. A click toggles
              // the strip's detail in place (StripShell); it never navigates.
              const p = pressureOf(fm, now);
              const short =
                p.kind === 'no-data' ? 'no data' : p.kind === 'unavailable' ? 'n/a' : p.word;
              const title =
                p.kind === 'no-data' || p.kind === 'unavailable'
                  ? `Memory pressure: ${p.word}. ${p.reason ?? ''}`
                  : `Memory: ${p.word}. ${p.basis ?? ''} Open Machines for memory, swap and processes.`;
              return (
                <button
                  type="button"
                  className="health-mark"
                  data-testid="health-mark"
                  data-kind={p.kind}
                  title={title}
                  aria-label={`${fm.machine.label} ${title}`}
                >
                  {p.glyph} {short}
                </button>
              );
            })()}
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
            title={`${seatName(t.seat)} on ${t.machine.machine.label}: ${blockedLine(t.seat)}`}
            onClick={() => onOpen(t.key)}
          >
            ▲ blocked · {seatName(t.seat)} · {t.machine.machine.label} · {blockedBecause(t.seat)}
            {blockedDetail(t.seat) && (
              // Long questions are cut with an ellipsis by CSS; the title has the full text.
              <>
                {' '}
                <span className="alert-detail">— {blockedDetail(t.seat)}</span>
              </>
            )}
          </button>
        ))}
        {blocked.length > MAX_BLOCKED_ALERTS && (
          <span className="alert" data-kind="muted">
            +{blocked.length - MAX_BLOCKED_ALERTS} more blocked
          </span>
        )}
        {sourceProblems.map((p) =>
          p.absent ? (
            <span key={p.key} className="alert" data-kind="muted" data-testid="no-openrig">
              {p.text}
            </span>
          ) : (
            <span key={p.key} className="alert" data-kind="error">
              ✕ {p.text}
            </span>
          )
        )}
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
