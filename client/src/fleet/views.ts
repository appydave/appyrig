import type {
  AccountDerived,
  AccountUsage,
  FleetMachine,
  QueueItem,
  Seat,
  SeatHistoryEvent,
} from '@appydave/shared';
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

/**
 * Batch 1 · B2 (fb-0001): one state per rig, readable at a glance on its chip, with a glyph and a
 * word as well as a colour. It follows `rig ps`: STATUS running/stopped, ATTN, and ACTIVE (working).
 */
export type RigState = 'attention' | 'working' | 'idle' | 'stopped' | 'asleep';

export const RIG_STATE: Record<RigState, { glyph: string; label: string }> = {
  attention: { glyph: '▲', label: 'needs attention' },
  working: { glyph: '●', label: 'working' },
  idle: { glyph: '○', label: 'idle' },
  stopped: { glyph: '✕', label: 'stopped' },
  asleep: { glyph: '◌', label: 'machine asleep' },
};

/** asleep machine > stopped > a seat blocked or OpenRig's attention count > a seat working > idle. */
export function rigState(
  liveness: string,
  status: string,
  attentionCount: number,
  seatPips: PipKey[]
): RigState {
  if (liveness === 'asleep') return 'asleep';
  if (status !== 'running') return 'stopped';
  if (attentionCount > 0 || seatPips.includes('blocked')) return 'attention';
  if (seatPips.includes('working')) return 'working';
  return 'idle';
}

export interface RigRef {
  key: string;
  machineId: string;
  machineLabel: string;
  name: string;
  status: string;
  /** B2: the state its chip shows (see rigState). */
  state: RigState;
  seatCount: number;
  handoffs: number;
  lastActivity: string | null;
  /** S3: from AppyRig's config (hub-set) and the rig's rig.yaml (collector-set); see RigSummary. */
  displayName?: string;
  owner?: string;
  summary?: string | null;
  specPath?: string | null;
  /** Absent = the collector did not look (older collector), never "not found". */
  specStatus?: 'found' | 'not-found';
}

