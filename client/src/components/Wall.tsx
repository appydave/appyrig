import { memo, useEffect, useRef } from 'react';
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
import { isShortcutBlocked } from '../lib/keys.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;
type Arrow = (typeof ARROWS)[number];

/**
 * S2: which tile an arrow key moves to. Left/Right walk reading order (across group breaks);
 * Up/Down go to the nearest row above or below, then the tile closest in x. Stays put at an edge.
 */
export function nextTile(boxes: Box[], cur: number, key: Arrow): number {
  if (cur < 0) return boxes.length ? 0 : -1;
  if (key === 'ArrowLeft') return Math.max(0, cur - 1);
  if (key === 'ArrowRight') return Math.min(boxes.length - 1, cur + 1);
  const c = boxes[cur]!;
  const cy = c.y + c.h / 2;
  const cx = c.x + c.w / 2;
  const down = key === 'ArrowDown';
  let best = cur;
  let bestDy = Infinity;
  let bestDx = Infinity;
  boxes.forEach((b, i) => {
    const dy = b.y + b.h / 2 - cy;
    if (down ? dy <= c.h / 2 : dy >= -c.h / 2) return;
    const ady = Math.abs(dy);
    const adx = Math.abs(b.x + b.w / 2 - cx);
    // Nearest row first (rows within a few px count as one), then nearest column.
    if (ady < bestDy - 4 || (Math.abs(ady - bestDy) <= 4 && adx < bestDx)) {
      best = i;
      bestDy = ady;
      bestDx = adx;
    }
  });
  return best;
}

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
      data-explain="seat"
      data-explain-ctx={`${name} · ${chip.text} · ${seat.rig ?? 'plain tmux session'} on ${machine.machine.label}`}
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
        <span className="chip" data-family={chip.family} data-explain="model">
          {chip.text}
        </span>
      </span>
      <span className="tile-meta">
        <span
          className="pip"
          data-testid="seat-pip"
          data-status={seat.status}
          data-explain={`status-${pip}`}
        >
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
  /** S2: arrow keys move between tiles. Off while Focus or an overlay owns the keyboard. */
  keys?: boolean;
}

export default function Wall({
  machines,
  groupBy,
  now,
  hubConnected,
  received,
  onOpen,
  keys = true,
}: WallProps) {
  const groups = groupSeats(machines, groupBy);
  const box = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(ARROWS as readonly string[]).includes(e.key) || isShortcutBlocked(e)) return;
      const wall = box.current;
      if (!wall) return;
      const active = document.activeElement;
      // From anywhere on the page (a header tab, the body, a tile), but never out of a dialog.
      if (active?.closest('[role="dialog"]')) return;
      const tiles = [...wall.querySelectorAll<HTMLElement>('[data-testid="seat-tile"]')];
      const boxes = tiles.map((t) => {
        const r = t.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      });
      const i = nextTile(boxes, tiles.indexOf(active as HTMLElement), e.key as Arrow);
      const el = tiles[i];
      if (!el) return;
      e.preventDefault();
      el.focus();
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys]);

  return (
    <main
      ref={box}
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
