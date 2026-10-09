import { ASLEEP_AFTER_MS, type FleetMachine, type Seat, type SeatStatus } from '@appydave/shared';

/**
 * Pure view-model helpers for the Wall, Focus and Fleet Strip. No React, no socket: everything
 * here is a function of (fleet, now), so it is unit-tested directly.
 */

/** What a pip shows. `asleep` is not a Seat.status: it is the machine's liveness overriding it. */
export type PipKey = SeatStatus | 'asleep';

export const PIP: Record<PipKey, { glyph: string; label: string }> = {
  working: { glyph: '●', label: 'working' },
  idle: { glyph: '○', label: 'idle' },
  blocked: { glyph: '▲', label: 'blocked' },
  stopped: { glyph: '✕', label: 'stopped' },
  unknown: { glyph: '?', label: 'unknown' },
  asleep: { glyph: '◌', label: 'asleep' },
};

/**
 * D50: on an asleep machine every seat's pip reads "asleep", never its last-known status. The
 * last status could be "idle", and the plan's S2 proof is that nothing says idle while a machine
 * sleeps. The last-known status stays available (data-status, Focus side strip).
 */
export function pipFor(seat: Seat, machine: FleetMachine): PipKey {
  return machine.liveness === 'asleep' ? 'asleep' : seat.status;
}

export type FreshnessLevel = 'live' | 'stale' | 'asleep';

export interface Freshness {
  level: FreshnessLevel;
  label: string;
}

/** "4s", "3m", "2h", "5d". Negative ages (clock skew) read as 0s. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Freshness of a machine's feed. The hub owns liveness (it flips a machine to `asleep`); the
 * browser only adds `stale` when its own view is old: the hub has not flipped yet, or the hub
 * itself is unreachable. Stale is never shown as live.
 */
export function freshness(machine: FleetMachine, now: number, hubConnected: boolean): Freshness {
  const age = now - Date.parse(machine.lastSeen);
  if (machine.liveness === 'asleep') {
    return { level: 'asleep', label: `asleep · last seen ${ago(age)} ago` };
  }
  if (!hubConnected) return { level: 'stale', label: `stale · hub offline · ${ago(age)}` };
  if (age > ASLEEP_AFTER_MS) return { level: 'stale', label: `stale · ${ago(age)}` };
  return { level: 'live', label: `live · ${ago(age)}` };
}

/** `dev-build@starter` → `dev-build`. A plain tmux session name is returned as is. */
export function seatName(seat: Seat): string {
  return seat.id.split('@')[0] || seat.id;
}

/** Stable key across the fleet: seat ids are only unique within a machine. */
export function seatKey(machineId: string, seatId: string): string {
  return `${machineId}/${seatId}`;
}

export type ModelFamily = 'opus' | 'sonnet' | 'fable' | 'haiku' | 'codex' | 'other';

/**
 * Short chip text and colour family. Model is often null (the daemon does not always know it);
 * then the runtime stands in, so the chip never lies about a model it does not know.
 */
export function modelChip(seat: Seat): { text: string; family: ModelFamily } {
  const raw = seat.model;
  if (raw) {
    const m = /^claude-(opus|sonnet|fable|haiku)-(\d+)-(\d+)/.exec(raw);
    if (m) return { text: `${m[1]} ${m[2]}.${m[3]}`, family: m[1] as ModelFamily };
    if (/^(gpt|codex|o\d)/.test(raw)) return { text: raw, family: 'codex' };
    return { text: raw, family: 'other' };
  }
  const runtime = seat.runtime ?? 'unknown';
  return { text: runtime, family: runtime === 'codex' ? 'codex' : 'other' };
}

export type GroupBy = 'rig' | 'machine';

export interface TileRef {
  key: string;
  machine: FleetMachine;
  seat: Seat;
}

export interface WallGroup {
  key: string;
  name: string;
  where: string;
  asleep: boolean;
  tiles: TileRef[];
}