/** Every rig on every machine: running first, then the most recent sign of life (a queue row or a seat). */
export function listRigs(machines: FleetMachine[]): RigRef[] {
  const out: RigRef[] = [];
  for (const fm of machines) {
    for (const rig of fm.snapshot.rigs) {
      const items = rigQueue(fm, rig.name);
      const seats = fm.snapshot.seats.filter((s) => s.rig === rig.name);
      // Most recent sign of life: a queue row moving, or any of its seats doing something.
      const last = [...items.map((q) => q.updatedAt), ...seats.map((s) => s.lastActivityAt)].reduce<
        string | null
      >((acc, at) => (at && (acc === null || at > acc) ? at : acc), null);
      out.push({
        key: `${fm.machine.id}:${rig.name}`,
        machineId: fm.machine.id,
        machineLabel: fm.machine.label,
        name: rig.name,
        status: rig.status,
        state: rigState(
          fm.liveness,
          rig.status,
          rig.attentionCount,
          seats.map((s) => pipFor(s, fm))
        ),
        seatCount: seats.length,
        handoffs: items.length,
        // The collector's recentAt is the same rule computed over the full queue; prefer it.
        lastActivity: rig.recentAt !== undefined ? rig.recentAt : last,
        displayName: rig.displayName,
        owner: rig.owner,
        summary: rig.summary,
        specPath: rig.specPath,
        specStatus: rig.specStatus,
      });
    }
  }
  // S3: every rig list reads running first, then most recent (Wall groups, Map and Flow chips).
  const running = (r: RigRef) => (r.status === 'running' ? 0 : 1);
  return out.sort(
    (a, b) =>
      running(a) - running(b) ||
      (b.lastActivity ?? '').localeCompare(a.lastActivity ?? '') ||
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
  /** Open items addressed to this seat, handed over less than STALE_MS ago. */
  open: number;
  /** Open items older than STALE_MS: left behind, not waiting in a live queue. */
  stale: number;
  oldestStaleMs: number | null;
  /** v1.5 · L1: the seat's skillCount for the pill (null: none; undefined: not reported). */
  skills?: number | null;
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
  /** Open and fresh: amber. */
  open: number;
  /** Open but older than STALE_MS: drawn dashed, not amber. */
  stale: number;
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

interface OpenCount {
  open: number;
  stale: number;
  oldestStaleMs: number | null;
}
const NONE: OpenCount = { open: 0, stale: 0, oldestStaleMs: null };

function mapSeat(fm: FleetMachine, seat: Seat, c: OpenCount): MapSeat {
  return {
    key: seatKey(fm.machine.id, seat.id),
    name: seatName(seat),
    model: modelChip(seat),
    pip: pipFor(seat, fm),
    skills: seat.skillCount,
    ...c,
  };
}

/**
 * One rig as lanes: its own machine first (pods as bands), then any other machine whose seats
 * exchanged queue items with it (e.g. Roamy's openrig-orch briefing the M2's lead).
 */
export function buildRigMap(
  machines: FleetMachine[],
  rigKey: string,
  now: number = Date.now()
): RigMap | null {
  const rig = listRigs(machines).find((r) => r.key === rigKey);
  const home = machines.find((m) => m.machine.id === rig?.machineId);
  if (!rig || !home) return null;

  const items = rigQueue(home, rig.name);
  const openAt = new Map<string, OpenCount>();
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
      stale: 0,
      self: from.key === to.key,
    };
    e.count += 1;
    if (isOpen(q)) {
      const age = now - ms(q.createdAt);
      const c = { ...(openAt.get(to.key) ?? NONE) };
      if (age > STALE_MS) {
        e.stale += 1;
        c.stale += 1;
        c.oldestStaleMs = Math.max(c.oldestStaleMs ?? 0, age);
      } else {
        e.open += 1;
        c.open += 1;
      }
      openAt.set(to.key, c);
    }
    edgeMap.set(k, e);
  }

  const pods = new Map<string, MapPod>();
  for (const seat of home.snapshot.seats.filter((s) => s.rig === rig.name)) {
    const pod = seat.pod ?? 'seats';
    const p = pods.get(pod) ?? { name: pod, seats: [] };
    p.seats.push(mapSeat(home, seat, openAt.get(seatKey(home.machine.id, seat.id)) ?? NONE));
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
        ? mapSeat(fm, ep.seat, openAt.get(ep.key) ?? NONE)
        : {
            key: ep.key,
            name: ep.raw,
            model: { text: 'unplaced', family: 'other' },
            pip: 'unknown',
            ...(openAt.get(ep.key) ?? NONE),
          }
    );
  }
  lanes.push(...byMachine.values());

  return { rig, lanes, edges: [...edgeMap.values()], handoffs: items.length };
}

// ---------------------------------------------------------------- Handoff Flow

/** An open item older than this is stale: left behind, not a queue building up. */
export const STALE_MS = 2 * 60 * 60 * 1000;

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

/**
 * `roles`: a build team (it has a QA or review seat) flows through the four role stages.
 * `seats`: any other team (research-scout → research-checker, the kernel's advisor and operators)
 * gets one box per seat, so nothing is squashed into "Builders".
 */
export type FlowMode = 'roles' | 'seats';

export function flowModeOf(names: string[]): FlowMode {
  return names.some((n) => ['qa', 'review'].includes(stageOf(n))) ? 'roles' : 'seats';
}

/** Seat mode shows at most this many boxes; the quietest endpoints share one "others" box. */
const MAX_SEAT_BOXES = 6;

export interface FlowEdge {
  /** Node ids: a Stage in roles mode, a seat name in seats mode. */
  from: string;
  to: string;
  count: number;
  /** Items on this edge in flight at the replay time. */
  inFlight: QueueItem[];
  /** S4: every item counted on this edge up to the replay time, oldest first. */
  items: QueueItem[];
  /**
   * Sent back to an earlier stage other than the Lead (roles mode only): rework, but also verdicts
   * (PASS too) and answers. The name is historical; the UI calls it "sent back" (legend, glossary).
   */
  rework: boolean;
}

