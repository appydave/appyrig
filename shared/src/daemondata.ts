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

/**
 * Longest text a field may hold, by size tier (a tier says how long, not what the field is: a field
 * takes the tier its data needs). TEXT_PATH_MAX is the one field-true name: every use is a file path.
 * The schema below and the collector's trimming read the same names, so a value the collector cuts
 * always fits the schema that checks it.
 */
export const TEXT_TINY_MAX = 40;
export const TEXT_SHORT_MAX = 60;
export const TEXT_SMALL_MAX = 80;
export const TEXT_MEDIUM_MAX = 100;
export const TEXT_LONG_MAX = 120;
export const TEXT_XLONG_MAX = 200;
export const TEXT_XXLONG_MAX = 300;
export const TEXT_XXXLONG_MAX = 400;
export const TEXT_PATH_MAX = 500;

const Text = (max: number) => z.string().max(max);
const TextN = (max: number) => z.string().max(max).nullable();

// ── seatdetail ────────────────────────────────────────────

export const SeatDetailDataSchema = z.strictObject({
  spec: z
    .strictObject({
      name: TextN(TEXT_LONG_MAX),
      version: TextN(TEXT_SHORT_MAX),
      profile: TextN(TEXT_LONG_MAX),
      hash: TextN(TEXT_LONG_MAX),
    })
    .nullable(),
  startupFiles: z
    .array(
      z.strictObject({
        path: Text(TEXT_XXXLONG_MAX),
        deliveryHint: TextN(TEXT_SHORT_MAX),
        required: z.boolean().nullable(),
        appliesOn: z.array(Text(TEXT_SHORT_MAX)).max(10),
      })
    )
    .max(60),
  startupActions: z
    .array(
      z.strictObject({
        type: Text(TEXT_SHORT_MAX),
        phase: TextN(TEXT_SHORT_MAX),
        /** The text the action sends, redacted and cut; null when the action sends none. */
        text: TextN(TEXT_XXXLONG_MAX),
      })
    )
    .max(60),
  peers: z
    .array(
      z.strictObject({
        logicalId: Text(TEXT_XLONG_MAX),
        session: TextN(TEXT_XLONG_MAX),
        runtime: TextN(TEXT_SHORT_MAX),
      })
    )
    .max(60),
  /** The daemon's recovery guidance notes (plain words). Never the resume token. */
  recoveryNotes: z.array(Text(TEXT_XXLONG_MAX)).max(10),
  installedResources: z
    .array(z.strictObject({ id: Text(TEXT_XLONG_MAX), category: TextN(TEXT_SMALL_MAX) }))
    .max(60),
});
export type SeatDetailData = z.infer<typeof SeatDetailDataSchema>;

// ── library ───────────

export const LIBRARY_ROWS_MAX = 300;
export const LIBRARY_FILES_MAX = 30;

const FactValue = z.union([z.string().max(TEXT_XLONG_MAX), z.number(), z.boolean(), z.null()]);

/** One library row, the same shape for specs, skills and context packs. */
export const LibraryRowSchema = z.strictObject({
  id: Text(TEXT_XXLONG_MAX),
  kind: TextN(TEXT_SHORT_MAX),
  name: Text(TEXT_XLONG_MAX),
  version: TextN(TEXT_SHORT_MAX),
  sourceType: TextN(TEXT_SHORT_MAX),
  summary: TextN(TEXT_XXXLONG_MAX),
  /** Where it lives on that machine's disk (shown as text, never opened). */
  path: TextN(TEXT_PATH_MAX),
  updatedAt: TextN(TEXT_SHORT_MAX),
  /** Group-specific facts: spec (rolesCount, stepsCount, targetRig, …), skill (fileCount, totalBytes), pack (taxonomy, tokens). */
  facts: z.record(z.string().max(TEXT_SHORT_MAX), FactValue),
  /** Skill file names and sizes (library.get only; library.list leaves them out). */
  files: z
    .array(
      z.strictObject({
        name: Text(TEXT_XLONG_MAX),
        size: z.number().int().nonnegative().nullable(),
      })
    )
    .max(LIBRARY_FILES_MAX),
});
export type LibraryRow = z.infer<typeof LibraryRowSchema>;

