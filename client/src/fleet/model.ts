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

/** S3: what a Wall group is doing as a whole, which decides its place and whether it starts open. */
export type GroupState = 'blocked' | 'working' | 'idle' | 'unknown' | 'stopped' | 'asleep';

export const GROUP_STATES: GroupState[] = [
  'blocked',
  'working',
  'idle',
  'unknown',
  'stopped',
  'asleep',
];

/** Stated on screen above the Wall (S3: "the sort order is stated on screen"). */
export const WALL_ORDER_TEXT =
  'Order: blocked → working → idle → state unknown → stopped → asleep machine · newest activity first within each · stopped and asleep start collapsed';

export function groupState(g: WallGroup): GroupState {
  if (g.asleep) return 'asleep';
  const has = (st: SeatStatus) => g.tiles.some((t) => t.seat.status === st);
  if (has('blocked')) return 'blocked';
  if (has('working')) return 'working';
  if (has('idle')) return 'idle';
  if (has('unknown')) return 'unknown';
  return 'stopped';
}

/** Collapsed until the viewer opens it: nothing is happening in a stopped or asleep group. */
export function collapsedByDefault(g: WallGroup): boolean {
  const st = groupState(g);
  return st === 'stopped' || st === 'asleep';
}

/** Latest lastActivityAt of any seat in the group, as an ISO string ('' when none reported). */
export function groupLastActivity(g: WallGroup): string {
  return g.tiles.reduce((acc, t) => {
    const at = t.seat.lastActivityAt ?? '';
    return at > acc ? at : acc;
  }, '');
}

/** Machines in a stable order (by id), so the wall does not reshuffle as updates arrive. */
export function orderedMachines(machines: Record<string, FleetMachine>): FleetMachine[] {
  return Object.values(machines).sort((a, b) => a.machine.id.localeCompare(b.machine.id));
}

/**
 * D53 + v1.4 S3: what needs eyes comes first, then what is running. Blocked, working, idle, state
 * unknown (plain tmux), all stopped, then asleep machines. Ties: newest activity first, then stable.
 */
export function groupRank(g: WallGroup): number {
  return GROUP_STATES.indexOf(groupState(g));
}

/**
 * Groups for the Wall, ranked by groupRank. By rig, a rig name is scoped to its machine: `kernel`
 * on Roamy and `kernel` on the M2 are different rigs. Seats outside OpenRig group as "tmux sessions".
 */
export function groupSeats(machines: FleetMachine[], by: GroupBy): WallGroup[] {
  return collectGroups(machines, by)
    .map((g) => ({ g, rank: groupRank(g), last: groupLastActivity(g) }))
    .sort((a, b) => a.rank - b.rank || b.last.localeCompare(a.last))
    .map((x) => x.g);
}

function collectGroups(machines: FleetMachine[], by: GroupBy): WallGroup[] {
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

/**
 * S4: the question the terminal is showing, when the collector found it ("Allow this read outside
 * the working directories?"). Optional in the contract; blank or missing reads as none.
 */
export function blockedDetail(seat: Seat): string | null {
  // r1 L2: plain text only, whatever the collector sends: escape sequences out, then any stray
  // control byte (a lone ESC, BEL, CR…) becomes a space.
  // eslint-disable-next-line no-control-regex
  const text = stripAnsi(seat.blockedDetail ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ');
  return text.replace(/\s+/g, ' ').trim() || null;
}

/** "permission prompt — Allow this read outside the working directories?" (reason alone if no detail). */
export function blockedLine(seat: Seat): string {
  const detail = blockedDetail(seat);
  return detail ? `${blockedBecause(seat)} — ${detail}` : blockedBecause(seat);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/**
 * Every OSC sequence: ESC ] … (BEL | ESC \\). That covers OSC 8 hyperlinks (r1 L1: the link text
 * stays, the link goes) and OSC 52 clipboard writes (qa-backend: a pane must never reach the
 * viewer's clipboard), plus titles and the rest. Applied before ANSI → HTML on tiles and before
 * writing to the Focus terminal, so neither renderer ever sees one.
 */
// eslint-disable-next-line no-control-regex
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export function stripOsc(text: string): string {
  return text.replace(OSC, '');
}

export function stripAnsi(line: string): string {
  return line.replace(ANSI, '');
}

/** Drop trailing blank lines (panes are mostly padding at the bottom), then keep the last `n`. */
export function visibleTail(lines: string[], n: number): string[] {
  let end = lines.length;
  while (end > 0 && stripAnsi(lines[end - 1]).trim() === '') end -= 1;
  return lines.slice(Math.max(0, end - n), end);
}
