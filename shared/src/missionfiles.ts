import { z } from 'zod';
import { MachineIdentitySchema } from './snapshot.js';

/**
 * Run board, lane 1: the files a rig's MISSION.md points at (spec sources, QA notes, screenshots),
 * read-only.
 *
 * Boundary, since this is served over the tailnet: a client names {machine, rig, path}, but the
 * path is only ever compared with a list. The COLLECTOR builds that list from the rig's own
 * MISSION.md jobs table (absolute spec paths, no symlinks) plus the .md files in `qa/` and the
 * .png/.jpg/.html files in `shots/` beside it, reads exactly those, and pushes them. The hub never
 * touches a disk: it answers `refused` for a path that is not in the list the collector pushed,
 * `missing` for a listed path that is not on disk, `too_large` for a file over the cap (never
 * truncated bytes). An older hub has no cap for this and an older collector never sends it.
 */

/** Text (.md, .html) over this is `too_large`. */
export const MISSION_TEXT_MAX_BYTES = 256 * 1024;
/** Images (.png, .jpg) over this are `too_large`. */
export const MISSION_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** An image travels in parts of at most this many raw bytes (base64 stays under the 800 KB channel guard). */
export const MISSION_PART_BYTES = 512 * 1024;
/** Most files listed (and so held) per rig. */
export const MISSION_FILES_MAX = 120;
/** Most bytes the hub keeps per rig; the oldest arrivals go first. */
export const MISSION_STORE_MAX_BYTES = 48 * 1024 * 1024;

export const MISSION_MIME: Record<string, string> = {
  md: 'text/markdown',
  html: 'text/html',
  png: 'image/png',
  jpg: 'image/jpeg',
};

const isoDate = z.iso.datetime({ offset: true });
export const MissionPathSchema = z
  .string()
  .min(2)
  .max(1024)
  .refine((s) => s.startsWith('/'), 'an absolute path')
  .refine((s) => !s.includes('\0'), 'no NUL');

/** collector to hub. The complete list of paths this rig may serve; replaces the previous list. */
export const MissionManifestSchema = z.strictObject({
  kind: z.literal('manifest'),
  machineId: MachineIdentitySchema.shape.id,
  collectedAt: isoDate,
  rig: z.string().min(1),
  paths: z.array(MissionPathSchema).max(MISSION_FILES_MAX),
});

/** collector to hub. One listed file, or one part of it (`part` 0 first; `parts` total, 1 for a text file). */
export const MissionFilePushSchema = z.strictObject({
  kind: z.literal('file'),
  machineId: MachineIdentitySchema.shape.id,
  collectedAt: isoDate,
  rig: z.string().min(1),
  path: MissionPathSchema,
  status: z.enum(['ok', 'missing', 'too_large']),
  mime: z.string().max(40).optional(),
  bytes: z.number().int().nonnegative().optional(),
  modifiedAt: isoDate.optional(),
  text: z.string().optional(),
  base64: z.string().optional(),
  part: z.number().int().nonnegative(),
  parts: z.number().int().positive().max(8),
});

export const MissionFilesPushSchema = z.discriminatedUnion('kind', [
  MissionManifestSchema,
  MissionFilePushSchema,
]);
export type MissionFilesPush = z.infer<typeof MissionFilesPushSchema>;
export type MissionManifest = z.infer<typeof MissionManifestSchema>;
export type MissionFilePush = z.infer<typeof MissionFilePushSchema>;

// verb

export const MissionFileInputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id.describe(
    'machine id, e.g. m4 (required: one rig name can exist on two machines)'
  ),
  rig: z.string().min(1).describe('rig name, e.g. d09-crew'),
  path: MissionPathSchema.describe(
    "an absolute path named by that rig's MISSION.md, or a file in its qa/ or shots/"
  ),
});
export type MissionFileInput = z.infer<typeof MissionFileInputSchema>;

/**
 *  ok         text or base64 is present
 *  missing    the path is listed for this rig but is not on disk
 *  refused    the path is not on this rig's list (never read)
 *  too_large  over the cap (256 KB text, 2 MB image); no bytes are sent
 *  pending    listed, but its bytes have not arrived at the hub yet
 *  no-data    this machine's collector has sent no mission file list (older, or not yet)
 */
export const MissionFileOutputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id,
  rig: z.string(),
  path: z.string(),
  status: z.enum(['ok', 'missing', 'refused', 'too_large', 'pending', 'no-data']),
  mime: z.string().nullable(),
  bytes: z.number().int().nonnegative().nullable(),
  modifiedAt: z.string().nullable(),
  text: z.string().nullable(),
  base64: z.string().nullable(),
});
export type MissionFileOutput = z.infer<typeof MissionFileOutputSchema>;
