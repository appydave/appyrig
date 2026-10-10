import { z } from 'zod';
import { MachineIdentitySchema } from './snapshot.js';

/**
 * v1.2 · seat history: what an OpenRig seat said and did, for the Handoff Flow replay's consoles.
 *
 * Source: the seat's own Claude Code transcript (`~/.claude/projects/<cwd>/<session>.jsonl`), found
 * by its first line, `{"type":"custom-title","customTitle":"<seat>@<rig>"}`, which OpenRig sets with
 * `claude --name`. So only OpenRig seats are ever read, never a person's own sessions. Reading the
 * file has no side effect; OpenRig's transcript route (which can start a capture) is still never
 * called (AC 4).
 *
 * Kept: prompts typed into the seat (handoff nudges included), the agent's replies, and tool calls
 * as one-line summaries. Dropped: tool results and thinking. Every text is redacted and cut short.
 */

export const HISTORY_MAX_EVENTS = 1500;
export const HISTORY_TEXT_MAX = 280;

const isoDate = z.iso.datetime({ offset: true });

export const SeatHistoryKindSchema = z.enum(['prompt', 'reply', 'tool']);
export type SeatHistoryKind = z.infer<typeof SeatHistoryKindSchema>;

export const SeatHistoryEventSchema = z.strictObject({
  at: isoDate,
  kind: SeatHistoryKindSchema,
  text: z.string().max(HISTORY_TEXT_MAX),
});
export type SeatHistoryEvent = z.infer<typeof SeatHistoryEventSchema>;

/** collector → hub, one seat at a time, only when its transcript changed. */
export const SeatHistorySchema = z.strictObject({
  machineId: MachineIdentitySchema.shape.id,
  /** The seat id as OpenRig names it, e.g. `dev-hub@appyrig-build`. */
  seat: z.string().min(1),
  collectedAt: isoDate,
  /** Events kept from the end of the transcript, oldest first. */
  events: z.array(SeatHistoryEventSchema).max(HISTORY_MAX_EVENTS),
  /** True when older events were dropped to stay under HISTORY_MAX_EVENTS. */
  truncated: z.boolean(),
});
export type SeatHistory = z.infer<typeof SeatHistorySchema>;

// ── the seat.history verb ──────────────────────────────────────────────────────────────────────

export const SeatHistoryInputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id.describe('machine id, e.g. m2'),
  seat: z.string().min(1).describe('seat id, e.g. dev-hub@appyrig-build'),
});
export type SeatHistoryInput = z.infer<typeof SeatHistoryInputSchema>;

export const SeatHistoryOutputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id,
  seat: z.string(),
  /** False when no collector has sent history for this seat (not an OpenRig Claude seat, or not yet). */
  available: z.boolean(),
  collectedAt: isoDate.nullable(),
  truncated: z.boolean(),
  events: z.array(SeatHistoryEventSchema).max(HISTORY_MAX_EVENTS),
});
export type SeatHistoryOutput = z.infer<typeof SeatHistoryOutputSchema>;
