import type { AccountUsage, FleetMachine, QueueItem, Seat } from '@appydave/shared';
import { modelChip, pipFor, seatKey, seatName, type ModelFamily, type PipKey } from './model.js';

/**
 * Pure view-models for the v1.1 screens: Rig Map, Handoff Flow and Accounts. Like model.ts,
 * everything is a function of the fleet (and a time), so it is unit-tested directly.
 *
 * Edges come from the queue, not from a topology file: an edge is "A handed work to B", counted
 * from real queue rows. So the map shows who actually talks to whom, not who is allowed to.
 */

// ---------------------------------------------------------------- endpoints

/** A queue endpoint resolved to a seat on some machine, or left as a name we could not place. */
export interface Endpoint {
  /** seatKey when resolved, else `?/<raw>`. */
  key: string;
  raw: string;
  name: string;
  machineId: string | null;
  seat: Seat | null;
}

/**
 * `dev-qa@fliedit-team` is a seat id on the machine whose queue holds it. `openrig-orch@roamy` names
 * another machine: the seat `openrig-orch` there (a plain tmux session). Anything else stays unplaced.
 */
export function resolveEndpoint(raw: string, home: FleetMachine, all: FleetMachine[]): Endpoint {
  const own = home.snapshot.seats.find((s) => s.id === raw);
  if (own) return endpointOf(raw, home, own);
  const at = raw.lastIndexOf('@');
  if (at > 0) {
    const name = raw.slice(0, at);
    const where = raw.slice(at + 1);
    const fm = all.find((m) => m.machine.id === where);
    const seat = fm?.snapshot.seats.find((s) => s.id === name || s.id.split('@')[0] === name);
    if (fm && seat) return endpointOf(raw, fm, seat);
  }
  return { key: `?/${raw}`, raw, name: raw.split('@')[0] || raw, machineId: null, seat: null };
}

function endpointOf(raw: string, fm: FleetMachine, seat: Seat): Endpoint {
  return {
    key: seatKey(fm.machine.id, seat.id),
    raw,
    name: seatName(seat),
    machineId: fm.machine.id,
    seat,
  };
}

/**
 * Closed states. `handed-off` is closed too: the receiver passed the work on (a QA seat hands a
 * builder's item to review), so it is no longer waiting. Anything else (pending, in-progress,
 * blocked, a state OpenRig adds later) counts as open, so a new state never hides waiting work.
 */
const CLOSED = new Set([
  'done',
  'handed-off',
  'closed',
  'cancelled',
  'canceled',
  'rejected',
  'expired',
]);

/** Open = still in someone's inbox. */
export function isOpen(item: QueueItem): boolean {
  return !CLOSED.has(item.state);
}

// ---------------------------------------------------------------- rigs

export interface RigRef {
  key: string;
  machineId: string;
  machineLabel: string;
  name: string;
  status: string;
  seatCount: number;
  handoffs: number;
  lastActivity: string | null;
}

/** Every rig on every machine, most recent queue activity first (the run you most likely want). */
export function listRigs(machines: FleetMachine[]): RigRef[] {
  const out: RigRef[] = [];
  for (const fm of machines) {
    for (const rig of fm.snapshot.rigs) {
      const items = rigQueue(fm, rig.name);
      const last = items.reduce<string | null>(
        (acc, q) => (acc === null || q.updatedAt > acc ? q.updatedAt : acc),
        null
      );
      out.push({
        key: `${fm.machine.id}:${rig.name}`,
        machineId: fm.machine.id,
        machineLabel: fm.machine.label,
        name: rig.name,
        status: rig.status,
        seatCount: fm.snapshot.seats.filter((s) => s.rig === rig.name).length,
        handoffs: items.length,
        lastActivity: last,
      });
    }
  }
  const running = (r: RigRef) => (r.status === 'running' ? 0 : 1);
  return out.sort(
    (a, b) =>
      (b.handoffs > 0 ? 1 : 0) - (a.handoffs > 0 ? 1 : 0) ||
      (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '') ||
      running(a) - running(b) ||
      a.key.localeCompare(b.key)
  );
}

const suffix = (id: string | null) => (id ? id.slice(id.lastIndexOf('@') + 1) : '');

/** Queue rows that start or end inside this rig. */
export function rigQueue(fm: FleetMachine, rig: string): QueueItem[] {
  return fm.snapshot.queue.filter((q) => suffix(q.source) === rig || suffix(q.destination) === rig);
}

