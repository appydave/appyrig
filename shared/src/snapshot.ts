import { z } from 'zod';

/**
 * The AppyRig snapshot contract (P0b).
 *
 * A collector builds one MachineSnapshot for its own machine every PUSH_INTERVAL_MS and pushes it
 * whole to the hub. The hub validates it with MachineSnapshotSchema, replaces that machine's
 * previous snapshot, and wraps it in a FleetMachine (adds liveness) for the browser.
 *
 * These schemas describe AppyRig's OWN normalised shape. They are deliberately not OpenRig's
 * shapes: raw daemon / tmux / pane-viewer output is parsed only in collector/src/adapters/, and the
 * strict contract test for OpenRig's shapes lives there too (AC 3). Nothing here may name an
 * OpenRig route or command (AC 12).
 */

export const SNAPSHOT_SCHEMA_VERSION = 1 as const;

/** Most lines of terminal text a seat may carry, in a snapshot and in the UI store (AC 7). */
export const TAIL_MAX_LINES = 200;

/** How often a collector pushes. */
export const PUSH_INTERVAL_MS = 3_000;

/** A machine with no push for this long is shown as asleep, never idle (AC 6). */
export const ASLEEP_AFTER_MS = 15_000;

const isoDate = z.iso.datetime({ offset: true });

/**
 * The one state the UI renders as a pip. Derived by the collector:
 * - `blocked`  — needsInput.count > 0 (or the pane viewer reports an approval/question UI)
 * - `working`  — the oracle says working
 * - `idle`     — the oracle says idle
 * - `stopped`  — the seat's session is not running (exited / recoverable); no activityState
 * - `unknown`  — running, but nothing could decide (honest, not an error)
 * `attention_required` is a lifecycle fact, not a pip; it travels in `lifecycleState`.
 */
export const SeatStatusSchema = z.enum(['working', 'idle', 'blocked', 'stopped', 'unknown']);
export type SeatStatus = z.infer<typeof SeatStatusSchema>;

/** Where a seat came from. A plain tmux session outside OpenRig is still a seat (source `tmux`). */
export const SeatSourceSchema = z.enum(['openrig', 'tmux']);
export type SeatSource = z.infer<typeof SeatSourceSchema>;

/** Status as reported by the terminal viewer app, when it is running and the pane is open. */
export const ViewerStatusSchema = z.enum(['idle', 'working', 'blocked', 'done', 'unknown']);
export type ViewerStatus = z.infer<typeof ViewerStatusSchema>;

/** The oracle's activity verdict, normalised. Absent for stopped seats. */
export const SeatActivitySchema = z.strictObject({
  activity: z.string(), // working | idle-at-prompt | unknown (kept open: OpenRig may add values)
  display: z.string(), // working | idle | needs-input | unknown
  needsInputCount: z.number().int().nonnegative(),
  needsInputReason: z.string().nullable(),
  decidedBy: z.string().nullable(),
});
export type SeatActivity = z.infer<typeof SeatActivitySchema>;

/** Bounded, redacted terminal text. Lines keep their ANSI escapes when `ansi` is true. */
export const SeatTailSchema = z.strictObject({
  lines: z.array(z.string()).max(TAIL_MAX_LINES),
  ansi: z.boolean(),
  capturedAt: isoDate,
});
export type SeatTail = z.infer<typeof SeatTailSchema>;

export const SeatWorkSchema = z.strictObject({
  pending: z.number().int().nonnegative(),
  inProgress: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative(),
});
export type SeatWork = z.infer<typeof SeatWorkSchema>;

export const SeatSchema = z.strictObject({
  /** Stable id within the machine: the canonical session name (`dev-build@starter`) or the tmux session name. */
  id: z.string().min(1),
  source: SeatSourceSchema,
  /** Rig NAME (= RigSummary.name, e.g. `starter`), never the rig ULID: the hub joins on it. */
  rig: z.string().nullable(),
  pod: z.string().nullable(),
  logicalId: z.string().nullable(),
  runtime: z.string().nullable(), // claude-code | codex | terminal | …
  model: z.string().nullable(),
  status: SeatStatusSchema,
  /** Plain-words reason when status is `blocked` (e.g. "permission prompt"). */
  blockedReason: z.string().nullable(),
  /**
   * Optional detail for a blocked seat: the question the terminal is showing, e.g. "Allow this read
   * outside the working directories?". Additive and optional so older snapshots stay valid.
   */
  blockedDetail: z.string().max(200).nullable().optional(),
  lifecycleState: z.string().nullable(), // running | detached | recoverable | attention_required
  sessionStatus: z.string().nullable(),
  /** Optional on purpose: stopped seats have no activityState at all. Diagnostic only: never derive the pip from it; the pip is `status`. */
  activity: SeatActivitySchema.optional(),
  viewerStatus: ViewerStatusSchema.nullable(),
  lastActivityAt: isoDate.nullable(),
  contextUsedPct: z.number().min(0).max(100).nullable(),
  work: SeatWorkSchema,
  cwd: z.string().nullable(),
  recoveryGuidance: z.string().nullable(),
  tail: SeatTailSchema.nullable(),
});
export type Seat = z.infer<typeof SeatSchema>;

