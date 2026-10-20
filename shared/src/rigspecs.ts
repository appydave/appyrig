import { z } from 'zod';
import { DataMachineSchema } from './daemondata.js';
import { MemberViewSchema } from './loadout.js';
import {
  MachineIdentitySchema,
  RIG_EDGES_MAX,
  RIG_PODS_MAX,
  RIG_SUMMARY_MAX,
  RigPodSchema,
  RigSpecViewSchema,
} from './snapshot.js';
import * as OpenRig from './openrig/index.js';

/**
 * N10: every rig spec a collector found on its machine, launched or not, and the machine's log of
 * `rig` commands. Two side channels, each sent ONLY to a hub that advertised its cap
 * (HUB_CAPS.RIG_SPECS, HUB_CAPS.RIG_COMMANDS): an older hub never sees them, and nothing that V1 or
 * V2 already reads changes shape. Read-only end to end: the collector reads files, the hub keeps the
 * latest push per machine in memory, the browser asks with a read verb.
 *
 * A spec whose `name:` matches a rig OpenRig knows on that machine is "launched"; the hub works that
 * out from the machine's own snapshot, so the collector never guesses it.
 */

const isoDate = z.iso.datetime({ offset: true });
const MachineId = MachineIdentitySchema.shape.id;

// ── rig specs ──────────────────────────────────────────────────────────────────────────────────

/** Most rig specs one machine sends. */
export const RIG_SPECS_MAX = 100;
/** Most AgentSpecs listed per rig spec. */
export const RIG_SPEC_AGENTS_MAX = 20;

/** A member of a pod as rig.yaml writes it, plus the session name OpenRig gives it (`orch-lead@rig`). */
export const SpecSeatSchema = MemberViewSchema.extend({
  session: z.string().min(1).max(200),
});
export type SpecSeat = z.infer<typeof SpecSeatSchema>;

/** A pod of a rig spec: the snapshot's pod shape plus its members in full. */
export const SpecPodSchema = RigPodSchema.extend({
  seats: z.array(SpecSeatSchema).max(200),
});
export type SpecPod = z.infer<typeof SpecPodSchema>;

/**
 * One AgentSpec (agent.yaml) a rig spec's members point at through `agent_ref`.
 *  ok        read and valid; `spec` holds it
 *  invalid   read, but OpenRig would refuse it
 *  missing   no agent.yaml where the ref points
 *  refused   the ref leads outside the rig's folder (or the configured spec folder), so it is not read
 *  builtin   `builtin:terminal`: there is no file
 */
export const SpecAgentSchema = z.strictObject({
  /** The agent_ref as written (`local:agents/spaghetti`). */
  ref: z.string().min(1).max(500),
  status: z.enum(['ok', 'invalid', 'missing', 'refused', 'builtin']),
  /** The members (`pod.member`) that use it. */
  usedBy: z.array(z.string().min(1).max(200)).max(200),
  spec: OpenRig.AgentSpecSchema.pick({
    name: true,
    version: true,
    description: true,
    summary: true,
    defaults: true,
  })
    .extend({ profiles: z.record(z.string(), OpenRig.AgentProfileSchema) })
    .nullable(),
});
export type SpecAgent = z.infer<typeof SpecAgentSchema>;

export const RigSpecEntrySchema = z.strictObject({
  name: z.string().min(1).max(200),
  /** Absolute path of the rig.yaml on the collector's disk. */
  specPath: z.string().min(1).max(1024),
  summary: z.string().max(RIG_SUMMARY_MAX).nullable(),
  /** The file passes OpenRig's RigSpec schema. false: pods / edges / agents are left out. */
  specValid: z.boolean(),
  pods: z.array(SpecPodSchema).max(RIG_PODS_MAX).optional(),
  specEdges: z.array(OpenRig.CrossPodEdgeSchema).max(RIG_EDGES_MAX).optional(),
  rigSpec: RigSpecViewSchema.optional(),
  agents: z.array(SpecAgentSchema).max(RIG_SPEC_AGENTS_MAX).optional(),
});
export type RigSpecEntry = z.infer<typeof RigSpecEntrySchema>;

/** collector → hub: every spec found on the machine; replaces what the hub held for it. */
export const RigSpecsPushSchema = z.strictObject({
  machineId: MachineId,
  collectedAt: isoDate,
  specs: z.array(RigSpecEntrySchema).max(RIG_SPECS_MAX),
});
export type RigSpecsPush = z.infer<typeof RigSpecsPushSchema>;

