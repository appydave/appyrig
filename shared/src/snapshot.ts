import { z } from 'zod';
import { AccountDerivedSchema } from './accounts.js';
import { MachineHealthSchema } from './health.js';
import * as OpenRig from './openrig/index.js';

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

/** D09 W3: most key skills shown on a seat card. */
export const KEY_SKILLS_MAX = 5;

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
  /**
   * v15 UI-A, collector-set: tokens in the seat's context (OpenRig's `totalInputTokens`). Optional and
   * additive (hub first): null = OpenRig has no figure for this seat; absent = this collector does
   * not report it. The UI shows both as an em dash, never 0.
   */
  contextTokens: z.number().int().nonnegative().nullable().optional(),
  work: SeatWorkSchema,
  cwd: z.string().nullable(),
  recoveryGuidance: z.string().nullable(),
  tail: SeatTailSchema.nullable(),
  /**
   * v1.5 · L1, the skill-count pill. Optional and additive (older collectors omit it; hub first).
   * The skills Claude Code listed to the model (available, not used): the newest full
   * `skill_listing` in the seat's transcript plus its later additions, each name counted once. null = the collector looked and found none (a Codex
   * seat, or no listing yet); absent = this collector does not report it.
   */
  skillCount: z.number().int().nonnegative().nullable().optional(),
  /**
   * Fix-first F3 (truth #6). When the seat's AGENT last did something: the newest event timestamp in
   * its Claude Code transcript(s) (not the file's mtime, which a rename or resume also moves). `lastActivityAt` is the terminal's (OpenRig's probe sweep touches an
   * idle pane every few seconds), so it reads "10 min ago" for an agent idle for a day. Optional and
   * additive (hub first): null = the collector looked and found no transcript (a Codex or plain
   * terminal seat); absent = this collector does not report it.
   */
  agentActivityAt: isoDate.nullable().optional(),
  /**
   * D09 W3, collector-set: the last folder of the seat's OpenRig `agent_ref` (`implementer`, `qa`,
   * `independent-reviewer`, …). null = an OpenRig seat with no path agent_ref; absent = not said.
   */
  agentRole: z.string().min(1).max(80).nullable().optional(),
  /**
   * D09 W3, collector-set: the seat's key skills, from the per-seat allowlist in AppyRig's own
   * config, keeping only the ones the seat really has listed (its loadout). Absent = no allowlist
   * for this seat (or no listing yet): the card shows the count alone.
   */
  keySkills: z.array(z.string().min(1).max(120)).max(KEY_SKILLS_MAX).optional(),
  /**
   * v2 data channels, collector-set from OpenRig's node record: the plain `tmux attach -t …` line
   * (the ssh wrapper stays the client's job). Optional, and the hub is strict, so a collector sends
   * it ONLY to a hub that advertised HUB_CAPS.V2_FIELDS (see stripV2Fields): a live daemon always has
   * this field, so omitting-when-unknown does not protect an older hub. The resume command is
   * deliberately NOT carried anywhere: it holds the Claude session id.
   */
  tmuxAttachCommand: z.string().min(1).max(500).optional(),
});
export type Seat = z.infer<typeof SeatSchema>;

/** Longest rig.yaml summary kept. */
export const RIG_SUMMARY_MAX = 600;

/** D09 W2: most planned edges kept per rig. */
export const RIG_EDGES_MAX = 200;

/**
 * D09 W2: one edge of the rig's topology as OpenRig holds it (GET /api/rigs/:id/graph), between
 * two seats by session name. `kind` is OpenRig's own word (`delegates_to`, `can_observe`, …).
 */
export const RigEdgeSchema = z.strictObject({
  from: z.string().min(1),
  to: z.string().min(1),
  kind: z.string().min(1).max(60),
});
export type RigEdge = z.infer<typeof RigEdgeSchema>;

/** Most pods kept per rig. */
export const RIG_PODS_MAX = 50;
/** Most members listed per pod. */
export const POD_MEMBERS_MAX = 200;

/**
 * A POD as the rig's rig.yaml defines it: OpenRig's own PodSpec (snake_case, as authored), minus its
 * full member specs, which are listed by id (seats carry the rest). `edges` are the pod-local edges,
 * between bare member ids. Collector-set from a rig.yaml that OpenRig would accept; text redacted.
 */
export const RigPodSchema = OpenRig.PodSpecSchema.pick({
  id: true,
  label: true,
  summary: true,
  continuity_policy: true,
  startup: true,
  edges: true,
}).extend({
  /** The pod's member ids in rig.yaml order (`build`, not `dev.build`). */
  members: z.array(z.string().min(1)).max(POD_MEMBERS_MAX),
});
export type RigPod = z.infer<typeof RigPodSchema>;

