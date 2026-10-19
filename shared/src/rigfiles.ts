import { z } from 'zod';
import { MachineIdentitySchema } from './snapshot.js';

/**
 * v1.4 · S7: a rig's own files (rig.yaml, mission and culture notes), read-only.
 *
 * Boundary, since this is served over the tailnet: a client asks by {machine, rig, fileId} and
 * never by path. The COLLECTOR decides which files exist: it lists a fixed set of names in the
 * rig's spec folder and its mission folder, only inside the configured spec folders (real paths
 * checked, so `..` and symlinks cannot leave), only .yaml/.yml/.md, capped in size, redacted.
 * The hub never touches a disk for this; it serves what a collector sent. A hub that predates
 * this does not listen for the event, so: hub first, then collectors.
 */

export const RIG_FILE_MAX_BYTES = 256 * 1024;
/** Most files kept per rig. */
export const RIG_FILES_MAX = 16;
/**
 * Most spec-named files kept per rig (scope `rig`), on top of RIG_FILES_MAX: the files its validated
 * rig.yaml names (culture_file, docs[], rig / pod / member startup files).
 */
export const RIG_SPEC_FILES_MAX = 16;
/**
 * A push is split into messages no bigger than this (content bytes), so one message stays well
 * under socket.io's default 1 MB limit. An older hub that cannot take a big message would drop the
 * whole connection, which would also stop snapshots.
 */
export const RIG_FILES_CHUNK_BYTES = 700 * 1024;

const isoDate = z.iso.datetime({ offset: true });

/**
 * `spec:rig.yaml` (the spec's own folder) or `mission:MISSION.md` (its parent folder): names only.
 * `rig:guidance/build-first-move.md`: a file the rig's rig.yaml names, as the safe relative path
 * written there (resolved against the rig root, as OpenRig does). Never an absolute path, never `..`.
 */
export const RigFileIdSchema = z
  .string()
  .regex(
    /^(?:(?:spec|mission):[A-Za-z0-9][A-Za-z0-9._-]{0,79}|rig:[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*){0,7})$/,
    'a file id like spec:rig.yaml'
  )
  .max(164)
  .refine((s) => !s.includes('..'), 'a file id has no ".."');

export const RigFileMetaSchema = z.strictObject({
  id: RigFileIdSchema,
  /** The file name; for scope `rig`, the relative path as rig.yaml writes it. */
  name: z.string().min(1).max(160),
  /**
   * `spec` / `mission`: a name on AppyRig's allowlist, beside rig.yaml or in its parent folder.
   * `rig`: named by the validated rig.yaml itself (sent only to a hub with HUB_CAPS.SPEC_FILES).
   */
  scope: z.enum(['spec', 'mission', 'rig']),
  /** Size on disk. */
  bytes: z.number().int().nonnegative(),
  modifiedAt: isoDate,
  /** True when the content below was cut at RIG_FILE_MAX_BYTES. */
  truncated: z.boolean(),
});
export type RigFileMeta = z.infer<typeof RigFileMetaSchema>;

export const RigFileSchema = RigFileMetaSchema.extend({ content: z.string() });
export type RigFile = z.infer<typeof RigFileSchema>;

/** collector → hub. `replace` true on the first message for a rig: it drops what the hub held for that rig. */
export const RigFilesPushSchema = z.strictObject({
  machineId: MachineIdentitySchema.shape.id,
  collectedAt: isoDate,
  rig: z.string().min(1),
  replace: z.boolean(),
  files: z.array(RigFileSchema).max(RIG_FILES_MAX + RIG_SPEC_FILES_MAX),
});
export type RigFilesPush = z.infer<typeof RigFilesPushSchema>;

// ── verbs ──────────────────────────────────────────────────────────────────────────────────────

export const RigFilesInputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id.describe('machine id, e.g. m2'),
  rig: z.string().min(1).describe('rig name, e.g. flicut-ab'),
});
export type RigFilesInput = z.infer<typeof RigFilesInputSchema>;

/**
 *  ok        the files the collector sent for this rig
 *  no-spec   the collector looked and found no rig.yaml for it (S3 specStatus not-found)
 *  no-data   the machine's collector does not say (older than v1.4): nothing to list
 *  pending   a rig.yaml was found but its files have not arrived yet (or the collector predates the file viewer)
 */
export const RigFilesOutputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id,
  rig: z.string(),
  status: z.enum(['ok', 'no-spec', 'no-data', 'pending']),
  reason: z.string().nullable(),
  /** The allowlisted files (scopes spec and mission), as before. */
  files: z.array(RigFileMetaSchema),
  /**
   * The files the rig's rig.yaml names (scope `rig`): culture_file, docs[], rig / pod / member
   * startup files. Absent when the collector sent none (older collector, or a refused rig.yaml).
   */
  specFiles: z.array(RigFileMetaSchema).optional(),
});
export type RigFilesOutput = z.infer<typeof RigFilesOutputSchema>;

export const RigFileInputSchema = RigFilesInputSchema.extend({
  fileId: RigFileIdSchema.describe('a file id from rig.files, e.g. spec:rig.yaml'),
});
export type RigFileInput = z.infer<typeof RigFileInputSchema>;

export const RigFileOutputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id,
  rig: z.string(),
  file: RigFileSchema,
});
export type RigFileOutput = z.infer<typeof RigFileOutputSchema>;
