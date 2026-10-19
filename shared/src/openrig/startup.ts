import { z } from 'zod';

/**
 * OpenRig startup blocks, as AUTHORED in YAML (snake_case keys). A startup block can sit on an
 * AgentSpec, an AgentSpec profile, a RigSpec, a pod and a member; OpenRig merges them additively
 * in STARTUP_LAYERS order.
 *
 * Mirrors: OpenRig `packages/daemon/src/domain/types.ts` (StartupFile, StartupAction, StartupBlock;
 * camelCase after normalisation) and `packages/daemon/src/domain/startup-validation.ts` (the YAML
 * keys and allowed values). Doc: `docs/reference/rig-spec.md` "Startup Block".
 */

export const DELIVERY_HINTS = ['auto', 'guidance_merge', 'skill_install', 'send_text'] as const;
export const DeliveryHintSchema = z.enum(DELIVERY_HINTS);
export type DeliveryHint = z.infer<typeof DeliveryHintSchema>;

export const APPLIES_ON = ['fresh_start', 'restore'] as const;
export const AppliesOnSchema = z.enum(APPLIES_ON);
export type AppliesOn = z.infer<typeof AppliesOnSchema>;

/** One startup file. `path` is a safe relative path (no `..`, not absolute). */
export const StartupFileSchema = z.object({
  path: z.string().min(1),
  /** `role` marks the per-seat role file (read by `rig queue whoami --json` and refocus). */
  orientation: z.literal('role').optional(),
  /** Startup artifacts are files; OpenRig defaults this to `file`. */
  kind: z.literal('file').optional(),
  /** Default `auto`. */
  delivery_hint: DeliveryHintSchema.optional(),
  /** Default true: startup fails when the file cannot be delivered. */
  required: z.boolean().optional(),
  /** Default both. */
  applies_on: z.array(AppliesOnSchema).optional(),
});
export type StartupFile = z.infer<typeof StartupFileSchema>;

export const STARTUP_ACTION_TYPES = ['slash_command', 'send_text', 'startup_proof'] as const;

/** One startup action. `shell` is explicitly not supported by OpenRig. */
export const StartupActionSchema = z.object({
  type: z.enum(STARTUP_ACTION_TYPES),
  /** The command or text; for `startup_proof`, `authenticated` or `none`. */
  value: z.string(),
  /** Default `after_files`. */
  phase: z.enum(['after_files', 'after_ready']).optional(),
  /** Required by OpenRig. A non-idempotent action must not apply on `restore`. */
  idempotent: z.boolean(),
  applies_on: z.array(AppliesOnSchema).optional(),
});
export type StartupAction = z.infer<typeof StartupActionSchema>;

export const StartupBlockSchema = z.object({
  files: z.array(StartupFileSchema).optional(),
  actions: z.array(StartupActionSchema).optional(),
});
export type StartupBlock = z.infer<typeof StartupBlockSchema>;

/**
 * The order startup content reaches a seat (each layer appends; nothing replaces).
 * Doc: `docs/reference/agent-startup-guide.md` "The Layering Model". A member with a `starter_ref`
 * gets the starter's files in front of `agent`; terminal seats skip `agent` and `profile`.
 */
export const STARTUP_LAYERS = [
  'agent',
  'profile',
  'culture',
  'rig',
  'pod',
  'member',
  'operator',
] as const;
export type StartupLayer = (typeof STARTUP_LAYERS)[number];

/**
 * Files OpenRig itself adds (by logical name), from its own install, not from the rig's folder.
 * `CULTURE-default.md` leads the culture layer; the rest are the operator layer (the onboarding
 * pair only on a fresh start). Mirrors `packages/daemon/src/domain/builtin-startup-files.ts`.
 */
export const BUILTIN_STARTUP_FILES = [
  'CULTURE-default.md',
  'openrig-start.md',
  'openrig-onboarding-01.md',
  'openrig-onboarding-02.md',
] as const;
export type BuiltinStartupFile = (typeof BUILTIN_STARTUP_FILES)[number];