// ── rig commands ───────────────────────────────────────────────────────────────────────────────

/** Most command entries a collector keeps and sends (the newest). */
export const RIG_COMMANDS_MAX = 200;
export const RIG_COMMAND_TEXT_MAX = 400;
export const RIG_COMMAND_RAW_MAX = 600;
export const RIG_COMMAND_OUTPUT_MAX = 600;

const TextN = (max: number) => z.string().max(max).nullable();

/**
 * One `rig` command as the machine's hook logged it (~/.appyrig/rig-commands.jsonl), redacted and cut
 * by the collector. A command's "attempted" line and its result line are folded into one entry.
 * The Claude session id and tool-use id are never sent.
 */
export const RigCommandSchema = z.strictObject({
  ts: isoDate,
  /** `claude` or `david`, as logged. */
  actor: TextN(60),
  /** `local`, or the host the command was sent to. */
  targetHost: TextN(120),
  command: TextN(RIG_COMMAND_TEXT_MAX),
  /** The whole shell line it came from. */
  raw: TextN(RIG_COMMAND_RAW_MAX),
  /** The rig the hook attributed it to (null for fleet-wide commands). */
  rig: TextN(200),
  /** Every rig the line's commands name. */
  rigs: z.array(z.string().min(1).max(200)).max(10),
  cwd: TextN(400),
  /** `attempted`, `ran`, `failed`, `denied`… as logged. */
  phase: TextN(40),
  exitCode: z.number().int().nullable(),
  interrupted: z.boolean().nullable(),
  stdoutHead: TextN(RIG_COMMAND_OUTPUT_MAX),
  stderrHead: TextN(RIG_COMMAND_OUTPUT_MAX),
});
export type RigCommand = z.infer<typeof RigCommandSchema>;

/** collector → hub: the newest commands, oldest first; replaces what the hub held for the machine. */
export const RigCommandsPushSchema = z.strictObject({
  machineId: MachineId,
  collectedAt: isoDate,
  /** False when the machine has no command log (that is not the same as an empty one). */
  fileFound: z.boolean(),
  entries: z.array(RigCommandSchema).max(RIG_COMMANDS_MAX),
});
export type RigCommandsPush = z.infer<typeof RigCommandsPushSchema>;

// ── verbs ──────────────────────────────────────────────────────────────────────────────────────

export const RigSpecsInputSchema = z.strictObject({
  machine: MachineId.optional().describe('only this machine'),
});
export type RigSpecsInput = z.infer<typeof RigSpecsInputSchema>;

export const RigSpecsOutputSchema = z.strictObject({
  machines: z.array(DataMachineSchema),
  specs: z.array(
    RigSpecEntrySchema.extend({
      machine: MachineId,
      /** OpenRig on that machine knows a rig of this name (it has been launched). */
      launched: z.boolean(),
      /** That rig's status as OpenRig reports it (`running`, `stopped`…); null for a draft. */
      rigStatus: z.string().nullable(),
      /**
       * Every machine whose OpenRig knows a rig of this name, with its status: a spec found on one
       * machine (a synced folder) may be launched on another. Empty = launched nowhere.
       */
      launchedOn: z.array(z.strictObject({ machine: MachineId, status: z.string() })),
    })
  ),
});
export type RigSpecsOutput = z.infer<typeof RigSpecsOutputSchema>;

export const RigCommandsInputSchema = z.strictObject({
  machine: MachineId.optional().describe('only this machine'),
  rig: z.string().min(1).optional().describe('only commands that name this rig'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(RIG_COMMANDS_MAX)
    .optional()
    .describe(`newest N (default ${RIG_COMMANDS_MAX})`),
});
export type RigCommandsInput = z.infer<typeof RigCommandsInputSchema>;

export const RigCommandsOutputSchema = z.strictObject({
  machines: z.array(DataMachineSchema.extend({ fileFound: z.boolean().nullable() })),
  /** Newest first. */
  commands: z.array(RigCommandSchema.extend({ machine: MachineId })),
});
export type RigCommandsOutput = z.infer<typeof RigCommandsOutputSchema>;

/** True when a command entry names this rig (its own rig, or any of its commands'). */
export function commandNamesRig(c: Pick<RigCommand, 'rig' | 'rigs'>, rig: string): boolean {
  return c.rig === rig || c.rigs.includes(rig);
}
