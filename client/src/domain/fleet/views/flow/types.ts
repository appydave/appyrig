import {
  type FleetMachine,
  type QueueItem,
  type Seat,
  type SeatHistoryEvent,
} from '@appydave/shared';
import { type ModelFamily } from '@client/domain/fleet/model.js';

export type Stage = 'lead' | 'build' | 'qa' | 'review';

/**
 * `roles`: a build team (it has a QA or review seat) flows through the four role stages.
 * `seats`: any other team (research-scout → research-checker, the kernel's advisor and operators)
 * gets one box per seat, so nothing is squashed into "Builders".
 */
export type FlowMode = 'roles' | 'seats';

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
  /**
   * How many of its items were sent back. Set only when the caller passed `opts.sentBack` (the old
   * page never does, so its edges are unchanged).
   */
  back?: number;
}

export interface FlowStageView {
  /** Node id: a Stage in roles mode, a seat name in seats mode. */
  stage: string;
  label: string;
  seats: { name: string; key: string; family: ModelFamily; model: string }[];
  /** True for a seats-mode box that is not in this rig (another rig or machine), and for the roles-mode "From outside the rig" box. */
  outside: boolean;
  /**
   * D15 · UI-B: roles mode, the Lead stage of a rig with no lead seat (and nothing in the rig
   * acting as one). Drawn as a dashed "No lead — by design" outline, not as an empty stage.
   */
  noLead: boolean;
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
  /** B3: how many closed handoffs the median is taken over. */
  closedCount: number;
  /** The node holding the most fresh waiting items at `at` (the queue), if any. Stale items never count. */
  bottleneck: string | null;
}

/**
 * The flow at time `at`: everything handed off up to then, and what was still open then. An item
 * is in flight from createdAt until updatedAt if it is done (updatedAt is when it closed), or
 * until now if it is still open.
 */
/**
 * What counts as "sent back" (run board brief, lane 2, 2026-10-19).
 *  - `stage` (the default, what every caller had before): roles mode, a handoff to an earlier stage
 *    other than the Lead or outside.
 *  - `verdict-or-stage`: when ANY handoff in the rig carries a `verdict:` tag, a handoff is sent back
 *    exactly when its verdict is `changes` or `fail` (`accept` / `pass` never are, whichever way they
 *    go); a rig with no verdict tags at all keeps the stage rule.
 */
type SentBackRule = 'stage' | 'verdict-or-stage';

export interface FlowOptions {
  sentBack?: SentBackRule;
}

/** How a rig's endpoints become the flow's boxes: roles (the four stages) or one box per seat. */
export interface FlowLayout {
  rigSeats: Seat[];
  mode: FlowMode;
  order: string[];
  inRig: (raw: string | null) => boolean;
  nameOf: (raw: string | null) => string;
  nodeOf: (raw: string | null) => string;
}

/** What one pass over the rig's queue up to the replay time collects. */
export interface FlowRun {
  fm: FleetMachine;
  rig: string;
  items: QueueItem[];
  at: number;
  now: number;
  sentBack: SentBackRule | undefined;
  byVerdict: boolean;
  layout: FlowLayout;
  edges: Map<string, FlowEdge>;
  waiting: Map<string, QueueItem[]>;
  stale: Map<string, QueueItem[]>;
  closedTurn: number[];
  total: number;
  rework: number;
}

export interface Chapter {
  at: number;
  kind: 'start' | 'first-rework' | 'peak' | 'longest-wait' | 'end';
  title: string;
  text: string;
}

export type ConsoleKind = 'sent' | 'received' | SeatHistoryEvent['kind'];

export interface ConsoleLine {
  at: string;
  kind: ConsoleKind;
  text: string;
}