/** Most env names listed for a rig. */
export const RIG_ENV_NAMES_MAX = 100;

/**
 * The rig-level part of rig.yaml: OpenRig's own RigSpec fields (snake_case, as authored), minus
 * name / summary (on RigSummary already), pods and edges (RigSummary.pods / specEdges), and env
 * VALUES: only the names travel (`envNames`). Collector-set from a rig.yaml OpenRig would accept;
 * text redacted.
 */
export const RigSpecViewSchema = OpenRig.RigSpecSchema.pick({
  version: true,
  culture_file: true,
  non_interruptive: true,
  permission_policy: true,
  managed_blocks: true,
  docs: true,
  startup: true,
  services: true,
  workspace: true,
}).extend({
  /** The names of rig.yaml `env`, never the values. */
  envNames: z.array(z.string().min(1).max(120)).max(RIG_ENV_NAMES_MAX).optional(),
});
export type RigSpecView = z.infer<typeof RigSpecViewSchema>;

export const RigSummarySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string(), // running | stopped | …
  lifecycleState: z.string().nullable(),
  nodeCount: z.number().int().nonnegative(),
  runningCount: z.number().int().nonnegative(),
  attentionCount: z.number().int().nonnegative(),
  /**
   * v1.4 · S3. Every field below is optional and additive: older collectors omit them, and a missing
   * field means "this collector did not say", never "none". Deploy the hub before the collectors.
   *
   * Collector-set, from the rig.yaml found in the machine's configured spec folders (matched on `name:`):
   * `specStatus` is `not-found` when none matches (never a guess), and absent when the collector does not look.
   */
  specStatus: z.enum(['found', 'not-found']).optional(),
  /** Absolute path of the matched rig.yaml on the collector's disk. */
  specPath: z.string().nullable().optional(),
  /** The rig.yaml `summary:` text, whitespace-folded and cut to RIG_SUMMARY_MAX. */
  summary: z.string().max(RIG_SUMMARY_MAX).nullable().optional(),
  /**
   * Recency: the newest of any of the rig's seats' agent activity and any queue item `updatedAt`
   * sent from or to one of its seats. Null when neither exists. Collector-set. F3: a seat's agent
   * activity is `agentActivityAt` when the collector reports it, else (older collector)
   * `lastActivityAt`.
   */
  recentAt: isoDate.nullable().optional(),
  /**
   * D09 W2, collector-set: the rig's planned edges from OpenRig's graph, seat to seat (edges that
   * touch a pod rather than a seat are left out). Absent = this collector does not send them;
   * `[]` = OpenRig has none for this rig.
   */
  edges: z.array(RigEdgeSchema).max(RIG_EDGES_MAX).optional(),
  /**
   * Spec fields, collector-set from the matched rig.yaml and sent ONLY to a hub that advertised
   * HUB_CAPS.SPEC_FIELDS (see stripSpecFields). Absent = not said.
   *
   * `specValid`: the matched rig.yaml passes OpenRig's RigSpec schema. false = OpenRig would refuse
   * it, and `pods` / `specEdges` are then left out rather than read from a file OpenRig rejects.
   */
  specValid: z.boolean().optional(),
  /** The rig's pods, in rig.yaml order, with their pod-local edges. */
  pods: z.array(RigPodSchema).max(RIG_PODS_MAX).optional(),
  /**
   * The rig-level (cross-pod) edges as authored: `pod.member` → `pod.member`, kind an OpenRig
   * EdgeKind. Unlike `edges` (OpenRig's graph, seat to seat), these include seats with no session yet.
   */
  specEdges: z.array(OpenRig.CrossPodEdgeSchema).max(RIG_EDGES_MAX).optional(),
  /** The rest of the rig.yaml at rig level: culture_file, docs[], workspace, services, startup… */
  rigSpec: RigSpecViewSchema.optional(),
  /** Hub-set from AppyRig's own config file (never from OpenRig); the UI falls back to `name`. */
  displayName: z.string().min(1).max(80).optional(),
  /** Hub-set, as displayName. */
  owner: z.string().min(1).max(80).optional(),
});
export type RigSummary = z.infer<typeof RigSummarySchema>;