export interface FlowStageView {
  /** Node id: a Stage in roles mode, a seat name in seats mode. */
  stage: string;
  label: string;
  seats: { name: string; family: ModelFamily; model: string }[];
  /** True for a seats-mode box that is not in this rig (another rig or machine). */
  outside: boolean;
  /** Items waiting here at the replay time, handed over less than STALE_MS before it. */
  waiting: number;
  oldestWaitMs: number | null;
  /** Items still open but older than STALE_MS: forgotten, not queued. */
  stale: number;
  oldestStaleMs: number | null;
}

export interface FlowView {
  mode: FlowMode;
  start: number;
  end: number;
  at: number;
  stages: FlowStageView[];
  edges: FlowEdge[];
  total: number;
  /** Items sent back (see FlowEdge.rework), not only FAILs. */
  rework: number;
  /** Median minutes from handoff to close, over closed items up to `at`. */
  medianTurnaroundMin: number | null;
  /** The node holding the most fresh waiting items at `at` (the queue), if any. Stale items never count. */
  bottleneck: string | null;
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

const bare = (raw: string | null) => (raw ?? '').split('@')[0] ?? '';

/**
 * The flow at time `at`: everything handed off up to then, and what was still open then. An item
 * is in flight from createdAt until updatedAt if it is done (updatedAt is when it closed), or
 * until now if it is still open.
 */
export function buildFlow(fm: FleetMachine, rig: string, at: number, now: number): FlowView | null {
  const items = rigQueue(fm, rig);
  const range = flowRange(items);
  if (!range) return null;
  const rigSeats = fm.snapshot.seats.filter((x) => x.rig === rig);
  const inRig = (raw: string | null) => suffix(raw) === rig;
  const mode = flowModeOf([
    ...rigSeats.map(seatName),
    ...items.flatMap((q) => [q.source, q.destination].filter(inRig).map(bare)),
  ]);

  // Seats mode: one node per endpoint, in the order each first handed work on; the overflow
  // shares an "others" node.
  const seatOrder: string[] = [];
  const nodeOfRaw = (raw: string | null) => (inRig(raw) ? bare(raw) : (raw ?? '?'));
  if (mode === 'seats') {
    const counts = new Map<string, number>();
    for (const q of [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      for (const raw of [q.source, q.destination]) {
        const id = nodeOfRaw(raw);
        if (!counts.has(id)) seatOrder.push(id);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    for (const s of rigSeats) if (!counts.has(seatName(s))) seatOrder.push(seatName(s));
    if (seatOrder.length > MAX_SEAT_BOXES) {
      const keep = new Set(
        [...seatOrder]
          .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
          .slice(0, MAX_SEAT_BOXES - 1)
      );
      const kept = seatOrder.filter((id) => keep.has(id));
      seatOrder.length = 0;
      seatOrder.push(...kept, 'others');
    }
  }
  const nodeOf = (raw: string | null): string => {
    if (mode === 'roles') return stageOf(bare(raw));
    const id = nodeOfRaw(raw);
    return seatOrder.includes(id) ? id : 'others';
  };
  const order: string[] = mode === 'roles' ? STAGES : seatOrder;

  const edgeMap = new Map<string, FlowEdge>();
  const waiting = new Map<string, QueueItem[]>();
  const stale = new Map<string, QueueItem[]>();
  const closedTurn: number[] = [];
  let total = 0;
  let rework = 0;

  for (const q of items) {
    const created = ms(q.createdAt);
    if (created > at) continue;
    total += 1;
    const from = nodeOf(q.source);
    const to = nodeOf(q.destination);
    const back = mode === 'roles' && order.indexOf(to) < order.indexOf(from) && to !== 'lead';
    if (back) rework += 1;
    const k = `${from}→${to}`;
    const e = edgeMap.get(k) ?? { from, to, count: 0, inFlight: [], items: [], rework: back };
    e.count += 1;
    e.items.push(q);
    const closedAt = isOpen(q) ? now : ms(q.updatedAt);
    // Still open = still in flight, even when the replay time is "now".
    if (isOpen(q) || closedAt > at) {
      e.inFlight.push(q);
      const bucket = at - created > STALE_MS ? stale : waiting;
      bucket.set(to, [...(bucket.get(to) ?? []), q]);
    } else if (!isOpen(q)) {
      closedTurn.push((closedAt - created) / 60_000);
    }
    edgeMap.set(k, e);
  }

  const seatsBy = new Map<string, FlowStageView['seats']>();
  for (const s of rigSeats) {
    const id = mode === 'roles' ? stageOf(seatName(s)) : nodeOf(`${seatName(s)}@${rig}`);
    const chip = modelChip(s);
    seatsBy.set(id, [
      ...(seatsBy.get(id) ?? []),
      { name: seatName(s), family: chip.family, model: chip.text },
    ]);
  }

  const oldest = (list: QueueItem[]) =>
    list.reduce<number | null>((acc, q) => {
      const age = at - ms(q.createdAt);
      return acc === null || age > acc ? age : acc;
    }, null);

  const stages: FlowStageView[] = order.map((id) => {
    const w = waiting.get(id) ?? [];
    const st = stale.get(id) ?? [];
    return {
      stage: id,
      label: mode === 'roles' ? STAGE_LABEL[id as Stage] : id,
      seats: seatsBy.get(id) ?? [],
      outside: mode === 'seats' && id !== 'others' && !rigSeats.some((s) => seatName(s) === id),
      waiting: w.length,
      oldestWaitMs: oldest(w),
      stale: st.length,
      oldestStaleMs: oldest(st),
    };
  });
  const top = [...stages].sort((a, b) => b.waiting - a.waiting)[0];

  return {
    mode,
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

// ---------------------------------------------------------------- replay chapters

export interface Chapter {
  at: number;
  kind: 'start' | 'first-rework' | 'peak' | 'longest-wait' | 'end';
  title: string;
  text: string;
}

const hhmm = (t: number) =>
  new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * The moments worth pausing on in a run, found from the queue alone so any rig gets them:
 * the first handoff, the first item sent back, the biggest fresh queue, the longest real wait, the end.
 */
export function flowChapters(fm: FleetMachine, rig: string, now: number): Chapter[] {
  const items = [...rigQueue(fm, rig)].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const range = flowRange(items);
  if (!range) return [];
  const label = (flow: FlowView, id: string) =>
    flow.stages.find((s) => s.stage === id)?.label ?? id;
  const out: Chapter[] = [];

  const first = items[0]!;
  out.push({
    at: ms(first.createdAt),
    kind: 'start',
    title: 'The run starts',
    text: `${hhmm(ms(first.createdAt))} · ${bare(first.source)} hands the first item to ${bare(first.destination)}.`,
  });

  let reworkSeen = false;
  let peak: { at: number; n: number; where: string; flow: FlowView } | null = null;
  for (const q of items) {
    const t = ms(q.createdAt);
    const flow = buildFlow(fm, rig, t, now)!;
    if (!reworkSeen && flow.rework > 0) {
      reworkSeen = true;
      out.push({
        at: t,
        kind: 'first-rework',
        title: 'First sent back',
        text: `${hhmm(t)} · ${bare(q.source)} sends an item back to ${bare(q.destination)}: a verdict, an answer or rework.`,
      });
    }
    const top = [...flow.stages].sort((a, b) => b.waiting - a.waiting)[0];
    if (top && top.waiting > (peak?.n ?? 1))
      peak = { at: t, n: top.waiting, where: top.stage, flow };
  }
  if (peak) {
    out.push({
      at: peak.at,
      kind: 'peak',
      title: 'Biggest queue',
      text: `${hhmm(peak.at)} · ${peak.n} items waiting at ${label(peak.flow, peak.where)} at once. This is where the run slowed down.`,
    });
  }

  // The longest wait that was real work (closed, and under the stale cut-off).
  const waits = items
    .filter((q) => !isOpen(q))
    .map((q) => ({ q, w: ms(q.updatedAt) - ms(q.createdAt) }))
    .filter((x) => x.w <= STALE_MS)
    .sort((a, b) => b.w - a.w);
  const longest = waits[0];
  if (longest && longest.w >= 5 * 60_000) {
    const mins = Math.round(longest.w / 60_000);
    out.push({
      at: ms(longest.q.createdAt),
      kind: 'longest-wait',
      title: 'Longest wait',
      text: `${hhmm(ms(longest.q.createdAt))} · an item for ${bare(longest.q.destination)} waits ${mins} min before it is closed.`,
    });
  }

  const endFlow = buildFlow(fm, rig, range.end, now)!;
  out.push({
    at: range.end,
    kind: 'end',
    title: 'Where it ended',
    text: `${hhmm(range.end)} · ${endFlow.total} handoffs${endFlow.mode === 'roles' ? `, ${endFlow.rework} sent back` : ''}.`,
  });
  return out.sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------- replay consoles

export type ConsoleKind = 'sent' | 'received' | SeatHistoryEvent['kind'];

export interface ConsoleLine {
  at: string;
  kind: ConsoleKind;
  text: string;
}

/**
 * One seat's console at replay time `at`: the handoffs it sent and received (always there: the queue
 * carries every handoff's message) merged with its transcript events (prompts, replies, tool calls)
 * when the collector sent its history. Oldest first, nothing after `at`.
 */
export function consoleLines(
  seatName: string,
  rig: string,
  items: QueueItem[],
  history: SeatHistoryEvent[] | null,
  at: number
): ConsoleLine[] {
  const me = (raw: string | null) => raw === `${seatName}@${rig}` || bare(raw) === seatName;
  const lines: ConsoleLine[] = [];
  for (const q of items) {
    if (ms(q.createdAt) > at) continue;
    const msg = q.summary ?? '(no message)';
    if (me(q.source) && !me(q.destination)) {
      lines.push({ at: q.createdAt, kind: 'sent', text: `→ ${bare(q.destination)}: ${msg}` });
    } else if (me(q.destination) && !me(q.source)) {
      lines.push({ at: q.createdAt, kind: 'received', text: `← ${bare(q.source)}: ${msg}` });
    } else if (me(q.source) && me(q.destination)) {
      lines.push({ at: q.createdAt, kind: 'sent', text: `↺ note to self: ${msg}` });
    }
  }
  for (const e of history ?? []) if (ms(e.at) <= at) lines.push(e);
  return lines.sort((a, b) => a.at.localeCompare(b.at));
}

/** A rig's handoffs in time order: the replay's single steps. */
export function replaySteps(fm: FleetMachine, rig: string): QueueItem[] {
  return [...rigQueue(fm, rig)].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );
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
  /** Live, non-stopped Claude seats on the machines whose cached profile names it (their login is not read). */
  activeSeats: number;
  /** S5: the hub's view of the account (tier, windows against their resets); null from an older hub. */
  derived: AccountDerived | null;
  /**
   * v1.5 · C: per machine on this card, when its cached profile (where the email comes from) was
   * fetched. null = not in the cache; undefined = an older collector does not report it.
   */
  profiles: { machine: string; fetchedAt: string | null | undefined }[];
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
 * Accounts across the fleet, grouped by each machine's CACHED profile (v1.5 C), which is not
 * proof of the login its seats use. The seats listed are those running on those machines. Readings come only from machines with a sampler; the
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
        derived: null,
        profiles: [],
      } satisfies AccountView);
    // The hub derives one answer per account; take the one with a reading if machines differ.
    if (acct.derived && (!v.derived || (!v.derived.readingFrom && acct.derived.readingFrom))) {
      v.derived = acct.derived;
    }
    v.machines.push(fm.machine.label);
    v.profiles.push({ machine: fm.machine.label, fetchedAt: acct.profileFetchedAt });
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
