import { z } from 'zod';
import { StartupBlockSchema } from './startup.js';

/**
 * OpenRig's AgentSpec (`agent.yaml`), as AUTHORED in YAML (snake_case). A seat's member spec points
 * at one with `agent_ref` and picks a `profile`. This is where a seat's role (`guidance/role.md`,
 * usually delivered by `startup.files` with `send_text`), skills, plugins, subagents and runtime
 * settings come from.
 *
 * Mirrors: OpenRig `packages/daemon/src/domain/types.ts` (AgentSpec, ProfileSpec, AgentResources,
 * LifecycleDefaults, ImportSpec) and `packages/daemon/src/domain/agent-manifest.ts` (the YAML keys;
 * the top level is not refused on unknown keys, so these are plain objects).
 * Doc: `docs/reference/agent-spec.md`. Folder layout (agent-spec.md "File System Layout"):
 * `agent.yaml` (required), `guidance/role.md`, `startup/context.md`, `skills/`, `plugins/`,
 * `runtime/`.
 */

export const LifecycleSchema = z.object({
  /** Only `interactive_resident` in v1. */
  execution_mode: z.literal('interactive_resident').optional(),
  compaction_strategy: z.string().optional(),
  restore_policy: z.enum(['resume_if_possible', 'relaunch_fresh', 'checkpoint_only']).optional(),
  mechanic: z.string().optional(),
});
export type Lifecycle = z.infer<typeof LifecycleSchema>;

const IdPath = z.object({ id: z.string().min(1), path: z.string().min(1) });

/** The pool a profile selects from. Nothing here is delivered unless a profile's `uses` names it. */
export const AgentResourcesSchema = z.object({
  /** Skill folders (each with a SKILL.md). Claude projects them to `<cwd>/.claude/skills/<id>`. */
  skills: z.array(IdPath).optional(),
  /** Merged as a managed block into CLAUDE.md / CLAUDE.local.md (Claude) or AGENTS.md. */
  guidance: z
    .array(IdPath.extend({ target: z.string().optional(), merge: z.string().optional() }))
    .optional(),
  /** Claude copies them to `<cwd>/.claude/agents/`. */
  subagents: z.array(IdPath).optional(),
  plugins: z
    .array(
      z.object({
        id: z.string().min(1),
        source: z.object({ kind: z.literal('local'), path: z.string().min(1) }),
        plugin_type: z.enum(['claude', 'codex', 'auto']).optional(),
      })
    )
    .optional(),
  /** e.g. `claude_settings_fragment` → `<cwd>/.claude/settings.local.json`, `claude_mcp_fragment` → `.mcp.json`. */
  runtime_resources: z
    .array(IdPath.extend({ runtime: z.string().min(1), type: z.string().min(1) }))
    .optional(),
});
export type AgentResources = z.infer<typeof AgentResourcesSchema>;

/** Ids are bare (own resources first, then imports) or qualified `<import>:<id>`. `hooks` is refused. */
export const ProfileUsesSchema = z.object({
  skills: z.array(z.string()).optional(),
  guidance: z.array(z.string()).optional(),
  subagents: z.array(z.string()).optional(),
  plugins: z.array(z.string()).optional(),
  runtime_resources: z.array(z.string()).optional(),
});

export const AgentProfileSchema = z.object({
  summary: z.string().optional(),
  description: z.string().optional(),
  preferences: z
    .object({
      runtime: z.string().optional(),
      model: z.string().optional(),
      effort: z.string().optional(),
    })
    .optional(),
  uses: ProfileUsesSchema.optional(),
  /** The profile layer of startup. */
  startup: StartupBlockSchema.optional(),
  lifecycle: LifecycleSchema.optional(),
});
export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const AgentSpecSchema = z.object({
  name: z.string().min(1),
  /** Quote it in YAML: "1.0". */
  version: z.string().min(1),
  /** What agent.yaml files write (OpenRig's normalised type calls it `summary`). */
  description: z.string().optional(),
  summary: z.string().optional(),
  defaults: z
    .object({
      runtime: z.string().optional(),
      model: z.string().optional(),
      effort: z.string().optional(),
      lifecycle: LifecycleSchema.optional(),
    })
    .optional(),
  imports: z.array(z.object({ ref: z.string().min(1), version: z.string().optional() })).optional(),
  profiles: z.record(z.string(), AgentProfileSchema).optional(),
  resources: AgentResourcesSchema.optional(),
  /** The agent layer of startup: typically `guidance/role.md` as `send_text`. */
  startup: StartupBlockSchema.optional(),
});
export type AgentSpec = z.infer<typeof AgentSpecSchema>;
