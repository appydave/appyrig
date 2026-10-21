import { z } from 'zod';
import * as OpenRig from './openrig/index.js';
import { MachineIdentitySchema } from './snapshot.js';

/**
 * v1.5 · L1: a seat's loadout, for the Debug view. What one Claude seat runs with:
 *   - the skills Claude Code listed to the model: the newest full `skill_listing` in the seat's
 *     own transcript plus its later additions (not a guess from folders), each sorted by where it
 *     came from;
 *   - the seat's documents, present or absent, with their text for the file viewer.
 *
 * Listed means available to the model. Which skills were used is not reported here.
 *
 * Sent on its own channel, one seat per message and only when it changed, not inside the snapshot:
 * a seat lists ~300 names, and the snapshot is pushed every 3 s and broadcast to every browser.
 * An older hub does not listen for the event (no ack; the collector retries and warns now and
 * then), and an older collector never sends it (the verb says so). Hub first, then collectors.
 */

const isoDate = z.iso.datetime({ offset: true });

/** Most skill names kept per seat. Claude Code listed ~313 on the M2 in Oct 2026. */
export const LOADOUT_SKILLS_MAX = 2000;

/** Most text kept per seat document: all of them stay well under socket.io's 1 MB message limit. */
export const SEAT_DOC_MAX_BYTES = 96 * 1024;

/**
 * Where a listed skill came from:
 * - `role`     — in the seat cwd's `.claude/skills/` and not tracked by git there: OpenRig copied it in
 * - `repo`     — in the seat cwd's `.claude/skills/` and tracked by git
 * - `personal` — in `~/.claude/skills/`
 * - `plugin`   — a namespaced `plugin:skill` name
 * - `builtin`  — none of those: Claude Code's own and account-synced skills
 * - `unplaced` — none of personal / plugin, and the seat's folder is gone (or not reported), so
 *                role, repo and built-in cannot be told apart (QA D3: never counted as built-in)
 */
export const SkillSourceSchema = z.enum([
  'role',
  'repo',
  'personal',
  'plugin',
  'builtin',
  'unplaced',
]);
export type SkillSource = z.infer<typeof SkillSourceSchema>;

export const LoadoutSkillSchema = z.strictObject({
  /** The name as Claude listed it (`recipe`, `canvas:visual-brief`). */
  name: z.string().min(1).max(200),
  source: SkillSourceSchema,
  /** The plugin, for a `plugin` skill. */
  plugin: z.string().max(200).nullable(),
  /**
   * Other places a skill of the same name exists (shadowing). The name without its plugin prefix is
   * compared, so `mochaccino` in the repo and `mochaccino:mochaccino` from a plugin flag each other.
   */
  alsoIn: z.array(SkillSourceSchema),
});
export type LoadoutSkill = z.infer<typeof LoadoutSkillSchema>;

/**
 * A seat's documents: the files AppyRig looks for that shape what the seat is told (its culture,
 * role, CLAUDE.md / CLAUDE.local.md, recap, learned notes). These are file-presence checks, NOT
 * OpenRig's startup layers (agent → profile → culture → rig → pod → member → operator, see
 * `OpenRig.STARTUP_LAYERS`), so they are not called layers. The wire key stays `layers`.
 *
 * The ids, in the order a seat receives them.
 */
export const SeatDocIdSchema = z.enum([
  'culture',
  'role',
  'claude-md',
  'claude-local',
  'recap',
  'learned',
]);
export type SeatDocId = z.infer<typeof SeatDocIdSchema>;

export const SeatDocSchema = z.strictObject({
  id: SeatDocIdSchema,
  /** The file name found, or the one looked for when absent. */
  name: z.string().min(1).max(120),
  present: z.boolean(),
  /** Absolute path of the file read (present), else null. */
  path: z.string().max(1024).nullable(),
  /** Where it was looked for, in plain words and paths, so "absent" says where. */
  looked: z.array(z.string().max(1024)).max(8),
  bytes: z.number().int().nonnegative().nullable(),
  modifiedAt: isoDate.nullable(),
  /** True when content was cut at SEAT_DOC_MAX_BYTES. */
  truncated: z.boolean(),
  /** Redacted text; null when absent. */
  content: z.string().nullable(),
});
export type SeatDoc = z.infer<typeof SeatDocSchema>;

