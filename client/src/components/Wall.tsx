import { memo, useEffect, useRef, useState } from 'react';
import type { FleetMachine, Seat } from '@appydave/shared';
import {
  PIP,
  WALL_ORDER_TEXT,
  collapsedByDefault,
  freshness,
  groupSeats,
  groupState,
  type PipKey,
  type WallGroup,
  modelChip,
  pipFor,
  seatName,
  contentTail,
  type GroupBy,
} from '../fleet/model.js';
import AnsiText from './AnsiText.js';
import { rigTitle } from './RigInfo.js';
import { isShortcutBlocked } from '../lib/keys.js';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const OPEN_KEY = 'appyrig.groups';

/** Per-viewer open/closed overrides by group key; anything not listed follows its default. */
function readOpen(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

const PIP_ORDER: PipKey[] = ['blocked', 'working', 'idle', 'unknown', 'stopped', 'asleep'];

/** "● 2 working · ○ 3 idle": a group's seats by status, glyph first (never colour alone). */
function statusCounts(g: WallGroup): { pip: PipKey; n: number }[] {
  const n = new Map<PipKey, number>();
  for (const t of g.tiles) {
    const pip = pipFor(t.seat, t.machine);
    n.set(pip, (n.get(pip) ?? 0) + 1);
  }
  return PIP_ORDER.filter((p) => n.has(p)).map((pip) => ({ pip, n: n.get(pip)! }));
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

/**
 * Lines a tile shows; the store keeps up to TAIL_MAX_LINES for Focus. S3: a working seat shows
 * enough to see what it is doing; every other seat a glance, so running teams fit on one screen.
 */
const TILE_LINES_WORKING = 7;
const TILE_LINES_OTHER = 3;

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
  const lines = seat.tail
    ? contentTail(seat.tail.lines, pip === 'working' ? TILE_LINES_WORKING : TILE_LINES_OTHER)
    : [];
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
  /** S3: machines the viewer filtered out, named on the Wall so nothing vanishes silently. */
  hidden?: { id: string; label: string }[];
  onShow?: (machineId: string) => void;
}

export default function Wall({
  machines,
  groupBy,
  now,
  hubConnected,
  received,
  onOpen,
  keys = true,
  hidden = [],
  onShow,
}: WallProps) {
  const groups = groupSeats(machines, groupBy);
  const box = useRef<HTMLElement>(null);
  const [openAt, setOpenAt] = useState<Record<string, boolean>>(readOpen);
  const isOpen = (g: WallGroup) => openAt[g.key] ?? !collapsedByDefault(g);
  const toggle = (g: WallGroup) => {
    const next = { ...openAt, [g.key]: !isOpen(g) };
    setOpenAt(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      // per-viewer convenience only
    }
  };

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
      {received && groups.length === 0 && hidden.length === 0 && (
        <p className="empty">
          No seats yet. Machines appear here as soon as their collector reports.
        </p>
      )}
      {hidden.length > 0 && (
        <p className="filter-note" data-testid="wall-hidden">
          Hidden by the machine filter:{' '}
          {hidden.map((m) => (
            <button
              key={m.id}
              type="button"
              className="pill-btn"
              data-testid="wall-show-machine"
              onClick={() => onShow?.(m.id)}
            >
              ○ {m.label} · show
            </button>
          ))}
        </p>
      )}
      {groups.length > 0 && (
        <p className="view-caption wall-order" data-testid="wall-order">
          {WALL_ORDER_TEXT}
        </p>
      )}
      {groups.map((g) => {
        // One freshness label per machine per tick, shared by its tiles.
        const fresh = freshness(g.tiles[0]?.machine ?? machines[0], now, hubConnected).label;
        const open = isOpen(g);
        const state = groupState(g);
        return (
          <section
            key={g.key}
            className="group"
            data-testid="wall-group"
            data-group-key={g.key}
            data-state={state}
            data-open={open}
          >
            <button
              type="button"
              className="group-head"
              data-testid="wall-group-head"
              aria-expanded={open}
              aria-controls={`grid-${g.key}`}
              title={g.rig ? rigTitle(g.rig) : undefined}
              onClick={() => toggle(g)}
            >
              <span className="group-caret" aria-hidden="true">
                {open ? '▾' : '▸'}
              </span>
              <b data-testid="wall-group-name">{g.rig?.displayName ?? g.name}</b>
              <span>{g.where}</span>
              {g.asleep && <span>· asleep</span>}
              <span className="group-counts" data-testid="wall-group-counts">
                {statusCounts(g).map(({ pip, n }) => (
                  <span key={pip} className="group-count" data-pip={pip}>
                    <span className="pip-glyph">{PIP[pip].glyph}</span> {n} {PIP[pip].label}
                  </span>
                ))}
              </span>
              <i />
            </button>
            {g.rig?.summary && (
              <p className="group-summary" data-testid="wall-group-summary">
                {g.rig.summary}
              </p>
            )}
            {open && (
              <div className="grid" id={`grid-${g.key}`}>
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
            )}
          </section>
        );
      })}
    </main>
  );
}
