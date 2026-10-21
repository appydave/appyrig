import type { FleetMachine, Seat } from '@appydave/shared';
import { agentActivityOf, groupSeats, groupState, pipFor, type WallGroup } from '../fleet/model.js';
import { tailLine } from '../fleet/terminal.js';

/** C22: the three "look here" filters, in AppyRig's own status words. */
export type WallFilter = 'all' | 'needs' | 'stuck' | 'failing';

/** A seat with work waiting that has done nothing for this long is "stuck". */
export const STUCK_AFTER_MS = 10 * 60_000;

export interface SeatFlags {
  /** Blocked on a person: a permission prompt or a question. */
  needs: boolean;
  /** Up, but OpenRig flags it for attention, or it has a blocked item, or work waits and its agent has been quiet for STUCK_AFTER_MS. */
  stuck: boolean;
  /** Stopped while its rig is running, or stopped and flagged by OpenRig. */
  failing: boolean;
}

export function seatFlags(seat: Seat, fm: FleetMachine, now: number): SeatFlags {
  if (fm.liveness === 'asleep') {
    return { needs: false, stuck: false, failing: false };
  }
  const pip = pipFor(seat, fm);
  const rig = seat.rig ? fm.snapshot.rigs.find((r) => r.name === seat.rig) : undefined;
  const attention = seat.lifecycleState === 'attention_required';
  // Failing is a seat that is down (stopped while its rig runs, or stopped and flagged by OpenRig).
  // A running seat OpenRig flags for attention is "stuck": it is up but needs a look.
  const failing = seat.status === 'stopped' && (attention || rig?.status === 'running');
  const open = seat.work.pending + seat.work.inProgress + seat.work.blocked;
  const at = agentActivityOf(seat);
  const quiet = at ? now - Date.parse(at) > STUCK_AFTER_MS : false;
  const stuck =
    pip !== 'blocked' &&
    pip !== 'stopped' &&
    (attention || seat.work.blocked > 0 || (pip !== 'working' && open > 0 && quiet));

  return { needs: pip === 'blocked', stuck, failing };
}

const matches = (f: WallFilter, flags: SeatFlags) =>
  f === 'all' ||
  (f === 'needs' && flags.needs) ||
  (f === 'stuck' && flags.stuck) ||
  (f === 'failing' && flags.failing);

export interface Team {
  key: string;
  name: string;
  where: string;
  machineId: string;
  seats: number;
  running: boolean;
}

/** walk #10: what the compact team button says ("Teams: all", "Teams: 18 of 25 · 7 hidden"). */
export function teamsLabel(teams: Team[], hidden: ReadonlySet<string>): string {
  const off = teams.filter((t) => hidden.has(t.key)).length;

  return off === 0
    ? 'Teams: all'
    : `Teams: ${teams.length - off} of ${teams.length} · ${off} hidden`;
}

/** The teams a search matches, by name or machine. */
export function matchTeams(teams: Team[], q: string): Team[] {
  const w = q.trim().toLowerCase();

  return w
    ? teams.filter((t) => t.name.toLowerCase().includes(w) || t.where.toLowerCase().includes(w))
    : teams;
}

/** The teams (rigs, per machine) the picker offers, in the Wall's own order. */
export function teamsOf(machines: FleetMachine[]): Team[] {
  return groupSeats(machines, 'rig').map((g) => ({
    key: g.key,
    name: g.rig?.displayName ?? g.name,
    where: g.where,
    machineId: g.tiles[0]?.machine.machine.id ?? '',
    seats: g.tiles.length,
    // A rig running; for plain tmux sessions (no rig), any session that is up.
    running: g.rig ? g.rig.status === 'running' : g.tiles.some((t) => t.seat.status !== 'stopped'),
  }));
}

const teamKeyOf = (fm: FleetMachine, seat: Seat) => `${fm.machine.id}:${seat.rig ?? '~tmux'}`;

export interface WallScope {
  hideStopped: boolean;
  /** Team keys the viewer switched off. */
  hiddenTeams: ReadonlySet<string>;
  filter: WallFilter;
}

export interface WallView {
  machines: FleetMachine[];
  /** Counts over the seats that pass the team and stopped choices (so the chips never read 0 because one is on). */
  counts: { all: number; needs: number; stuck: number; failing: number };
  stoppedHidden: number;
}

/** Seats the v2 Wall draws: team picker, Hide stopped, then the status filter. A machine left with no seats is dropped. */
export function wallView(machines: FleetMachine[], scope: WallScope, now: number): WallView {
  const counts = { all: 0, needs: 0, stuck: 0, failing: 0 };
  let stoppedHidden = 0;
  const out: FleetMachine[] = [];
  for (const fm of machines) {
    const kept: Seat[] = [];
    for (const seat of fm.snapshot.seats) {
      if (scope.hiddenTeams.has(teamKeyOf(fm, seat))) {
        continue;
      }
      const flags = seatFlags(seat, fm, now);
      // Hide stopped never hides a failing seat: a seat that is down while its rig runs is the news.
      if (scope.hideStopped && pipFor(seat, fm) === 'stopped' && !flags.failing) {
        stoppedHidden += 1;
        continue;
      }
      counts.all += 1;
      if (flags.needs) {
        counts.needs += 1;
      }
      if (flags.stuck) {
        counts.stuck += 1;
      }
      if (flags.failing) {
        counts.failing += 1;
      }
      if (matches(scope.filter, flags)) {
        kept.push(seat);
      }
    }
    if (kept.length > 0) {
      out.push({ ...fm, snapshot: { ...fm.snapshot, seats: kept } });
    }
  }

  return { machines: out, counts, stoppedHidden };
}

