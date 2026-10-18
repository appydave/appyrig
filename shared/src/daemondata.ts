import { z } from 'zod';
import { MachineIdentitySchema } from './snapshot.js';
import { SeatRefSchema } from './verbs.js';

/**
 * v2 data channels: read-only data the v2 pages need, collected from each machine's OpenRig daemon
 * (GET only) and pushed on ONE side channel, `collector:daemondata`, one message per (kind, key).
 *
 * Rules (all pinned by tests):
 *  - Hub first, then collectors: an older hub has no listener for the event, so a newer collector
 *    just gets no ack (it warns at most every 10 minutes) and nothing else changes.
 *  - A collector pushes `status: 'unsupported'` (data null) when the daemon has no such route (HTTP
 *    404), so "not on this OpenRig version" never looks like "none". A failing endpoint (timeout,
 *    5xx, unreadable shape) pushes NOTHING and is logged once: the hub then says `pending`.
 *  - Nothing here is a write, and nothing here asks the daemon to change anything.
 *  - Free text is redacted and capped by the collector; absolute paths are kept only where a page
 *    needs them (library source path) and never in settings values.
 */

const isoDate = z.iso.datetime({ offset: true });
const MachineId = MachineIdentitySchema.shape.id;

export const DAEMON_KINDS = [
  'seatdetail',
  'library',
  'transitions',
  'workflows',
  'health',
  'settings',
] as const;
export type DaemonKind = (typeof DAEMON_KINDS)[number];

const Text = (max: number) => z.string().max(max);
const TextN = (max: number) => z.string().max(max).nullable();

// ── seatdetail ────────────────────────────────────────────

export const SeatDetailDataSchema = z.strictObject({
  spec: z
    .strictObject({
      name: TextN(120),
      version: TextN(60),
      profile: TextN(120),
      hash: TextN(120),
    })
    .nullable(),
  startupFiles: z
    .array(
      z.strictObject({
        path: Text(400),
        deliveryHint: TextN(60),
        required: z.boolean().nullable(),
        appliesOn: z.array(Text(60)).max(10),
      })
    )
    .max(60),
  startupActions: z
    .array(
      z.strictObject({
        type: Text(60),
        phase: TextN(60),
        /** The text the action sends, redacted and cut; null when the action sends none. */
        text: TextN(400),
      })
    )
    .max(60),
  peers: z
    .array(
      z.strictObject({
        logicalId: Text(200),
        session: TextN(200),
        runtime: TextN(60),
      })
    )
    .max(60),
  /** The daemon's recovery guidance notes (plain words). Never the resume token. */
  recoveryNotes: z.array(Text(300)).max(10),
  installedResources: z.array(z.strictObject({ id: Text(200), category: TextN(80) })).max(60),
});
export type SeatDetailData = z.infer<typeof SeatDetailDataSchema>;

// ── library ───────────

export const LIBRARY_ROWS_MAX = 300;
export const LIBRARY_FILES_MAX = 30;

const FactValue = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);

/** One library row, the same shape for specs, skills and context packs. */
export const LibraryRowSchema = z.strictObject({
  id: Text(300),
  kind: TextN(60),
  name: Text(200),
  version: TextN(60),
  sourceType: TextN(60),
  summary: TextN(400),
  /** Where it lives on that machine's disk (shown as text, never opened). */
  path: TextN(500),
  updatedAt: TextN(60),
  /** Group-specific facts: spec (rolesCount, stepsCount, targetRig, …), skill (fileCount, totalBytes), pack (taxonomy, tokens). */
  facts: z.record(z.string().max(60), FactValue),
  /** Skill file names and sizes (library.get only; library.list leaves them out). */
  files: z
    .array(z.strictObject({ name: Text(200), size: z.number().int().nonnegative().nullable() }))
    .max(LIBRARY_FILES_MAX),
});
export type LibraryRow = z.infer<typeof LibraryRowSchema>;

/** Each list is null when that endpoint could not be read this round (kept apart from an empty list). */
export const LibraryDataSchema = z.strictObject({
  openrigVersion: TextN(60),
  specs: z.array(LibraryRowSchema).max(LIBRARY_ROWS_MAX).nullable(),
  skills: z.array(LibraryRowSchema).max(LIBRARY_ROWS_MAX).nullable(),
  contextPacks: z.array(LibraryRowSchema).max(LIBRARY_ROWS_MAX).nullable(),
});
export type LibraryData = z.infer<typeof LibraryDataSchema>;

// ── transitions ──────────────────────────────────────

/** Most transition rows a collector keeps and pushes (newest). */
export const TRANSITIONS_MAX = 1000;

