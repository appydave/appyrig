import { z } from 'zod';
import { AccountDerivedSchema } from './accounts.js';
import {
  FleetMachineSchema,
  LivenessSchema,
  MachineIdentitySchema,
  QUEUE_MAX_ITEMS,
  QueueItemSchema,
  RigSummarySchema,
  SeatSchema,
  SeatStatusSchema,
  SourceHealthSchema,
  TAIL_MAX_LINES,
} from './snapshot.js';

/**
 * Input and output schemas of the v1 API verbs (P4, hub lane). Every verb is read-only.
 *
 * The capability contracts (who may call, refusals, side effects) and the handlers live in the
 * hub, `server/src/core/verbs.ts`; these schemas are here so the UI can type what it asks for and
 * gets back. Every door (Socket.IO `core:call`, `POST /v1/rpc`, `POST /v1/call`, the CLI, the
 * console) answers with the same shapes.
 */

const MachineId = MachineIdentitySchema.shape.id;
const isoDate = z.iso.datetime({ offset: true });

// ── inputs ─────────────────────────────────────────────────────────────────────────────────────

export const NoInputSchema = z.strictObject({});

export const SeatListInputSchema = z.strictObject({
  machine: MachineId.optional().describe('only this machine'),
  rig: z.string().min(1).optional().describe('only seats of this rig'),
  status: SeatStatusSchema.optional().describe('only seats in this state, e.g. blocked'),
});
export type SeatListInput = z.infer<typeof SeatListInputSchema>;

export const SeatRefSchema = z.strictObject({
  machine: MachineId.describe('machine id, e.g. m2'),
  seat: z.string().min(1).describe('seat id, e.g. dev-hub@appyrig-build'),
});
export type SeatRef = z.infer<typeof SeatRefSchema>;

export const SeatTailInputSchema = SeatRefSchema.extend({
  lines: z
    .number()
    .int()
    .min(1)
    .max(TAIL_MAX_LINES)
    .optional()
    .describe(`last N lines, at most ${TAIL_MAX_LINES} (default 50)`),
});
export type SeatTailInput = z.infer<typeof SeatTailInputSchema>;

export const QueueListInputSchema = z.strictObject({
  machine: MachineId.optional().describe('only this machine'),
  state: z.string().min(1).optional().describe('only rows in this state, e.g. pending'),
  destination: z.string().min(1).optional().describe('only rows sent to this seat'),
  limit: z.number().int().min(1).max(QUEUE_MAX_ITEMS).optional().describe('most recent N'),
});
export type QueueListInput = z.infer<typeof QueueListInputSchema>;

export const MachineFilterSchema = z.strictObject({
  machine: MachineId.optional().describe('only this machine'),
  rig: z.string().min(1).optional().describe('only this rig'),
});
export type MachineFilter = z.infer<typeof MachineFilterSchema>;

// ── outputs ────────────────────────────────────────────────────────────────────────────────────

/** Where a seat lives and whether that machine is still reporting. */
const SeatPlace = {
  machine: MachineId,
  liveness: LivenessSchema,
  lastSeen: isoDate,
};

export const FleetGetOutputSchema = z.strictObject({
  generatedAt: isoDate,
  machines: z.array(FleetMachineSchema),
});
export type FleetGetOutput = z.infer<typeof FleetGetOutputSchema>;

export const MachineSummarySchema = z.strictObject({
  machine: MachineIdentitySchema,
  liveness: LivenessSchema,
  lastSeen: isoDate,
  collectedAt: isoDate,
  sources: z.strictObject({
    daemon: SourceHealthSchema,
    tmux: SourceHealthSchema,
    viewer: SourceHealthSchema,
  }),
  rigCount: z.number().int().nonnegative(),
  seatCount: z.number().int().nonnegative(),
  seatsByStatus: z.record(SeatStatusSchema, z.number().int().nonnegative()),
});
export type MachineSummary = z.infer<typeof MachineSummarySchema>;