// ---------------------------------------------------------------- Rig Map

export interface MapSeat {
  key: string;
  name: string;
  model: { text: string; family: ModelFamily };
  pip: PipKey;
  open: number;
}

export interface MapPod {
  name: string;
  seats: MapSeat[];
}

export interface MapLane {
  machineId: string;
  label: string;
  liveness: FleetMachine['liveness'];
  subtitle: string;
  pods: MapPod[];
}

export interface MapEdge {
  from: string;
  to: string;
  count: number;
  open: number;
  /** A self-handoff (a seat queueing work to itself): drawn as a badge, not a line. */
  self: boolean;
}

export interface RigMap {
  rig: RigRef;
  lanes: MapLane[];
  edges: MapEdge[];
  handoffs: number;
}

const POD_ORDER = ['orch', 'lead', 'dev', 'build', 'qa', 'review', 'research'];
const podRank = (p: string) => {
  const i = POD_ORDER.indexOf(p);
  return i === -1 ? POD_ORDER.length : i;
};

function mapSeat(fm: FleetMachine, seat: Seat, open: number): MapSeat {
  return {
    key: seatKey(fm.machine.id, seat.id),
    name: seatName(seat),
    model: modelChip(seat),
    pip: pipFor(seat, fm),
    open,
  };
}

/**
 * One rig as lanes: its own machine first (pods as bands), then any other machine whose seats
 * exchanged queue items with it (e.g. Roamy's openrig-orch briefing the M2's lead).
 */
export function buildRigMap(machines: FleetMachine[], rigKey: string): RigMap | null {
  const rig = listRigs(machines).find((r) => r.key === rigKey);
  const home = machines.find((m) => m.machine.id === rig?.machineId);
  if (!rig || !home) return null;

  const items = rigQueue(home, rig.name);
  const openAt = new Map<string, number>();
  const edgeMap = new Map<string, MapEdge>();
  const outside = new Map<string, { fm: FleetMachine | null; ep: Endpoint }>();

  for (const q of items) {
    if (!q.source || !q.destination) continue;
    const from = resolveEndpoint(q.source, home, machines);
    const to = resolveEndpoint(q.destination, home, machines);
    for (const ep of [from, to]) {
      const inRig = ep.machineId === home.machine.id && ep.seat?.rig === rig.name;
      if (!inRig) {
        outside.set(ep.key, {
          fm: machines.find((m) => m.machine.id === ep.machineId) ?? null,
          ep,
        });
      }
    }
    const k = `${from.key}→${to.key}`;
    const e = edgeMap.get(k) ?? {
      from: from.key,
      to: to.key,
      count: 0,
      open: 0,
      self: from.key === to.key,
    };
    e.count += 1;
    if (isOpen(q)) {
      e.open += 1;
      openAt.set(to.key, (openAt.get(to.key) ?? 0) + 1);
    }
    edgeMap.set(k, e);
  }

  const pods = new Map<string, MapPod>();
  for (const seat of home.snapshot.seats.filter((s) => s.rig === rig.name)) {
    const pod = seat.pod ?? 'seats';
    const p = pods.get(pod) ?? { name: pod, seats: [] };
    p.seats.push(mapSeat(home, seat, openAt.get(seatKey(home.machine.id, seat.id)) ?? 0));
    pods.set(pod, p);
  }
  const lanes: MapLane[] = [
    {
      machineId: home.machine.id,
      label: home.machine.label,
      liveness: home.liveness,
      subtitle: `rig ${rig.name} · ${rig.status}`,
      pods: [...pods.values()].sort(
        (a, b) => podRank(a.name) - podRank(b.name) || a.name.localeCompare(b.name)
      ),
    },
  ];

  // Outside endpoints: grouped by their machine (or "not placed" when we cannot find them).
  const byMachine = new Map<string, MapLane>();
  for (const { fm, ep } of outside.values()) {
    const id = fm?.machine.id ?? '?';
    const sameMachine = id === home.machine.id;
    const laneKey = sameMachine ? `${id}:other` : id;
    let lane = byMachine.get(laneKey);
    if (!lane) {
      lane = {
        machineId: laneKey,
        label: fm
          ? sameMachine
            ? `${fm.machine.label} · other rigs`
            : fm.machine.label
          : 'Not placed',
        liveness: fm?.liveness ?? 'asleep',
        subtitle: fm ? 'talks to this rig' : 'queue names with no seat we can see',
        pods: [{ name: 'seats', seats: [] }],
      };
      byMachine.set(laneKey, lane);
    }
    lane.pods[0]!.seats.push(
      fm && ep.seat
        ? mapSeat(fm, ep.seat, openAt.get(ep.key) ?? 0)
        : {
            key: ep.key,
            name: ep.raw,
            model: { text: 'unplaced', family: 'other' },
            pip: 'unknown',
            open: openAt.get(ep.key) ?? 0,
          }
    );
  }
  lanes.push(...byMachine.values());

  return { rig, lanes, edges: [...edgeMap.values()], handoffs: items.length };
}

