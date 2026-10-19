import { z } from 'zod';
import { StartupBlockSchema } from './startup.js';

/**
 * OpenRig's RigSpec (`rig.yaml`, version "0.2", pod-aware), as AUTHORED in YAML (snake_case).
 * The rig, its pods and its members (seats) are all defined in this one file: a pod has no file of
 * its own.
 *
 * Mirrors: OpenRig `packages/daemon/src/domain/types.ts` (RigSpec, RigSpecPod, RigSpecPodMember,
 * RigSpecPodEdge, RigSpecCrossPodEdge, WorkspaceSpec, RigServicesSpec, ContinuityPolicySpec,
 * SessionSourceSpec, StarterRefSpec) and `packages/daemon/src/domain/rigspec-schema.ts` (the YAML
 * keys). Doc: `docs/reference/rig-spec.md`.
 *
 * Rig, pod, member and edge objects are STRICT on purpose: OpenRig refuses a spec with an unknown
 * key at those levels (`rigspec-schema.ts` RIG_KEYS / POD_KEYS / MEMBER_KEYS / EDGE_KEYS,
 * `rejectUnknownTopologyKeys`). Deeper blocks are not proven strict and are plain objects.
 */

/** Doc: rig-spec.md "Edge Kinds". Mirrors `rigspec-schema.ts` VALID_EDGE_KINDS. */
export const EDGE_KINDS = [
  'delegates_to',
  'spawned_by',
  'can_observe',
  'collaborates_with',
  'escalates_to',
] as const;
export const EdgeKindSchema = z.enum(EDGE_KINDS);
export type EdgeKind = z.infer<typeof EdgeKindSchema>;

/** Within one pod: `from` / `to` are bare member ids (`build`, never `dev.build`). */
export const PodEdgeSchema = z.strictObject({
  kind: EdgeKindSchema,
  from: z.string().min(1),
  to: z.string().min(1),
});
export type PodEdge = z.infer<typeof PodEdgeSchema>;

/** Between pods: `from` / `to` are `pod.member`, in different pods. */
export const CrossPodEdgeSchema = z.strictObject({
  kind: EdgeKindSchema,
  from: z.string().regex(/^[^.@]+\.[^.@]+$/, 'pod.member'),
  to: z.string().regex(/^[^.@]+\.[^.@]+$/, 'pod.member'),
});
export type CrossPodEdge = z.infer<typeof CrossPodEdgeSchema>;

/** Mirrors `permission-policy/policy-ref.ts` BUILTIN_POLICY_NAMES. */
export const BUILTIN_POLICIES = ['locked', 'standard', 'open', 'yolo', 'auto'] as const;
/** `builtin:<name>`, a safe relative path to a policy file, or `none` (the floor, chosen). */
export const PermissionPolicyRefSchema = z.string().min(1);

/** Names match ^[A-Z_][A-Z0-9_]*$; `OPENRIG_*` is reserved. Values are not secret. */
export const SeatEnvSchema = z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().min(1));

export const RESTORE_POLICIES = [
  'resume_if_possible',
  'relaunch_fresh',
  'checkpoint_only',
] as const;
export const COMPACTION_STRATEGIES = [
  'default-compaction',
  'managed-compaction',
  'handover',
  'apprentice-handover',
] as const;
export const RUNTIMES = ['claude-code', 'codex', 'pi', 'omp', 'terminal', 'stub'] as const;

/** Mirrors types.ts SessionSourceSpec (fork | rebuild | agent_image). */
export const SessionSourceSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('fork'),
    ref: z.object({
      kind: z.enum(['native_id', 'artifact_path', 'name', 'last']),
      value: z.string().optional(),
    }),
  }),
  z.object({
    mode: z.literal('rebuild'),
    ref: z.object({ kind: z.literal('artifact_set'), value: z.array(z.string()).min(1) }),
  }),
  z.object({
    mode: z.literal('agent_image'),
    ref: z.object({
      kind: z.literal('image_name'),
      value: z.string(),
      version: z.string().optional(),
    }),
  }),
]);
export type SessionSource = z.infer<typeof SessionSourceSchema>;

/**
 * A pod member: one SEAT's spec. Its session name is `{pod}-{member}@{rig}` and its logical id
 * `{pod}.{member}`. What the seat is GIVEN (skills, guidance, role.md) comes from the AgentSpec its
 * `agent_ref` points at, with this member's `profile`.
 */
export const MemberSpecSchema = z.strictObject({
  id: z.string().regex(/^[^.@]+$/, 'no dots or @'),
  label: z.string().optional(),
  /** `local:<rel>` (from the rig root), `path:<abs>`, or `builtin:terminal`. */
  agent_ref: z.string().regex(/^(local:|path:|builtin:terminal$)/),
  /** An AgentSpec profile name (`default`), or `none` for a terminal node. */
  profile: z.string().min(1),
  runtime: z.string().min(1),
  codex_config_profile: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().optional(),
  role: z.string().optional(),
  permission_policy: PermissionPolicyRefSchema.optional(),
  env: SeatEnvSchema.optional(),
  /** Relative to the rig root; `~` and `$VAR` expand. */
  cwd: z.string().min(1),
  restore_policy: z.enum(RESTORE_POLICIES).optional(),
  /** Canonical names; OpenRig also accepts the deprecated aliases harness_native / pod_continuity. */
  compaction_strategy: z.string().optional(),
  /** A `seat@rig` address, for apprentice-handover. */
  mechanic: z.string().optional(),
  startup: StartupBlockSchema.optional(),
  session_source: SessionSourceSchema.optional(),
  starter_ref: z.object({ name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/) }).optional(),
});
export type MemberSpec = z.infer<typeof MemberSpecSchema>;

