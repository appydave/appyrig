import { memo } from 'react';
import type { FleetMachine, Seat } from '@appydave/shared';
import {
  PIP,
  freshness,
  groupSeats,
  modelChip,
  pipFor,
  seatName,
  visibleTail,
  type GroupBy,
} from '../fleet/model.js';
import AnsiText from './AnsiText.js';

/** Lines a tile shows; the store keeps up to TAIL_MAX_LINES for Focus. */
const TILE_LINES = 14;

interface TileProps {
  tileKey: string;
  machine: FleetMachine;
  seat: Seat;
  freshLabel: string;
  onOpen: (key: string) => void;
}

const SeatTile = memo(function SeatTile({ tileKey, machine, seat, freshLabel, onOpen }: TileProps) {
  const pip = pipFor(seat, machine);
  const chip = modelChip(seat);
  const name = seatName(seat);
  const lines = seat.tail ? visibleTail(seat.tail.lines, TILE_LINES) : [];
  const w = seat.work;
  return (
    <button
      type="button"
      className="tile"
      data-testid="seat-tile"
      data-seat-key={tileKey}
      data-seat-id={seat.id}
      data-machine-id={machine.machine.id}
      data-status={seat.status}
      data-liveness={machine.liveness}
      data-model={chip.text}
      data-pip={pip}
      aria-label={`${name}, ${PIP[pip].label}, ${seat.rig ?? 'tmux'} on ${machine.machine.label}: open in focus`}
      onClick={() => onOpen(tileKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          // Focus closes on Cmd+Enter at window level and is mounted before this native event
          // finishes bubbling, so the opening keypress must not reach window (QA P5 defect 1).
          e.stopPropagation();
          onOpen(tileKey);
        }
      }}
    >
      <span className="tile-bar" />
      <span className="tile-head">
        <span className="tile-name">{name}</span>
        <span className="chip" data-family={chip.family}>
          {chip.text}
        </span>
      </span>
      <span className="tile-meta">
        <span className="pip" data-testid="seat-pip" data-status={seat.status}>
          <span className="pip-glyph">{PIP[pip].glyph}</span>
          {PIP[pip].label}
        </span>
        <span className="tile-where">{machine.machine.label}</span>
      </span>
      {lines.length > 0 && seat.tail ? (
        <AnsiText className="tile-term" testId="seat-tail" lines={lines} ansi={seat.tail.ansi} />
      ) : (
        <span className="tile-term" data-empty="true" data-testid="seat-tail">
          {seat.status === 'stopped' ? 'session stopped · no terminal' : 'no terminal text'}
        </span>
      )}
      <span className="tile-foot">
        <span data-testid="seat-freshness" data-stopped={seat.status === 'stopped'}>
          {/* The label is the machine feed's freshness; on a stopped seat say so (QA m1). */}
          {seat.status === 'stopped'
            ? `stopped · ${machine.machine.label} ${freshLabel}`
            : freshLabel}
        </span>
        <span title="queue: pending / in progress / blocked">
          q {w.pending}/{w.inProgress}/{w.blocked}
        </span>
      </span>
    </button>
  );
});

interface WallProps {
  machines: FleetMachine[];
  groupBy: GroupBy;
  now: number;
  hubConnected: boolean;
  received: boolean;
  onOpen: (key: string) => void;
}

export default function Wall({
  machines,
  groupBy,
  now,
  hubConnected,
  received,
  onOpen,
}: WallProps) {
  const groups = groupSeats(machines, groupBy);
  return (
    <main
      data-testid="wall"
      aria-label="The Wall"
      style={{ display: 'flex', flexDirection: 'column', gap: 22 }}
    >
      {received && groups.length === 0 && (
        <p className="empty">
          No seats yet. Machines appear here as soon as their collector reports.
        </p>
      )}
      {groups.map((g) => {
        // One freshness label per machine per tick, shared by its tiles.
        const fresh = freshness(g.tiles[0]?.machine ?? machines[0], now, hubConnected).label;
        return (
          <section key={g.key} className="group" data-testid="wall-group" data-group-key={g.key}>
            <div className="group-head">
              <b>{g.name}</b>
              <span>{g.where}</span>
              {g.asleep && <span>· asleep</span>}
              <i />
            </div>
            <div className="grid">
              {g.tiles.map((t) => (
                <SeatTile
                  key={t.key}
                  tileKey={t.key}
                  machine={t.machine}
                  seat={t.seat}
                  freshLabel={fresh}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