// ---------------------------------------------------------------- Handoff Flow

export type Stage = 'lead' | 'build' | 'qa' | 'review';
export const STAGES: Stage[] = ['lead', 'build', 'qa', 'review'];
export const STAGE_LABEL: Record<Stage, string> = {
  lead: 'Lead',
  build: 'Builders',
  qa: 'QA',
  review: 'Reviewer',
};

/** Role from the seat's name: the convention every rig so far follows (orch-lead, dev-qa, review-r1). */
export function stageOf(name: string): Stage {
  const n = name.toLowerCase();
  if (/(^|-)qa(-|$)|tester/.test(n)) return 'qa';
  if (/(^|-)review|(^|-)r\d+$/.test(n)) return 'review';
  if (/orch|lead|boss|operator|advisor|kernel/.test(n)) return 'lead';
  return 'build';
}

export interface FlowEdge {
  from: Stage;
  to: Stage;
  count: number;
  /** Items on this edge in flight at the replay time. */
  inFlight: QueueItem[];
  /** Going back to an earlier stage: a FAIL or a fix request. */
  rework: boolean;
}

export interface FlowStageView {
  stage: Stage;
  seats: { name: string; family: ModelFamily; model: string }[];
  /** Items waiting at this stage at the replay time. */
  waiting: number;
  oldestWaitMs: number | null;
}

export interface FlowView {
  start: number;
  end: number;
  at: number;
  stages: FlowStageView[];
  edges: FlowEdge[];
  total: number;
  rework: number;
  /** Median minutes from handoff to close, over closed items up to `at`. */
  medianTurnaroundMin: number | null;
  /** The stage holding the most waiting items at `at` (the queue), if any wait. */
  bottleneck: Stage | null;
}

const ms = (iso: string) => Date.parse(iso);

/** The time range of a rig's queue, for the replay scrubber. */
export function flowRange(items: QueueItem[]): { start: number; end: number } | null {
  if (!items.length) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const q of items) {
    start = Math.min(start, ms(q.createdAt));
    end = Math.max(end, ms(q.updatedAt));
  }
  return { start, end };
}

/**
 * The flow at time `at`: everything handed off up to then, and what was still open then. An item
 * is in flight from createdAt until updatedAt if it is done (updatedAt is when it closed), or
 * until now if it is still open.
 */