/**
 * One clean line for a wall card's tail. A tmux capture can start in the middle of a word or after
 * a half-cut bracket ("ernel] specs"), and can hold box-drawing. Those fragments are dropped, runs of
 * spaces are collapsed, a long line is cut at a whole word, and a line with nothing readable becomes
 * an em dash. The card still clips to its one line.
 */
export function wallTail(lines: readonly string[] | null | undefined): string {
  const raw = tailLine(lines);
  if (!raw) {
    return '\u2014';
  }
  let s = raw
    .replace(/[\u2500-\u259f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // a capture cut in the middle: a short fragment closed by a bracket that was never opened
  const cut = /^([^[\](){}]{1,14})[\])}]\s*/.exec(s);
  if (cut) {
    s = s.slice(cut[0].length);
  }
  if (!/[A-Za-z0-9]{2,}/.test(s)) {
    return '\u2014';
  }
  if (s.length > 120) {
    s = `${s.slice(0, 120).replace(/\s+\S*$/, '')}\u2026`;
  }

  return s;
}

export interface MachineGroups {
  machineId: string;
  groups: WallGroup[];
}

/**
 * The Wall's default order, the same as the Rigs drawer: machines in the drawer's order, and inside
 * each machine its running rigs (in the drawer's rig order), then its plain tmux sessions ("No rig"),
 * then its stopped rigs. A machine with no group left is dropped.
 */
export function orderByMachine(
  groups: WallGroup[],
  machineOrder: string[],
  rigOrder: string[]
): MachineGroups[] {
  const rigIndex = new Map(rigOrder.map((k, i) => [k, i]));
  const byKey = (a: WallGroup, b: WallGroup) =>
    (rigIndex.get(a.key) ?? 1e6) - (rigIndex.get(b.key) ?? 1e6) || a.name.localeCompare(b.name);
  const dead = (g: WallGroup) => ['stopped', 'asleep'].includes(groupState(g));
  const machineOf = (g: WallGroup) => g.tiles[0]?.machine.machine.id ?? '';
  const ids = [
    ...machineOrder,
    ...groups.map(machineOf).filter((id) => !machineOrder.includes(id)),
  ];

  return [...new Set(ids)]
    .map((machineId) => {
      const mine = groups.filter((g) => machineOf(g) === machineId);

      return {
        machineId,
        groups: [
          ...mine.filter((g) => g.rig && !dead(g)).sort(byKey),
          ...mine.filter((g) => !g.rig && !dead(g)),
          ...mine.filter((g) => dead(g)).sort(byKey),
        ],
      };
    })
    .filter((m) => m.groups.length > 0);
}

/** "M4 · 31 seats · 4 idle · 7 unknown · 20 stopped": the counts a machine heading shows. */
export function machineCounts(label: string, groups: WallGroup[]): string {
  const n = new Map<string, number>();
  let seats = 0;
  for (const g of groups) {
    for (const t of g.tiles) {
      seats += 1;
      const pip = pipFor(t.seat, t.machine);
      n.set(pip, (n.get(pip) ?? 0) + 1);
    }
  }
  const order = ['blocked', 'working', 'idle', 'unknown', 'stopped', 'asleep'];

  return [
    label,
    `${seats} seats`,
    ...order.filter((p) => n.has(p)).map((p) => `${n.get(p)} ${p}`),
  ].join(' · ');
}

export interface CardBody {
  /** The last thing typed at the prompt (V1's prompt line), without the \u276f. */
  lastTyped: string | null;
  folder: string | null;
  branch: string | null;
  /** One cleaned terminal line, for a card with no prompt line to show. */
  fallback: string[];
}

const clean = (l: string) =>
  l
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b?\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\u2500-\u259f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * What a Wall card shows from a seat's terminal: the last thing typed (the last line that is a
 * prompt with text after it), the folder and branch from the status line under it, and when there is
 * no prompt line one cleaned fallback line. Raw tails full of "Update installed" or "/rc failed" are
 * not shown once a real prompt line exists.
 */
export function cardBody(seat: Seat): CardBody {
  const lines = (seat.tail?.lines ?? []).map(clean).filter(Boolean);
  let lastTyped: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^[\u276f\u203a>]\s+(.{2,})$/.exec(lines[i]!);
    if (m) {
      lastTyped = m[1]!;
      break;
    }
  }
  let folder: string | null = null;
  let branch: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    // a status line like "~/dev/ad/brains (main) ✗": a real folder, then a branch name in brackets
    const m =
      /((?:~\/|\/(?:Users|home|dev|private|opt|tmp|var)\/)[^\s|()]*)\s+\(([A-Za-z0-9._/-]{1,60})\)/.exec(
        lines[i]!
      );
    if (m) {
      folder = m[1]!;
      branch = m[2]!;
      break;
    }
  }
  if (!folder && seat.cwd) {
    folder = seat.cwd.replace(/^\/Users\/[^/]+/, '~');
  }
  const fb = wallTail(seat.tail?.lines);

  return { lastTyped, folder, branch, fallback: lastTyped || fb === '\u2014' ? [] : [fb] };
}