/** Each list is null when that endpoint could not be read this round (kept apart from an empty list). */
export const LibraryDataSchema = z.strictObject({
  openrigVersion: TextN(TEXT_SHORT_MAX),
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
  qitemId: Text(TEXT_XLONG_MAX),
  at: isoDate,
  state: Text(TEXT_SHORT_MAX),
  actor: TextN(TEXT_XLONG_MAX),
  closureReason: TextN(TEXT_XLONG_MAX),
  closureTarget: TextN(TEXT_XLONG_MAX),
});
export type TransitionRow = z.infer<typeof TransitionRowSchema>;

export const TransitionsDataSchema = z.strictObject({
  /** Oldest to newest. */
  rows: z.array(TransitionRowSchema).max(TRANSITIONS_MAX),
  /** Rows the daemon had when last read (the collector keeps the newest TRANSITIONS_MAX). */
  retained: z.number().int().nonnegative().nullable(),
  truncated: z.boolean(),
  hostId: TextN(TEXT_MEDIUM_MAX),
  bootEpoch: TextN(TEXT_MEDIUM_MAX),
});
export type TransitionsData = z.infer<typeof TransitionsDataSchema>;

// ── workflows ────────────────────────────────────

export const WorkflowSpecSchema = z.strictObject({
  name: Text(TEXT_XLONG_MAX),
  version: TextN(TEXT_SHORT_MAX),
  purpose: TextN(TEXT_XXXLONG_MAX),
  targetRig: TextN(TEXT_XLONG_MAX),
  terminalTurnRule: TextN(TEXT_MEDIUM_MAX),
  isBuiltIn: z.boolean().nullable(),
});
export type WorkflowSpec = z.infer<typeof WorkflowSpecSchema>;

export const WorkflowInstanceSchema = z.strictObject({
  instanceId: Text(TEXT_XLONG_MAX),
  workflowName: TextN(TEXT_XLONG_MAX),
  workflowVersion: TextN(TEXT_SHORT_MAX),
  status: TextN(TEXT_SHORT_MAX),
  currentStepId: TextN(TEXT_XLONG_MAX),
  hopCount: z.number().int().nonnegative().nullable(),
  createdAt: TextN(TEXT_SHORT_MAX),
  completedAt: TextN(TEXT_SHORT_MAX),
  deadlineState: TextN(TEXT_SHORT_MAX),
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
  id: Text(TEXT_XLONG_MAX),
  detector: TextN(TEXT_LONG_MAX),
  severity: TextN(TEXT_SHORT_MAX),
  summary: TextN(TEXT_XXXLONG_MAX),
  evaluatedAt: TextN(TEXT_SHORT_MAX),
});
export type HealthFinding = z.infer<typeof HealthFindingSchema>;

export const HealthCoverageSchema = z.strictObject({
  source: Text(TEXT_LONG_MAX),
  unit: TextN(TEXT_LONG_MAX),
  evaluated: z.number().nonnegative().nullable(),
  total: z.number().nonnegative().nullable(),
  omitted: z.number().nonnegative().nullable(),
  partial: z.boolean().nullable(),
  evaluatedAt: TextN(TEXT_SHORT_MAX),
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
      disabledDetectors: z.array(Text(TEXT_LONG_MAX)).max(40),
      detectors: z.array(Text(TEXT_LONG_MAX)).max(40),
      thresholds: z.record(z.string().max(TEXT_SHORT_MAX), z.number()),
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
      verdict: TextN(TEXT_SHORT_MAX),
      red: z.number().int().nonnegative().nullable(),
      yellow: z.number().int().nonnegative().nullable(),
      green: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  daemon: z
    .strictObject({
      semver: TextN(TEXT_SHORT_MAX),
      commit: TextN(TEXT_SHORT_MAX),
      eventLoopLagP99Ms: z.number().nonnegative().nullable(),
    })
    .nullable(),
});
export type HealthData = z.infer<typeof HealthDataSchema>;

/**
 * Every reason an empty findings list is NOT all-clear, from the health data alone. One function,
 * used by the hub's `health.findings` (assess) and by the v2 Health page, so both say the same
 * words. Empty means: diagnosis is on, detectors are listed and enabled, and every coverage source
 * evaluated all it had.
 */