export function buildFlow(fm: FleetMachine, rig: string, at: number, now: number): FlowView | null {
  const items = rigQueue(fm, rig);
  const range = flowRange(items);
  if (!range) return null;
  const nameStage = (raw: string | null) => stageOf((raw ?? '').split('@')[0] ?? '');

  const edgeMap = new Map<string, FlowEdge>();
  const waiting = new Map<Stage, QueueItem[]>();
  const closedTurn: number[] = [];
  let total = 0;
  let rework = 0;

  for (const q of items) {
    const created = ms(q.createdAt);
    if (created > at) continue;
    total += 1;
    const from = nameStage(q.source);
    const to = nameStage(q.destination);
    const back = STAGES.indexOf(to) < STAGES.indexOf(from) && to !== 'lead';
    if (back) rework += 1;
    const k = `${from}→${to}`;
    const e = edgeMap.get(k) ?? { from, to, count: 0, inFlight: [], rework: back };
    e.count += 1;
    const closedAt = isOpen(q) ? now : ms(q.updatedAt);
    if (closedAt > at) {
      e.inFlight.push(q);
      waiting.set(to, [...(waiting.get(to) ?? []), q]);
    } else if (!isOpen(q)) {
      closedTurn.push((closedAt - created) / 60_000);
    }
    edgeMap.set(k, e);
  }

  const seatsBy = new Map<Stage, FlowStageView['seats']>();
  for (const s of fm.snapshot.seats.filter((x) => x.rig === rig)) {
    const st = stageOf(seatName(s));
    const chip = modelChip(s);
    seatsBy.set(st, [
      ...(seatsBy.get(st) ?? []),
      { name: seatName(s), family: chip.family, model: chip.text },
    ]);
  }

  const stages = STAGES.map((stage) => {
    const w = waiting.get(stage) ?? [];
    const oldest = w.reduce<number | null>((acc, q) => {
      const age = at - ms(q.createdAt);
      return acc === null || age > acc ? age : acc;
    }, null);
    return { stage, seats: seatsBy.get(stage) ?? [], waiting: w.length, oldestWaitMs: oldest };
  });
  const top = [...stages].sort((a, b) => b.waiting - a.waiting)[0];

  return {
    start: range.start,
    end: range.end,
    at,
    stages,
    edges: [...edgeMap.values()].filter((e) => e.from !== e.to),
    total,
    rework,
    medianTurnaroundMin: median(closedTurn),
    bottleneck: top && top.waiting > 0 ? top.stage : null,
  };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ---------------------------------------------------------------- Accounts

export interface AccountDrawer {
  machineLabel: string;
  seats: string[];
}

export interface AccountView {
  email: string;
  planLabel: string;
  /** The freshest reading across this account's machines, if any machine has a sampler. */
  reading: (AccountUsage & { from: string }) | null;
  machines: string[];
  drawers: AccountDrawer[];
  /** Live, non-stopped Claude seats drawing on it right now. */
  activeSeats: number;
}

const PLAN_LABEL: Record<string, string> = {
  claude_max: 'Max · tier not reported',
  claude_pro: 'Pro',
  claude_team: 'Team',
  claude_enterprise: 'Enterprise',
};

export function planLabel(plan: string | null): string {
  if (!plan) return 'plan unknown';
  return PLAN_LABEL[plan] ?? plan;
}

const isClaudeSeat = (s: Seat) => s.runtime === 'claude-code' || /^claude-/.test(s.model ?? '');

/**
 * Accounts across the fleet. A machine names its account; a seat draws on its machine's account
 * (OpenRig seats run as the machine's user). Readings come only from machines with a sampler; the
 * freshest one wins, because every machine on the account sees the same window.
 */
export interface UnreportedMachine {
  label: string;
  /** `old-collector`: the snapshot has no account field at all. `no-login`: it says no Claude login. */
  reason: 'old-collector' | 'no-login';
}

export function buildAccounts(machines: FleetMachine[]): {
  accounts: AccountView[];
  unknown: UnreportedMachine[];
} {
  const accounts = new Map<string, AccountView>();
  const unknown: UnreportedMachine[] = [];
  for (const fm of machines) {
    const acct = fm.snapshot.account;
    if (!acct?.email) {
      unknown.push({
        label: fm.machine.label,
        reason: acct === undefined ? 'old-collector' : 'no-login',
      });
      continue;
    }
    const v =
      accounts.get(acct.email) ??
      ({
        email: acct.email,
        planLabel: planLabel(acct.plan),
        reading: null,
        machines: [],
        drawers: [],
        activeSeats: 0,
      } satisfies AccountView);
    v.machines.push(fm.machine.label);
    if (acct.sampledAt && (!v.reading || acct.sampledAt > (v.reading.sampledAt ?? ''))) {
      v.reading = { ...acct, from: fm.machine.label };
    }
    if (fm.liveness === 'live') {
      const seats = fm.snapshot.seats.filter((s) => s.status !== 'stopped' && isClaudeSeat(s));
      if (seats.length) {
        v.drawers.push({ machineLabel: fm.machine.label, seats: seats.map(seatName) });
        v.activeSeats += seats.length;
      }
    }
    accounts.set(acct.email, v);
  }
  return {
    accounts: [...accounts.values()].sort((a, b) => a.email.localeCompare(b.email)),
    unknown,
  };
}

/** The account with the most 5-hour room among those with a reading; null if none can be compared. */
export function mostHeadroom(accounts: AccountView[]): AccountView | null {
  const read = accounts.filter((a) => a.reading?.fiveHourPct != null);
  if (!read.length) return null;
  return read.sort((a, b) => a.reading!.fiveHourPct! - b.reading!.fiveHourPct!)[0]!;
}

/** "in 2h 10m" / "now" for a reset time. */
export function resetsIn(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const m = Math.round((ms(iso) - now) / 60_000);
  if (m <= 0) return 'now';
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d >= 1) return `in ${d}d ${h % 24}h`;
  return h ? `in ${h}h ${m % 60}m` : `in ${m}m`;
}