/** Machines in a stable order (by id), so the wall does not reshuffle as updates arrive. */
export function orderedMachines(machines: Record<string, FleetMachine>): FleetMachine[] {
  return Object.values(machines).sort((a, b) => a.machine.id.localeCompare(b.machine.id));
}

/**
 * Groups for the Wall. By rig, a rig name is scoped to its machine: `kernel` on Roamy and `kernel`
 * on the M2 are different rigs. Seats outside OpenRig group as "tmux sessions".
 */
export function groupSeats(machines: FleetMachine[], by: GroupBy): WallGroup[] {
  const groups: WallGroup[] = [];
  for (const fm of machines) {
    const asleep = fm.liveness === 'asleep';
    const seats = fm.snapshot.seats;
    if (by === 'machine') {
      groups.push({
        key: fm.machine.id,
        name: fm.machine.label,
        where: `${seats.length} seat${seats.length === 1 ? '' : 's'}`,
        asleep,
        tiles: seats.map((seat) => ({ key: seatKey(fm.machine.id, seat.id), machine: fm, seat })),
      });
      continue;
    }
    const byRig = new Map<string, WallGroup>();
    for (const seat of seats) {
      const rig = seat.rig ?? null;
      const key = `${fm.machine.id}:${rig ?? '~tmux'}`;
      let g = byRig.get(key);
      if (!g) {
        g = { key, name: rig ?? 'tmux sessions', where: fm.machine.label, asleep, tiles: [] };
        byRig.set(key, g);
        groups.push(g);
      }
      g.tiles.push({ key: seatKey(fm.machine.id, seat.id), machine: fm, seat });
    }
  }
  return groups;
}

export interface FleetCounts {
  seats: number;
  byStatus: Record<SeatStatus, number>;
  /** Seats on asleep machines: paused, not counted as working or idle. */
  paused: number;
}

export function countSeats(machines: FleetMachine[]): FleetCounts {
  const byStatus: Record<SeatStatus, number> = {
    working: 0,
    idle: 0,
    blocked: 0,
    stopped: 0,
    unknown: 0,
  };
  let seats = 0;
  let paused = 0;
  for (const fm of machines) {
    for (const seat of fm.snapshot.seats) {
      seats += 1;
      if (fm.liveness === 'asleep') paused += 1;
      else byStatus[seat.status] += 1;
    }
  }
  return { seats, byStatus, paused };
}

/** Blocked seats on live machines, the thing S1 has to surface in under 5 s. */
export function blockedSeats(machines: FleetMachine[]): TileRef[] {
  const out: TileRef[] = [];
  for (const fm of machines) {
    if (fm.liveness === 'asleep') continue;
    for (const seat of fm.snapshot.seats) {
      if (seat.status === 'blocked') {
        out.push({ key: seatKey(fm.machine.id, seat.id), machine: fm, seat });
      }
    }
  }
  return out;
}

export function findSeat(machines: Record<string, FleetMachine>, key: string): TileRef | null {
  const slash = key.indexOf('/');
  const fm = machines[key.slice(0, slash)];
  const seat = fm?.snapshot.seats.find((s) => s.id === key.slice(slash + 1));
  return fm && seat ? { key, machine: fm, seat } : null;
}

/** Plain-words reason for a blocked seat, best source first. */
export function blockedBecause(seat: Seat): string {
  return seat.blockedReason ?? seat.activity?.needsInputReason ?? 'needs input (no reason given)';
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export function stripAnsi(line: string): string {
  return line.replace(ANSI, '');
}

/** Drop trailing blank lines (panes are mostly padding at the bottom), then keep the last `n`. */
export function visibleTail(lines: string[], n: number): string[] {
  let end = lines.length;
  while (end > 0 && stripAnsi(lines[end - 1]).trim() === '') end -= 1;
  return lines.slice(Math.max(0, end - n), end);
}