/** @deprecated Old names, kept so the client compiles unchanged; use the SeatDoc names. */
export const LOADOUT_LAYER_MAX_BYTES = SEAT_DOC_MAX_BYTES;
/** @deprecated Use SeatDocIdSchema. */
export const LoadoutLayerIdSchema = SeatDocIdSchema;
/** @deprecated Use SeatDocId. */
export type LoadoutLayerId = SeatDocId;
/** @deprecated Use SeatDocSchema. */
export const LoadoutLayerSchema = SeatDocSchema;
/** @deprecated Use SeatDoc. */
export type LoadoutLayer = SeatDoc;

/**
 * `ok`          — a skill listing was read
 * `no-listing`  — a Claude seat, but no transcript with a `skill_listing` entry was found
 * `not-claude`  — not a Claude Code seat (Codex records skills differently: not read yet)
 */
export const LoadoutStatusSchema = z.enum(['ok', 'no-listing', 'not-claude']);
export type LoadoutStatus = z.infer<typeof LoadoutStatusSchema>;

// ── what OpenRig gave the seat: its member spec, its AgentSpec, its topology chain files ────────

/** Most text kept per topology chain file. */
export const TOPOLOGY_DOC_MAX_BYTES = 32 * 1024;
/** Most topology chain files kept per seat (instance → rig → pod → seat, present files only). */
export const TOPOLOGY_DOCS_MAX = 16;

/**
 * One chain file on OpenRig's topology tree that applies to this seat, read from
 * `<topology.root>` (instance), `rigs/<rig>`, `rigs/<rig>/pods/<pod>` or `rigs/<rig>/seats/<seat>`
 * (see OpenRig.topologyTrace). Present files only. Collector-set, redacted, capped.
 */
export const TopologyDocSchema = z.strictObject({
  altitude: OpenRig.TopologyAltitudeSchema,
  /** `LEARNED.md`, `CRAFT.md`, `ORCHESTRATION-CRAFT.md`, `CULTURE.md` or `RECAP.md`. */
  name: z.string().min(1).max(120),
  path: z.string().min(1).max(1024),
  bytes: z.number().int().nonnegative(),
  modifiedAt: isoDate,
  /** True when content was cut at TOPOLOGY_DOC_MAX_BYTES. */
  truncated: z.boolean(),
  content: z.string(),
});
export type TopologyDoc = z.infer<typeof TopologyDocSchema>;

/** Most env names listed for a member. */
export const MEMBER_ENV_NAMES_MAX = 100;

/**
 * The seat's member entry in rig.yaml: OpenRig's MemberSpec as authored, plus the pod it sits in,
 * with env reduced to its names. Collector-set from a rig.yaml OpenRig would accept.
 */
export const MemberViewSchema = OpenRig.MemberSpecSchema.omit({ env: true }).extend({
  pod: z.string().min(1),
  envNames: z.array(z.string().min(1).max(120)).max(MEMBER_ENV_NAMES_MAX).optional(),
});
export type MemberView = z.infer<typeof MemberViewSchema>;

/**
 * The seat's AgentSpec (agent.yaml at its agent_ref), as authored, with only the profile the
 * member picked (`profileName`; `profile` null when the spec has no such profile).
 */
export const AgentSpecViewSchema = OpenRig.AgentSpecSchema.pick({
  name: true,
  version: true,
  description: true,
  summary: true,
  defaults: true,
  imports: true,
  resources: true,
  startup: true,
}).extend({
  profileName: z.string().min(1).nullable(),
  profile: OpenRig.AgentProfileSchema.nullable(),
});
export type AgentSpecView = z.infer<typeof AgentSpecViewSchema>;