export const RigSummarySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string(), // running | stopped | …
  lifecycleState: z.string().nullable(),
  nodeCount: z.number().int().nonnegative(),
  runningCount: z.number().int().nonnegative(),
  attentionCount: z.number().int().nonnegative(),
});
export type RigSummary = z.infer<typeof RigSummarySchema>;

/** One queue row, body-free. The collector keeps the most recent QUEUE_MAX_ITEMS. */
export const QUEUE_MAX_ITEMS = 500;
export const QueueItemSchema = z.strictObject({
  id: z.string().min(1),
  source: z.string().nullable(),
  destination: z.string().nullable(),
  state: z.string(),
  priority: z.string().nullable(),
  tags: z.array(z.string()),
  summary: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type QueueItem = z.infer<typeof QueueItemSchema>;

/** Per-source health, so "no seats" and "could not read" never look the same. */
export const SourceHealthSchema = z.strictObject({
  ok: z.boolean(),
  /** Present when ok is false: what failed, in plain words. */
  error: z.string().nullable(),
  /** Version string when the source reports one (e.g. OpenRig semver). */
  version: z.string().nullable(),
});
export type SourceHealth = z.infer<typeof SourceHealthSchema>;

export const MachineIdentitySchema = z.strictObject({
  /** Lower-case slug used as the hub key and the disk filename: `m2`, `roamy`, `m4`. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  label: z.string().min(1), // "M2", "Roamy"
  hostname: z.string().nullable(),
});
export type MachineIdentity = z.infer<typeof MachineIdentitySchema>;

/**
 * The Claude account this machine is signed into, and its latest rate-limit reading (v1.1, the
 * accounts panel). Read from files only: the account's email and plan type, never a credential;
 * usage from the status-line sampler's log when the machine has one. A null reading means "no
 * sampler on this machine", which the UI must never show as 0%.
 */
export const AccountUsageSchema = z.strictObject({
  email: z.string().nullable(),
  /** Plan type as the login record names it (`claude_max`, `claude_pro`, …). Max tier is not in it. */
  plan: z.string().nullable(),
  /** Can exceed 100: the status line reports 102% once a window is spent. */
  fiveHourPct: z.number().min(0).nullable(),
  fiveHourResetsAt: isoDate.nullable(),
  sevenDayPct: z.number().min(0).nullable(),
  sevenDayResetsAt: isoDate.nullable(),
  /** When the sampler last wrote a reading (it writes on change, or every 5 min while active). */
  sampledAt: isoDate.nullable(),
});
export type AccountUsage = z.infer<typeof AccountUsageSchema>;

export const MachineSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(SNAPSHOT_SCHEMA_VERSION),
  machine: MachineIdentitySchema,
  collectedAt: isoDate,
  collector: z.strictObject({ version: z.string(), pid: z.number().int().nullable() }),
  sources: z.strictObject({
    daemon: SourceHealthSchema,
    tmux: SourceHealthSchema,
    viewer: SourceHealthSchema,
  }),
  rigs: z.array(RigSummarySchema),
  seats: z.array(SeatSchema),
  queue: z.array(QueueItemSchema).max(QUEUE_MAX_ITEMS),
  /** Optional and additive (v1.1): older collectors omit it. Deploy the hub before the collectors. */
  account: AccountUsageSchema.nullable().optional(),
});
export type MachineSnapshot = z.infer<typeof MachineSnapshotSchema>;

/** Hub-side wrapper: the last snapshot plus liveness. Never computed by a collector. */
export const LivenessSchema = z.enum(['live', 'asleep']);
export type Liveness = z.infer<typeof LivenessSchema>;

export const FleetMachineSchema = z.strictObject({
  machine: MachineIdentitySchema,
  liveness: LivenessSchema,
  /** When the hub last received a valid snapshot from this machine. */
  lastSeen: isoDate,
  snapshot: MachineSnapshotSchema,
});
export type FleetMachine = z.infer<typeof FleetMachineSchema>;

/**
 * Payload of `fleet:update`. On connect the hub sends every machine; afterwards each emit carries
 * only the machines that changed (new snapshot or liveness flip). The client replaces each listed
 * machine whole, keyed by machine.id. No diffs in v1.
 */
export const FleetUpdateSchema = z.strictObject({
  generatedAt: isoDate,
  full: z.boolean(), // true = this is every machine the hub knows
  machines: z.array(FleetMachineSchema),
});
export type FleetUpdate = z.infer<typeof FleetUpdateSchema>;
