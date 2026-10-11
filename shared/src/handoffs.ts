import { z } from 'zod';
import { MachineIdentitySchema } from './snapshot.js';
import { SeatHistoryOriginSchema } from './history.js';

/**
 * v1.4 · S4: what a handoff actually says, and where a rig's work entered.
 *
 * Queue bodies are too big to ride in every snapshot (a full queue is hundreds of KB of text) and
 * never change once written, so they travel on their own channel: the collector sends each body
 * once, when it first sees the item, and the hub keeps it. Same shape of idea as seat history.
 * A hub that predates this simply does not listen for the event; hub first, then collectors.
 */

export const HANDOFF_BODY_MAX = 4000;
export const HANDOFF_BATCH_MAX = 100;
/** Bodies kept per machine on the hub (oldest dropped first). */
export const HANDOFF_STORE_MAX = 1500;

const isoDate = z.iso.datetime({ offset: true });

/** collector → hub: bodies the hub has not been sent yet. Redacted and cut to HANDOFF_BODY_MAX. */
export const HandoffBodiesSchema = z.strictObject({
  machineId: MachineIdentitySchema.shape.id,
  collectedAt: isoDate,
  items: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        body: z.string().max(HANDOFF_BODY_MAX),
        /** True when the original was longer than HANDOFF_BODY_MAX. */
        truncated: z.boolean(),
      })
    )
    .max(HANDOFF_BATCH_MAX),
});
export type HandoffBodies = z.infer<typeof HandoffBodiesSchema>;

// ── the handoff.get verb ───────────────────────────────────────────────────────────────────────

export const HandoffGetInputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id.describe('machine id, e.g. m2'),
  id: z.string().min(1).describe('queue item id, e.g. qitem-20261011…'),
});
export type HandoffGetInput = z.infer<typeof HandoffGetInputSchema>;

export const HandoffGetOutputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id,
  id: z.string(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  state: z.string(),
  tags: z.array(z.string()),
  /** The row's own summary (a label), or null. */
  summary: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
  /** The full message, redacted. Null when the hub has not been sent it (see `bodyStatus`). */
  body: z.string().nullable(),
  /** `pending` = the collector has not sent this body yet (or it is an old collector): not the same as an empty message. */
  bodyStatus: z.enum(['present', 'pending']),
  bodyTruncated: z.boolean(),
});
export type HandoffGetOutput = z.infer<typeof HandoffGetOutputSchema>;

// ── the rig.entry verb ─────────────────────────────────────────────────────────────────────────

export const RigEntryInputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id.describe('machine id, e.g. m2'),
  rig: z.string().min(1).describe('rig name, e.g. flicut-reapply'),
});
export type RigEntryInput = z.infer<typeof RigEntryInputSchema>;

/**
 * Where a rig's work came in: the first seat of the rig to act (reply or tool call), and what woke
 * it, which is the latest prompt before that first action. `status`:
 *  - `outside-queue`  it was woken by its launch prompt, text typed in, or a direct message from another
 *                     seat, not through the queue (`entry` says which, when, and an excerpt if the prompt had text).
 *  - `via-queue`      it was woken by a nudge about a queued handoff.
 *  - `unknown`        not enough history to say (`reason` says why): no seat history, an older
 *                     collector (no `origin`), or older events were dropped.
 * A launch prompt is OpenRig's standard identity header plus the seat's role pack; neither is kept, so
 * `excerpt` is null for it. `seatsWithoutHistory` lists seats of the rig whose prompts cannot be seen
 * (stopped, not Claude, no transcript): one of those might have acted first, so a UI should say so.
 */
export const RigEntrySchema = z.strictObject({
  status: z.enum(['outside-queue', 'via-queue', 'unknown']),
  reason: z.string().nullable(),
  entry: z
    .strictObject({
      seat: z.string(),
      /** When the prompt that woke the seat arrived. */
      at: isoDate,
      /** When the seat first did something (reply or tool call). */
      actedAt: isoDate,
      origin: SeatHistoryOriginSchema,
      /** The waking prompt's text, redacted and cut short; null when it had none (a launch prompt). */
      excerpt: z.string().nullable(),
    })
    .nullable(),
  seatsWithoutHistory: z.array(z.string()),
});
export type RigEntry = z.infer<typeof RigEntrySchema>;

export const RigEntryOutputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id,
  rig: z.string(),
  entry: RigEntrySchema,
});
export type RigEntryOutput = z.infer<typeof RigEntryOutputSchema>;