/** Validated and stored on the pod; OpenRig does not act on its triggers/artifacts yet (rig-spec.md). */
export const ContinuityPolicySchema = z.object({
  enabled: z.boolean(),
  sync_triggers: z
    .array(z.enum(['pre_compaction', 'pre_shutdown', 'manual', 'milestone']))
    .optional(),
  artifacts: z
    .object({
      session_log: z.boolean().optional(),
      restore_brief: z.boolean().optional(),
      quiz: z.boolean().optional(),
    })
    .optional(),
  restore_protocol: z
    .object({ peer_driven: z.boolean().optional(), verify_via_quiz: z.boolean().optional() })
    .optional(),
});
export type ContinuityPolicy = z.infer<typeof ContinuityPolicySchema>;

/** A POD: a bounded context of members. Doc: rig-spec.md "## Pod". */
export const PodSpecSchema = z.strictObject({
  id: z.string().regex(/^[^.@]+$/, 'no dots or @'),
  /** Required by OpenRig: the human name its UI groups by. */
  label: z.string(),
  summary: z.string().optional(),
  continuity_policy: ContinuityPolicySchema.optional(),
  /** The pod layer of startup, delivered to every member of this pod. */
  startup: StartupBlockSchema.optional(),
  members: z.array(MemberSpecSchema),
  edges: z.array(PodEdgeSchema).optional(),
});
export type PodSpec = z.infer<typeof PodSpecSchema>;

/** Mirrors types.ts WORKSPACE_KINDS. */
export const WORKSPACE_KINDS = ['user', 'project', 'knowledge', 'lab', 'delivery'] as const;

/** The rig's workspace (PL-007). Relative repo paths resolve against `workspace_root`. */
export const RigWorkspaceSchema = z.object({
  workspace_root: z.string().min(1),
  repos: z
    .array(
      z.object({ name: z.string().min(1), path: z.string().min(1), kind: z.enum(WORKSPACE_KINDS) })
    )
    .optional(),
  default_repo: z.string().optional(),
  knowledge_root: z.string().optional(),
});
export type RigWorkspace = z.infer<typeof RigWorkspaceSchema>;

/** Docker Compose services `rig up` boots before agents. Mirrors types.ts RigServicesSpec. */
export const RigServicesSchema = z.object({
  kind: z.literal('compose'),
  compose_file: z.string(),
  project_name: z.string().optional(),
  profiles: z.array(z.string()).optional(),
  down_policy: z.enum(['leave_running', 'down', 'down_and_volumes']).optional(),
  wait_for: z
    .array(
      z.object({
        service: z.string().optional(),
        condition: z.literal('healthy').optional(),
        url: z.string().optional(),
        tcp: z.string().optional(),
      })
    )
    .optional(),
  surfaces: z
    .object({
      urls: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
      commands: z.array(z.object({ name: z.string(), command: z.string() })).optional(),
    })
    .optional(),
  checkpoints: z
    .array(
      z.object({
        id: z.string(),
        export_command: z.string(),
        import_command: z.string().optional(),
      })
    )
    .optional(),
});
export type RigServices = z.infer<typeof RigServicesSchema>;

/** The RIG: `rig.yaml`. Doc: rig-spec.md "Top-Level Fields". */
export const RigSpecSchema = z.strictObject({
  /** Use "0.2". */
  version: z.string().min(1),
  name: z.string().min(1),
  summary: z.string().optional(),
  /**
   * Path (beside rig.yaml) of the rig's culture file, usually `CULTURE.md`. OpenRig delivers it to
   * every seat in the culture layer, after its own CULTURE-default.md.
   */
  culture_file: z.string().optional(),
  non_interruptive: z.boolean().optional(),
  permission_policy: PermissionPolicyRefSchema.optional(),
  env: SeatEnvSchema.optional(),
  /** Where Claude seats get OpenRig's managed blocks: CLAUDE.md (default) or CLAUDE.local.md. */
  managed_blocks: z.object({ 'claude-code': z.enum(['CLAUDE.md', 'CLAUDE.local.md']) }).optional(),
  /** Files that travel with the rig in bundles. The engine does not read them. */
  docs: z.array(z.object({ path: z.string().min(1) })).optional(),
  /** The rig layer of startup. */
  startup: StartupBlockSchema.optional(),
  services: RigServicesSchema.optional(),
  workspace: RigWorkspaceSchema.optional(),
  pods: z.array(PodSpecSchema).min(1),
  edges: z.array(CrossPodEdgeSchema).optional(),
});
export type RigSpec = z.infer<typeof RigSpecSchema>;

/** `{pod}-{member}@{rig}`: the seat's canonical session name. Doc: rig-spec.md "Session Naming". */
export const sessionName = (rig: string, pod: string, member: string): string =>
  `${pod}-${member}@${rig}`;
/** `{pod}.{member}`: the seat's logical id within the rig. */
export const logicalId = (pod: string, member: string): string => `${pod}.${member}`;
