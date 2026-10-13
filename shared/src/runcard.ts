import { z } from 'zod';
import { MachineIdentitySchema } from './snapshot.js';

/**
 * Run card R2: what a rig is waiting on David for, read-only. The hub scans the handoff messages it
 * already holds for FliStudio gate ids (`g_` + 10 hex) and returns those the rig's newest mention
 * still calls open, with a link only when a handoff carried one (never built or guessed). It also
 * returns the machine's ssh address from AppyRig's own config, so the screen can show a copyable
 * attach line. AppyRig never acts on any of it.
 */

const isoDate = z.iso.datetime({ offset: true });

export const GATE_ID = /\bg_[0-9a-f]{10}\b/g;

export const RigWaitingInputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id.describe('machine id, e.g. m4'),
  rig: z.string().min(1).describe('rig name, e.g. ylo-d10'),
});
export type RigWaitingInput = z.infer<typeof RigWaitingInputSchema>;

export const RigGateSchema = z.strictObject({
  gate: z.string().regex(/^g_[0-9a-f]{10}$/),
  /** The handoff whose message last mentioned it (and called it open). */
  itemId: z.string(),
  at: isoDate,
  from: z.string().nullable(),
  to: z.string().nullable(),
  /** The words around the mention, so the screen can show why it reads as open. */
  context: z.string(),
  /** A FliStudio link a handoff carried for this gate (prefers a Tailscale address); null: none did. */
  link: z.string().nullable(),
});
export type RigGate = z.infer<typeof RigGateSchema>;

export const RigWaitingOutputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id,
  rig: z.string(),
  /** `user@host` from AppyRig config `machines.<id>.ssh`; null: not configured. */
  ssh: z.string().nullable(),
  gates: z.array(RigGateSchema),
  /** Handoffs of the rig whose message the hub holds, and those it does not (scanned by summary only). */
  scanned: z.number().int().nonnegative(),
  bodiesMissing: z.number().int().nonnegative(),
});
export type RigWaitingOutput = z.infer<typeof RigWaitingOutputSchema>;