export function healthCaveats(d: HealthData): string[] {
  const out: string[] = [];
  const p = d.policy;
  if (p === null) {
    out.push('the health policy could not be read: cannot tell whether detectors run');
  } else {
    if (p.diagnosisEnabled === false) {
      out.push(
        'diagnosis is off on this daemon: its scheduled detectors do not run, so an empty list proves nothing'
      );
    } else if (p.diagnosisEnabled === null) {
      out.push('the policy did not say whether diagnosis is on');
    }
    if (p.detectors.length === 0) {
      out.push('the policy lists no detectors: nothing is known to have run');
    } else if (p.detectors.every((x) => p.disabledDetectors.includes(x))) {
      out.push('every detector the policy lists is disabled');
    }
  }
  if (d.coverage.length === 0) {
    out.push('no coverage was reported: cannot tell what was evaluated');
  }
  for (const c of d.coverage) {
    const unit = c.unit ? ` ${c.unit}` : '';
    if (c.partial === true) {
      out.push(`coverage of ${c.source} was partial`);
    }
    if (c.evaluated === null || c.total === null) {
      out.push(`coverage of ${c.source} did not say how much was evaluated`);
    } else if (c.evaluated === 0) {
      out.push(`${c.source} evaluated 0${unit}: nothing was examined`);
    } else if (c.evaluated < c.total && c.partial !== true) {
      out.push(`${c.source} evaluated ${c.evaluated} of ${c.total}${unit}`);
    }
  }
  if (d.findingsTruncated === true) {
    out.push('the findings list was cut short');
  }

  return out;
}

// ── settings ─────────────────────────────────────────────────────────────────

const SettingValue = z.union([z.string().max(TEXT_XLONG_MAX), z.number(), z.boolean(), z.null()]);

export const SettingSchema = z.strictObject({
  value: SettingValue,
  source: TextN(TEXT_TINY_MAX),
  defaultValue: SettingValue,
});
export type Setting = z.infer<typeof SettingSchema>;

export const SettingsDataSchema = z.strictObject({
  settings: z.record(z.string().max(TEXT_LONG_MAX), SettingSchema),
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
  /**
   * `unsupported` = the daemon has no such route (a 404 on the route itself); `not-found` = the
   * route exists but the daemon does not know this item (a 404 on one seat). data is null for both.
   */
  status: z.enum(['ok', 'unsupported', 'not-found']),
  reason: TextN(TEXT_XXLONG_MAX),
};

const push = <K extends DaemonKind, D extends z.ZodType>(kind: K, data: D) =>
  z.strictObject({
    kind: z.literal(kind),
    ...PushBase,
    /** seatdetail: the seat id; every other kind: exactly the empty string. */
    key: kind === 'seatdetail' ? z.string().min(1).max(TEXT_XLONG_MAX) : z.literal(''),
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
  reason: TextN(TEXT_XXLONG_MAX),
  collectedAt: isoDate.nullable(),
});
export type DataMachine = z.infer<typeof DataMachineSchema>;

// seat.detail
export const SeatDetailInputSchema = SeatRefSchema;
export const SeatDetailOutputSchema = z.strictObject({
  machine: MachineId,
  seat: z.string(),
  status: DataStatusSchema.or(z.enum(['not-openrig', 'seat-not-found'])),
  reason: TextN(TEXT_XXLONG_MAX),
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
  text: z
    .string()
    .min(1)
    .max(TEXT_XLONG_MAX)
    .optional()
    .describe('substring of name, id or summary'),
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
      openrigVersion: TextN(TEXT_SHORT_MAX),
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
    .regex(/^[A-Za-z0-9_-]{1,400}$/)
    .optional()
    .describe(
      'cursor: the nextCursor of the previous page. A keyset (the last row of that page), so rows added between pages never shift or repeat a page'
    ),
});
export type HistoryTransitionsInput = z.infer<typeof HistoryTransitionsInputSchema>;

export const HistoryTransitionRowSchema = TransitionRowSchema.extend({
  machine: MachineId,
  /** From the machine's last queue snapshot, when the item is still in it. */
  source: TextN(TEXT_XLONG_MAX),
  destination: TextN(TEXT_XLONG_MAX),
  summary: TextN(TEXT_XLONG_MAX),
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
export const HealthFindingsInputSchema = MachineFilter;
export type HealthFindingsInput = z.infer<typeof HealthFindingsInputSchema>;
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
