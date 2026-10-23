import { type Seat } from '@appydave/shared';

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
 * Batch 1 · B2 (fb-0001): one state per rig, readable at a glance on its chip, with a glyph and a
 * word as well as a colour. It follows `rig ps`: STATUS running/stopped, ATTN, and ACTIVE (working).
 */
export type RigState = 'attention' | 'working' | 'idle' | 'stopped' | 'asleep';

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