/** A seat without its terminal text (use seat.get or seat.tail for that). */
export const SeatSummarySchema = z.strictObject({
  ...SeatPlace,
  seat: SeatSchema.omit({ tail: true }),
});
export type SeatSummary = z.infer<typeof SeatSummarySchema>;

export const SeatGetOutputSchema = z.strictObject({ ...SeatPlace, seat: SeatSchema });
export type SeatGetOutput = z.infer<typeof SeatGetOutputSchema>;

export const SeatTailOutputSchema = z.strictObject({
  ...SeatPlace,
  seat: z.string(),
  /** False when the collector sent no terminal text for this seat (e.g. it is stopped). */
  available: z.boolean(),
  lines: z.array(z.string()).max(TAIL_MAX_LINES),
  ansi: z.boolean(),
  capturedAt: isoDate.nullable(),
});
export type SeatTailOutput = z.infer<typeof SeatTailOutputSchema>;

export const QueueRowSchema = z.strictObject({ machine: MachineId, item: QueueItemSchema });
export type QueueRow = z.infer<typeof QueueRowSchema>;

/** One routed piece of work as an edge: from the seat that sent it to the seat that owns it. */
export const HandoffSchema = z.strictObject({
  machine: MachineId,
  id: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  state: z.string(),
  tags: z.array(z.string()),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export type Handoff = z.infer<typeof HandoffSchema>;

export const RigTopologySchema = z.strictObject({
  machine: MachineId,
  liveness: LivenessSchema,
  rig: RigSummarySchema,
  pods: z.array(
    z.strictObject({
      pod: z.string().nullable(),
      seats: z.array(
        z.strictObject({
          id: z.string(),
          logicalId: z.string().nullable(),
          runtime: z.string().nullable(),
          status: SeatStatusSchema,
        })
      ),
    })
  ),
});
export type RigTopology = z.infer<typeof RigTopologySchema>;

/** v1 has no account config: `configured: false` says so, rather than an empty list that could mean "none". */
export const AccountListOutputSchema = z.strictObject({
  /** True once any machine reports a Claude account. False = none has (so an empty list means "no data", not "no accounts"). */
  configured: z.boolean(),
  accounts: z.array(
    AccountDerivedSchema.extend({
      /** The account's email, as machines report it (compared case-insensitively). */
      email: z.string(),
      /** Plan type as the login record names it (`claude_max`, …); the Max tier is in `tier`. */
      plan: z.string().nullable(),
      /** Every machine currently signed into this account, read from each machine's last push. */
      machines: z.array(MachineId),
      /** The machine whose sampler reading the windows come from (the freshest); null with no reading anywhere. */
      readingFrom: MachineId.nullable(),
    })
  ),
  /** Machines that reported no account at all (no login, an old collector, or asleep without ever pushing one). */
  unreported: z.array(MachineId),
});
export type AccountListOutput = z.infer<typeof AccountListOutputSchema>;

/** v1 records no history: `recorded: false` says so. */
export const HistoryListOutputSchema = z.strictObject({
  recorded: z.boolean(),
  entries: z.array(z.unknown()),
});
export type HistoryListOutput = z.infer<typeof HistoryListOutputSchema>;

export const SystemStatusOutputSchema = z.strictObject({
  app: z.string(),
  version: z.string(),
  startedAt: isoDate,
  now: isoDate,
  asleepAfterMs: z.number().int().positive(),
  machines: z.strictObject({
    total: z.number().int().nonnegative(),
    live: z.number().int().nonnegative(),
    asleep: z.number().int().nonnegative(),
  }),
  verbs: z.number().int().nonnegative(),
});
export type SystemStatusOutput = z.infer<typeof SystemStatusOutputSchema>;

// ── the call envelope, as every door answers ───────────────────────────────────────────────────

export const RefusalSchema = z.strictObject({
  failureMode: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type Refusal = z.infer<typeof RefusalSchema>;

export type CallAnswer<T = unknown> = { ok: true; value: T } | { ok: false; error: Refusal };

/** Payload of the browser socket's `core:call` (and the body of `POST /v1/call`). */
export interface CoreCallRequest {
  verb: string;
  input?: unknown;
  dryRun?: boolean;
}
