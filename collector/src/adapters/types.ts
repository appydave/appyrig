import type { SpecInfo } from './specs.js';
import type { AccountUsage, QueueItem, RigSummary, Seat, ViewerStatus } from '@appydave/shared';

/** What the daemon adapter returns: AppyRig-shaped pieces, no OpenRig shapes leak out. */
export interface DaemonRead {
  version: string | null;
  rigs: RigSummary[];
  /** Seats with `tail: null` and `viewerStatus: null`; the builder fills those in. */
  seats: Seat[];
  queue: QueueItem[];
  /** Parts of the daemon read that failed while the rest succeeded; empty/absent = all read. */
  warnings?: string[];
}

export interface TmuxPane {
  session: string;
  paneId: string;
  /** Foreground command of the session's active pane. */
  command: string | null;
  cwd: string | null;
}

export interface ViewerAgent {
  paneId: string;
  agent: string;
  status: ViewerStatus;
  cwd: string | null;
}

/**
 * The four reads a collector makes. The real implementation is `createSources`; tests inject
 * fixture-backed ones. Each read throws on failure: the builder turns a throw into
 * `sources.<name>.ok = false` so "could not read" never looks like "nothing there".
 */
export interface Sources {
  daemon(): Promise<DaemonRead>;
  /** One entry per tmux session (its active pane). Empty when no tmux server runs. */
  tmuxPanes(): Promise<TmuxPane[]>;
  /** Raw pane text with ANSI escapes, unbounded and unredacted (the builder bounds and redacts). */
  capture(paneId: string): Promise<string>;
  viewerAgents(): Promise<ViewerAgent[]>;
  /** The machine's Claude account + latest usage reading (v1.1). Optional: fixtures may omit it. */
  account?(): Promise<AccountUsage | null>;
  /** rig name → its rig.yaml, from the configured spec folders (v1.4). Optional: fixtures may omit it. */
  specs?(): Promise<Map<string, SpecInfo>>;
  /** queue id → message body from the latest queue read (v1.4). Optional: fixtures may omit it. */
  queueBodies?(): Promise<Map<string, string>>;
}
