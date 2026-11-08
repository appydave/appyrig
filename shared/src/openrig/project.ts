import { z } from 'zod';

/**
 * OpenRig's project tree: WHAT is being built. project → mission → slice, as folders under
 * `workspace.root` (default `$OPENRIG_HOME/workspace`). This is OpenRig's own notion of a mission;
 * it is not a crew's MISSION.md (see README.md, "Not OpenRig").
 *
 * Mirrors: OpenRig `docs/reference/project-workspace.md` ("Default Shape", "UI Mapping", "Queue
 * Mapping"), `docs/reference/chain-file-convention.md` ("The project tree"),
 * `docs/reference/sdlc-conventions.md` (EC-1 / EC-2: `depends_on`, `mission.yaml`
 * `arrangement.waves`), `packages/daemon/src/domain/slices/slice-indexer.ts` (SliceStatus,
 * SliceListEntry) and `packages/cli/src/lib/scope/scope-fs.ts` (SPEC.md before legacy README.md).
 *
 * Layout:
 *   <workspace.root>/SPEC.md · project.yaml · workspace.yaml · rosters/ · missions/ · exhaust/
 *   missions/<mission>/SPEC.md (or README.md) · PROGRESS.md · NOTES.md · mission.yaml?
 *   missions/<mission>/slices/<slice>/SPEC.md · PROGRESS.md · PROOF.md · proof/ · slice.yaml?
 *   missions/<mission>/closed/<slice>/…   (closed slices)
 */

/** Chain names on the project tree. A node with no SPEC.md falls back to README.md. */
export const PROJECT_CHAIN_FILES = ['SPEC.md', 'PROGRESS.md', 'PROOF.md', 'NOTES.md'] as const;
export const NODE_FILE_PRECEDENCE = ['SPEC.md', 'README.md'] as const;

/** Mirrors slice-indexer.ts SliceStatus (OpenRig maps the raw frontmatter `status` onto these). */
export const SLICE_STATUSES = ['active', 'done', 'blocked', 'draft'] as const;

/**
 * A slice's SPEC.md frontmatter, the keys OpenRig reads. Loose: authors add their own keys.
 * `depends_on` (EC-1): an explicit `[]` is a statement, absence is indeterminate.
 */
export const SliceSpecFrontmatterSchema = z.looseObject({
  id: z.string().optional(),
  status: z.string().optional(),
  depends_on: z.array(z.string()).optional(),
  description: z.string().optional(),
  summary: z.string().optional(),
  /** Legacy queue-link code (PL-005 …). */
  'rail-item': z.string().optional(),
  /** `<name>@<version>` of a workflow spec. */
  workflow_spec: z.string().optional(),
});

/** `mission.yaml` (optional): the mission's arrangement. Loose beyond the keys OpenRig names. */
export const MissionYamlSchema = z.looseObject({
  arrangement: z
    .looseObject({
      waves: z
        .array(
          z.looseObject({
            id: z.string(),
            slices: z.array(z.string()),
            review_model: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});