export const TransitionRowSchema = z.strictObject({
  /** The daemon's id, a decimal string (telemetry ids are strings; per-daemon sequence). */
  id: Text(30),
  qitemId: Text(200),
  at: isoDate,
  state: Text(60),
  actor: TextN(200),
  closureReason: TextN(200),
  closureTarget: TextN(200),
});
export type TransitionRow = z.infer<typeof TransitionRowSchema>;

export const TransitionsDataSchema = z.strictObject({
  /** Oldest to newest. */
  rows: z.array(TransitionRowSchema).max(TRANSITIONS_MAX),
  /** Rows the daemon had when last read (the collector keeps the newest TRANSITIONS_MAX). */
  retained: z.number().int().nonnegative().nullable(),
  truncated: z.boolean(),
  hostId: TextN(100),
  bootEpoch: TextN(100),
});
export type TransitionsData = z.infer<typeof TransitionsDataSchema>;

// ── workflows ────────────────────────────────────

export const WorkflowSpecSchema = z.strictObject({
  name: Text(200),
  version: TextN(60),
  purpose: TextN(400),
  targetRig: TextN(200),
  terminalTurnRule: TextN(100),
  isBuiltIn: z.boolean().nullable(),
});
export type WorkflowSpec = z.infer<typeof WorkflowSpecSchema>;

export const WorkflowInstanceSchema = z.strictObject({
  instanceId: Text(200),
  workflowName: TextN(200),
  workflowVersion: TextN(60),
  status: TextN(60),
  currentStepId: TextN(200),
  hopCount: z.number().int().nonnegative().nullable(),
  createdAt: TextN(60),
  completedAt: TextN(60),
  deadlineState: TextN(60),
});
export type WorkflowInstance = z.infer<typeof WorkflowInstanceSchema>;

/** Each list is null when that endpoint could not be read (kept apart from "none run"). */
export const WorkflowsDataSchema = z.strictObject({
  specs: z.array(WorkflowSpecSchema).max(200).nullable(),
  instances: z.array(WorkflowInstanceSchema).max(300).nullable(),
});
export type WorkflowsData = z.infer<typeof WorkflowsDataSchema>;

// ── health ──────

export const HealthFindingSchema = z.strictObject({
  id: Text(200),
  detector: TextN(120),
  severity: TextN(60),
  summary: TextN(400),
  evaluatedAt: TextN(60),
});
export type HealthFinding = z.infer<typeof HealthFindingSchema>;

export const HealthCoverageSchema = z.strictObject({
  source: Text(120),
  unit: TextN(120),
  evaluated: z.number().nonnegative().nullable(),
  total: z.number().nonnegative().nullable(),
  omitted: z.number().nonnegative().nullable(),
  partial: z.boolean().nullable(),
  evaluatedAt: TextN(60),
});
export type HealthCoverage = z.infer<typeof HealthCoverageSchema>;