export const SeatLoadoutSchema = z.strictObject({
  machineId: MachineIdentitySchema.shape.id,
  seat: z.string().min(1),
  collectedAt: isoDate,
  runtime: z.string().nullable(),
  cwd: z.string().nullable(),
  status: LoadoutStatusSchema,
  /**
   * What the model was shown: the last full listing (`isInitial`) plus every later delta listing
   * (Claude Code lists only newly added skills after the first). Null unless status is ok.
   */
  listing: z
    .strictObject({
      /** When the newest listing in the set was written. */
      at: isoDate,
      /** Skills shown to the model: the size of the union of names (also the pill's number). */
      skillCount: z.number().int().nonnegative(),
      /** Claude Code's own `skillCount`s summed over the initial listing and its deltas: a cross-check. */
      reported: z.number().int().nonnegative(),
      /** True when the set starts from a full (initial) listing; false = only deltas were found. */
      isInitial: z.boolean(),
      /** Delta listings added on top of the initial one. */
      deltas: z.number().int().nonnegative(),
      /** How many listings the chosen transcript held (the set comes from that one file). */
      listings: z.number().int().positive(),
      transcript: z.string().max(1024),
    })
    .nullable(),
  /** False when the seat cwd is not in a git repo: then nothing counts as tracked. */
  cwdIsGitRepo: z.boolean().nullable(),
  /** False when the seat's folder no longer exists; null when the daemon reports none. */
  cwdExists: z.boolean().nullable(),
  skills: z.array(LoadoutSkillSchema).max(LOADOUT_SKILLS_MAX),
  /** The seat's documents (wire key kept as `layers` for the client). */
  layers: z.array(SeatDocSchema).max(6),
  /**
   * Seat-spec fields, sent ONLY to a hub that advertised HUB_CAPS.SEAT_SPEC (see stripSeatSpec).
   * Absent = not said. `topologyRoot`: where the topology tree was looked for (null: not resolved).
   */
  topologyRoot: z.string().max(1024).nullable().optional(),
  topologyDocs: z.array(TopologyDocSchema).max(TOPOLOGY_DOCS_MAX).optional(),
  /** null: no validated rig.yaml names this seat. */
  member: MemberViewSchema.nullable().optional(),
  /** null: no agent.yaml OpenRig would accept at the seat's agent_ref. */
  agentSpec: AgentSpecViewSchema.nullable().optional(),
});
export type SeatLoadout = z.infer<typeof SeatLoadoutSchema>;

export const SEAT_SPEC_KEYS = ['topologyRoot', 'topologyDocs', 'member', 'agentSpec'] as const;

/** The loadout as a hub without HUB_CAPS.SEAT_SPEC accepts it: every seat-spec key removed. */
export function stripSeatSpec(loadout: SeatLoadout): SeatLoadout {
  return Object.fromEntries(
    Object.entries(loadout).filter(([k]) => !(SEAT_SPEC_KEYS as readonly string[]).includes(k))
  ) as SeatLoadout;
}

// ── verb ───────────────────────────────────────────────────────────────────────────────────────

export const SeatLoadoutInputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id.describe('machine id, e.g. m2'),
  seat: z.string().min(1).describe('seat id, e.g. orch-lead@appyrig-v14'),
});
export type SeatLoadoutInput = z.infer<typeof SeatLoadoutInputSchema>;

export const SeatLoadoutOutputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id,
  seat: z.string(),
  /**
   * `ok` / `no-listing` / `not-claude` as the collector reported; `not-claude` is also answered by
   * the hub itself from the seat's runtime. `pending` = no loadout from this machine for this seat
   * (an older collector, or not sent yet).
   */
  status: z.enum(['ok', 'no-listing', 'not-claude', 'pending']),
  reason: z.string().nullable(),
  loadout: SeatLoadoutSchema.nullable(),
});
export type SeatLoadoutOutput = z.infer<typeof SeatLoadoutOutputSchema>;

// ── counts, shared by the view and its tests ───────────────────────────────────────────────────

/** The name without a plugin prefix: `canvas:visual-brief` → `visual-brief`. */
export const shortSkillName = (name: string): string => name.slice(name.indexOf(':') + 1);

export interface LoadoutCounts {
  bySource: Record<SkillSource, number>;
  /** Listed skills whose name also exists somewhere else. */
  shadowed: number;
  /**
   * The Venn: names (without plugin prefix) by which of the three circles hold them. Key is the
   * sorted circle list joined by '+', e.g. `role`, `plugin+repo`; `` = outside every circle.
   */
  regions: Record<string, number>;
}

const CIRCLES: SkillSource[] = ['role', 'repo', 'plugin'];

export function loadoutCounts(skills: LoadoutSkill[]): LoadoutCounts {
  const bySource: Record<SkillSource, number> = {
    role: 0,
    repo: 0,
    personal: 0,
    plugin: 0,
    builtin: 0,
    unplaced: 0,
  };
  let shadowed = 0;
  const circlesOf = new Map<string, Set<SkillSource>>();
  for (const s of skills) {
    bySource[s.source] += 1;
    if (s.alsoIn.length > 0) {
      shadowed += 1;
    }
    const key = shortSkillName(s.name);
    const set = circlesOf.get(key) ?? new Set<SkillSource>();
    for (const src of [s.source, ...s.alsoIn]) {
      if (CIRCLES.includes(src)) {
        set.add(src);
      }
    }
    circlesOf.set(key, set);
  }
  const regions: Record<string, number> = {};
  for (const set of circlesOf.values()) {
    const key = [...set].sort().join('+');
    regions[key] = (regions[key] ?? 0) + 1;
  }

  return { bySource, shadowed, regions };
}
