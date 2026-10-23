import { type FleetMachine, type QueueItem, type Seat } from '@appydave/shared';
import { type ModelFamily, type PipKey } from '@client/domain/fleet/model.js';
import { type Endpoint, type RigRef } from '@client/domain/fleet/views/core/types.js';

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
  /** D09 W3: the seat's agent_ref role and key skills, when its collector reports them. */
  agentRole?: string | null;
  keySkills?: string[];
  /** v15 UI-A: the mailbox address (the session name), runtime, raw model, context and activity. */
  address: string;
  /** The seat's own rig (a rig that exists on its machine), for asking that machine's ssh target. */
  rig: string | null;
  source: Seat['source'];
  runtime: string | null;
  modelRaw: string | null;
  contextPct: number | null;
  contextTokens: number | null;
  activity: string | null;
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
  /** C6a: the queue items on this line, oldest first (for the details drawer). */
  items: QueueItem[];
  /**
   * D09 W2: set on a planned line: the rig spec's edge kind (`delegates_to`, `can_observe`, …), drawn
   * dashed until a real handoff on the same pair replaces it. A planned line has no items.
   */
  planned?: string;
}

export interface RigMap {
  rig: RigRef;
  lanes: MapLane[];
  edges: MapEdge[];
  /** F1: items this rig does the work on (its total; see ownerRig). */
  handoffs: number;
  /** F1: items it sent to another rig: drawn as lines, counted on the receiving rig. */
  outgoing: number;
  /**
   * D09 W2: the spec's edges no handoff has gone along yet, as planned lines (count 0). Null when
   * the machine's collector does not send the rig's edges, so the screen can say so.
   */
  planned: MapEdge[] | null;
}

export interface OpenCount {
  open: number;
  stale: number;
  oldestStaleMs: number | null;
}

/** An endpoint of a handoff that is not a seat of the mapped rig. */
export interface OutsideEnd {
  fm: FleetMachine | null;
  ep: Endpoint;
}

/** What one pass over the rig's queue collects: the lines, who is waiting where, who is outside. */
export interface HandoffScan {
  machines: FleetMachine[];
  home: FleetMachine;
  rigName: string;
  now: number;
  edges: Map<string, MapEdge>;
  openAt: Map<string, OpenCount>;
  outside: Map<string, OutsideEnd>;
  /** A seat as the map draws it, with the open items waiting on it. */
  seatOf: (fm: FleetMachine, seat: Seat) => MapSeat;
}