export const HealthDataSchema = z.strictObject({
  /** null = the findings endpoint could not be read; [] = it was read and holds none. */
  findings: z.array(HealthFindingSchema).max(100).nullable(),
  findingsTotal: z.number().int().nonnegative().nullable(),
  findingsTruncated: z.boolean().nullable(),
  coverage: z.array(HealthCoverageSchema).max(20),
  /** null = the policy endpoint could not be read. */
  policy: z
    .strictObject({
      diagnosisEnabled: z.boolean().nullable(),
      disabledDetectors: z.array(Text(120)).max(40),
      detectors: z.array(Text(120)).max(40),
      thresholds: z.record(z.string().max(60), z.number()),
    })
    .nullable(),
  contextSummary: z
    .strictObject({
      total: z.number().int().nonnegative().nullable(),
      critical: z.number().int().nonnegative().nullable(),
      warning: z.number().int().nonnegative().nullable(),
      stale: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  restore: z
    .strictObject({
      verdict: TextN(60),
      red: z.number().int().nonnegative().nullable(),
      yellow: z.number().int().nonnegative().nullable(),
      green: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  daemon: z
    .strictObject({
      semver: TextN(60),
      commit: TextN(60),
      eventLoopLagP99Ms: z.number().nonnegative().nullable(),
    })
    .nullable(),
});
export type HealthData = z.infer<typeof HealthDataSchema>;

// ── settings ─────────────────────────────────────────────────────────────────

const SettingValue = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);

export const SettingSchema = z.strictObject({
  value: SettingValue,
  source: TextN(40),
  defaultValue: SettingValue,
});
export type Setting = z.infer<typeof SettingSchema>;

export const SettingsDataSchema = z.strictObject({
  settings: z.record(z.string().max(120), SettingSchema),
  /** Keys read but not forwarded (not on the allowlist, secret-looking name). */
  withheld: z.number().int().nonnegative(),
  /** Keys forwarded whose value looked like a path and was replaced by SETTING_PATH_HIDDEN. */
  pathsHidden: z.number().int().nonnegative(),
});
export type SettingsData = z.infer<typeof SettingsDataSchema>;

export const SETTING_PATH_HIDDEN = '(path hidden)';

// ── the push ───────────────────────────────────────────────────────────────────────────────────

const PushBase = {
  machineId: MachineId,
  collectedAt: isoDate,
  /** `unsupported` = the daemon has no such route (HTTP 404); data is then null. */
  status: z.enum(['ok', 'unsupported']),
  reason: TextN(300),
};

const push = <K extends DaemonKind, D extends z.ZodType>(kind: K, data: D) =>
  z.strictObject({
    kind: z.literal(kind),
    ...PushBase,
    /** seatdetail: the seat id; every other kind: the empty string. */
    key: Text(200),
    data: data.nullable(),
  });

export const DaemonDataPushSchema = z.discriminatedUnion('kind', [
  push('seatdetail', SeatDetailDataSchema),
  push('library', LibraryDataSchema),
  push('transitions', TransitionsDataSchema),
  push('workflows', WorkflowsDataSchema),
  push('health', HealthDataSchema),
  push('settings', SettingsDataSchema),
]);
export type DaemonDataPush = z.infer<typeof DaemonDataPushSchema>;
/** The data of one kind (what `status: 'ok'` carries). */
export type DaemonDataFor<K extends DaemonKind> = NonNullable<
  Extract<DaemonDataPush, { kind: K }>['data']
>;

// ── verbs ──────────────────────────────────────────────────────────────────────────────────────

/** `ok` = data present; `pending` = nothing from that collector yet (older, or not sent); `unsupported` = the daemon lacks the route. */
export const DataStatusSchema = z.enum(['ok', 'pending', 'unsupported']);
export type DataStatus = z.infer<typeof DataStatusSchema>;

const MachineFilter = z.strictObject({
  machine: MachineId.optional().describe('only this machine'),
});

/** Per-machine header every v2 data verb returns, so an empty list is never read as "none". */
export const DataMachineSchema = z.strictObject({
  machine: MachineId,
  status: DataStatusSchema,
  reason: TextN(300),
  collectedAt: isoDate.nullable(),
});
export type DataMachine = z.infer<typeof DataMachineSchema>;

// seat.detail
export const SeatDetailInputSchema = SeatRefSchema;
export const SeatDetailOutputSchema = z.strictObject({
  machine: MachineId,
  seat: z.string(),
  status: DataStatusSchema.or(z.literal('not-openrig')),
  reason: TextN(300),
  collectedAt: isoDate.nullable(),
  detail: SeatDetailDataSchema.nullable(),
});
export type SeatDetailOutput = z.infer<typeof SeatDetailOutputSchema>;

// library.list / library.get
export const LibraryGroupSchema = z.enum(['spec', 'skill', 'context-pack']);
export type LibraryGroup = z.infer<typeof LibraryGroupSchema>;
export const LIBRARY_LIST_MAX = 500;

export const LibraryItemSchema = LibraryRowSchema.omit({ files: true }).extend({
  machine: MachineId,
  group: LibraryGroupSchema,
});
export type LibraryItem = z.infer<typeof LibraryItemSchema>;

export const LibraryListInputSchema = MachineFilter.extend({
  group: LibraryGroupSchema.optional().describe('only specs, skills or context packs'),
  kind: z.string().min(1).optional().describe('only this kind, e.g. agent, rig, workflow'),
  text: z.string().min(1).max(200).optional().describe('substring of name, id or summary'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(LIBRARY_LIST_MAX)
    .optional()
    .describe(`at most N items (default 200, max ${LIBRARY_LIST_MAX})`),
});
export type LibraryListInput = z.infer<typeof LibraryListInputSchema>;

export const LibraryListOutputSchema = z.strictObject({
  machines: z.array(
    DataMachineSchema.extend({
      openrigVersion: TextN(60),
      /** null = that list could not be read from that machine (not the same as 0). */
      counts: z.strictObject({
        specs: z.number().int().nonnegative().nullable(),
        skills: z.number().int().nonnegative().nullable(),
        contextPacks: z.number().int().nonnegative().nullable(),
      }),
    })
  ),
  items: z.array(LibraryItemSchema),
  /** Items matching before `limit`. */
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type LibraryListOutput = z.infer<typeof LibraryListOutputSchema>;

export const LibraryGetInputSchema = z.strictObject({
  machine: MachineId.describe('machine id, e.g. m4'),
  group: LibraryGroupSchema,
  id: z.string().min(1).describe('the item id library.list returned'),
});
export type LibraryGetInput = z.infer<typeof LibraryGetInputSchema>;
export const LibraryGetOutputSchema = z.strictObject({
  item: LibraryItemSchema,
  /** Skill file names and sizes (empty for specs and packs). File text is not carried. */
  files: LibraryRowSchema.shape.files,
  collectedAt: isoDate.nullable(),
});
export type LibraryGetOutput = z.infer<typeof LibraryGetOutputSchema>;

// history.transitions
export const TRANSITIONS_PAGE_MAX = 200;
export const HistoryTransitionsInputSchema = MachineFilter.extend({
  qitemId: z.string().min(1).optional().describe('only this queue item'),
  seat: z
    .string()
    .min(1)
    .optional()
    .describe('only transitions by this seat, or on items it sent or owns'),
  rig: z.string().min(1).optional().describe('only transitions of this rig (the part after @)'),
  state: z.string().min(1).optional().describe('only transitions into this state, e.g. done'),
  closureReason: z
    .string()
    .min(1)
    .optional()
    .describe('only this closure reason, e.g. handed_off_to'),
  text: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('substring of item id, actor, closure, or the item summary / tags'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(TRANSITIONS_PAGE_MAX)
    .optional()
    .describe(`page size, at most ${TRANSITIONS_PAGE_MAX} (default 50)`),
  before: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .describe('cursor: the nextCursor of the previous page (newest first)'),
});
export type HistoryTransitionsInput = z.infer<typeof HistoryTransitionsInputSchema>;

export const HistoryTransitionRowSchema = TransitionRowSchema.extend({
  machine: MachineId,
  /** From the machine's last queue snapshot, when the item is still in it. */
  source: TextN(200),
  destination: TextN(200),
  summary: TextN(200),
});
export type HistoryTransitionRow = z.infer<typeof HistoryTransitionRowSchema>;

export const HistoryTransitionsOutputSchema = z.strictObject({
  machines: z.array(
    DataMachineSchema.extend({
      /** Rows the hub holds for that machine (the newest TRANSITIONS_MAX). */
      held: z.number().int().nonnegative(),
      /** Rows the daemon retained when last read; held < retained means older rows are not held. */
      retained: z.number().int().nonnegative().nullable(),
      truncated: z.boolean(),
      /** Earliest transition held: say "from <date>", never "all history". */
      earliestAt: isoDate.nullable(),
    })
  ),
  rows: z.array(HistoryTransitionRowSchema),
  /** Rows matching the filters (all pages). */
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});
export type HistoryTransitionsOutput = z.infer<typeof HistoryTransitionsOutputSchema>;

// workflow.list
export const WorkflowListInputSchema = MachineFilter.extend({
  status: z.string().min(1).optional().describe('only instances in this status, e.g. active'),
});
export type WorkflowListInput = z.infer<typeof WorkflowListInputSchema>;
export const WorkflowListOutputSchema = z.strictObject({
  machines: z.array(
    DataMachineSchema.extend({
      /** True when the spec list was read; false = unread, not "none". */
      specsRead: z.boolean(),
      /** True when the instance list was read: then an empty instances list means none have run. */
      instancesRead: z.boolean(),
    })
  ),
  specs: z.array(WorkflowSpecSchema.extend({ machine: MachineId })),
  instances: z.array(WorkflowInstanceSchema.extend({ machine: MachineId })),
});
export type WorkflowListOutput = z.infer<typeof WorkflowListOutputSchema>;

// health.findings
export const HealthAssessmentSchema = z.enum(['findings', 'none-found', 'unknown']);
export const HealthFindingsOutputSchema = z.strictObject({
  machines: z.array(
    DataMachineSchema.extend({
      /**
       * findings = some exist. none-found = the detectors that ran found none (see `caveats`).
       * unknown = the findings could not be read. Never "healthy": absence is not proof.
       */
      assessment: HealthAssessmentSchema,
      /** Plain-words reasons an empty list is NOT all-clear (diagnosis off, partial coverage, nothing evaluated). */
      caveats: z.array(z.string()),
      data: HealthDataSchema.nullable(),
    })
  ),
});
export type HealthFindingsOutput = z.infer<typeof HealthFindingsOutputSchema>;

// settings.get
export const SettingsGetInputSchema = MachineFilter.extend({
  key: z.string().min(1).optional().describe('only this key, or this prefix ending in a dot'),
  changedOnly: z.boolean().optional().describe('only settings whose source is not the default'),
});
export type SettingsGetInput = z.infer<typeof SettingsGetInputSchema>;
export const SettingsGetOutputSchema = z.strictObject({
  machines: z.array(
    DataMachineSchema.extend({
      withheld: z.number().int().nonnegative(),
      pathsHidden: z.number().int().nonnegative(),
      settings: z.array(
        SettingSchema.extend({
          key: z.string(),
          /** True when the source is not `default`. */
          changed: z.boolean(),
        })
      ),
    })
  ),
});
export type SettingsGetOutput = z.infer<typeof SettingsGetOutputSchema>;