/** One queue row, body-free. The collector keeps the most recent QUEUE_MAX_ITEMS. */
export const QUEUE_MAX_ITEMS = 500;
/** Longest free-text queue field kept (closure, blocked-on, intent, tier). */
export const QUEUE_NOTE_MAX = 200;
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
  /**
   * v2 data channels, collector-set from `rig queue list --full`. Every field is optional;
   * absent means "not said", never "none". Free text is cut to QUEUE_NOTE_MAX. Sent ONLY to a hub
   * that advertised HUB_CAPS.V2_FIELDS (an older strict hub rejects unknown keys; see stripV2Fields).
   */
  closureReason: z.string().min(1).max(QUEUE_NOTE_MAX).optional(),
  closureTarget: z.string().min(1).max(QUEUE_NOTE_MAX).optional(),
  blockedOn: z.string().min(1).max(QUEUE_NOTE_MAX).optional(),
  humanIntent: z.string().min(1).max(QUEUE_NOTE_MAX).optional(),
  tier: z.string().min(1).max(QUEUE_NOTE_MAX).optional(),
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
  /**
   * v1.4 · S5, optional and additive (older collectors omit it; hub first). The login record's own
   * rate-limit tier string (e.g. `default_claude_max_20x`), which names the Max tier. Collector-set.
   */
  rateLimitTier: z.string().max(80).nullable().optional(),
  /**
   * v1.5 · C, optional and additive (older collectors omit it; hub first). When Claude Code last
   * fetched the cached profile the email comes from (`oauthAccount.profileFetchedAt` in
   * ~/.claude.json). The email is that cache, not proof of which login a session uses: logins live
   * in the Keychain and ~/.claude/.credentials.json, which AppyRig never reads.
   */
  profileFetchedAt: isoDate.nullable().optional(),
  /** Hub-set (never sent by a collector): tier and windows against their resets. */
  derived: AccountDerivedSchema.optional(),
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
  /** v1.4 · S6, optional and additive: older collectors omit it (the hub then says "no health data yet"). Hub first. */
  health: MachineHealthSchema.optional(),
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

/**
 * Capabilities a hub advertises in the ack of every accepted snapshot (`CollectorAck.caps`). A
 * collector sends a v2-only key or event ONLY to a hub that listed it. An older hub lists nothing, and
 * the collector then sends exactly the v1.5 shape.
 */
export const HUB_CAPS = {
  /** The snapshot may carry V2_SEAT_KEYS and V2_QUEUE_KEYS. */
  V2_FIELDS: 'v2-fields',
  /** The hub listens for `collector:daemondata`. */
  DAEMONDATA: 'daemondata',
  /** The hub listens for `collector:missionfiles`. */
  MISSIONFILES: 'missionfiles',
  /** The snapshot's rigs may carry SPEC_RIG_KEYS (pods, spec edges, rig spec, from rig.yaml). */
  SPEC_FIELDS: 'spec-fields',
  /** `collector:rigfiles` may carry scope `rig` files (the ones rig.yaml names). */
  SPEC_FILES: 'spec-files',
} as const;

export const V2_SEAT_KEYS = ['tmuxAttachCommand'] as const;
export const V2_QUEUE_KEYS = [
  'closureReason',
  'closureTarget',
  'blockedOn',
  'humanIntent',
  'tier',
] as const;

/** The snapshot as a hub without HUB_CAPS.V2_FIELDS accepts it: every v2-only key removed. */
export function stripV2Fields(snapshot: MachineSnapshot): MachineSnapshot {
  const drop = (row: object, keys: readonly string[]) =>
    Object.fromEntries(Object.entries(row).filter(([k]) => !keys.includes(k)));
  return {
    ...snapshot,
    seats: snapshot.seats.map((s) => drop(s, V2_SEAT_KEYS) as Seat),
    queue: snapshot.queue.map((q) => drop(q, V2_QUEUE_KEYS) as QueueItem),
  };
}

export const SPEC_RIG_KEYS = ['specValid', 'pods', 'specEdges', 'rigSpec'] as const;

/** The snapshot as a hub without HUB_CAPS.SPEC_FIELDS accepts it: every spec-only rig key removed. */
export function stripSpecFields(snapshot: MachineSnapshot): MachineSnapshot {
  return {
    ...snapshot,
    rigs: snapshot.rigs.map(
      (r) =>
        Object.fromEntries(
          Object.entries(r).filter(([k]) => !(SPEC_RIG_KEYS as readonly string[]).includes(k))
        ) as RigSummary
    ),
  };
}

/**
 * True when a hub refusal message names a v2-only or spec-only key (an older strict hub:
 * "Unrecognized key").
 */
export function namesV2Key(message: string): boolean {
  return (
    [...V2_SEAT_KEYS, ...V2_QUEUE_KEYS].some((k) => message.includes(k)) ||
    SPEC_RIG_KEYS.some((k) => message.includes(`"${k}"`))
  );
}
