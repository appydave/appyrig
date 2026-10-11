import { z } from 'zod';

/**
 * v1.4 · S8: in-app feedback notes. The one thing AppyRig writes, and it writes only to its own
 * store (`data/feedback/` at the repo root, never to OpenRig, a seat, the queue, or git: `data/` is
 * ignored). Pattern copied from ImageDrip's Live UAT (apps/imagedrip/docs/live-uat.md): a plain-string
 * region, four verdicts, a free-text note as the point of it, a caller-composed snapshot, ids and
 * times assigned by the server. New here: a PNG of the screen.
 *
 * Reading back needs no API: `data/feedback/index.jsonl` (one line per note) and one folder per
 * note with `note.json` and `screenshot.png`. The verbs `feedback.list` / `feedback.get` and the
 * route `GET /v1/feedback/:id/screenshot.png` serve the same thing to an agent on another machine.
 */

export const FEEDBACK_NOTE_MAX = 4000;
export const FEEDBACK_SNAPSHOT_MAX = 2000;
export const FEEDBACK_VIEWSTATE_MAX_BYTES = 8 * 1024;
/** Decoded PNG size cap. A client should downscale to at most FEEDBACK_SCREENSHOT_MAX_WIDTH first. */
export const FEEDBACK_SCREENSHOT_MAX_BYTES = 3 * 1024 * 1024;
export const FEEDBACK_SCREENSHOT_MAX_WIDTH = 1600;
/** The hard limit on width or height of the PNG as the server reads it from the file. */
export const FEEDBACK_SCREENSHOT_MAX_DIMENSION = 8000;
/** Base64 text of a maximum-size PNG. The route's JSON body limit is 5 MB. */
export const FEEDBACK_SCREENSHOT_MAX_B64 = Math.ceil((FEEDBACK_SCREENSHOT_MAX_BYTES * 4) / 3) + 4;
export const FEEDBACK_NOTES_MAX = 500;
export const FEEDBACK_BODY_LIMIT = '5mb';
export const FEEDBACK_ROUTE = '/v1/feedback';

const isoDate = z.iso.datetime({ offset: true });

export const FeedbackVerdictSchema = z.enum(['down', 'question', 'up', 'idea']);
export type FeedbackVerdict = z.infer<typeof FeedbackVerdictSchema>;

export const FeedbackIdSchema = z.string().regex(/^fb-\d{4,}$/, 'a feedback id like fb-0001');

/** A plain string, as in Live UAT: a new screen is flaggable by naming it. Letters, digits and `:._ -`. */
export const FeedbackRegionSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._ -]{0,63}$/, 'a short region name like "wall" or "flow:step-3"');

const filterValue = z.union([z.string().max(200), z.number(), z.boolean(), z.null()]);

/** What the viewer was looking at: enough to put the screen back. Everything but `route` is optional. */
export const FeedbackViewStateSchema = z
  .strictObject({
    /** e.g. "/" or "/#/flow". */
    route: z.string().max(300),
    /** The tab: wall, map, flow, accounts, learn... */
    view: z.string().max(60).nullable().optional(),
    selectedRig: z.string().max(120).nullable().optional(),
    selectedSeat: z.string().max(200).nullable().optional(),
    /** Machines switched on in the machine filter. */
    machines: z.array(z.string().max(30)).max(10).optional(),
    /** Any other filter in play (search text, status filter, flow step...). */
    filters: z.record(z.string().max(40), filterValue).optional(),
    legend: z.boolean().nullable().optional(),
    explain: z.boolean().nullable().optional(),
    viewport: z
      .strictObject({
        width: z.number().int().min(0).max(20000),
        height: z.number().int().min(0).max(20000),
      })
      .optional(),
  })
  .refine((v) => Object.keys(v.filters ?? {}).length <= 20, 'at most 20 filters')
  .refine(
    (v) => JSON.stringify(v).length <= FEEDBACK_VIEWSTATE_MAX_BYTES,
    `the view state is at most ${FEEDBACK_VIEWSTATE_MAX_BYTES} bytes`
  );
export type FeedbackViewState = z.infer<typeof FeedbackViewStateSchema>;

/** What the client sends. The server adds the id, time, viewer and version; the client never names a path. */
export const FeedbackAddInputSchema = z.strictObject({
  verdict: FeedbackVerdictSchema,
  region: FeedbackRegionSchema,
  /** Free text: the point of the note. */
  note: z.string().trim().min(1).max(FEEDBACK_NOTE_MAX),
  /** Caller-composed text of what was on screen, so the note stays legible after the data changes. */
  snapshot: z.string().max(FEEDBACK_SNAPSHOT_MAX).optional(),
  viewState: FeedbackViewStateSchema,
  /** The client's own build id (e.g. its git SHA), if it has one. */
  clientBuild: z.string().max(60).optional(),
  /** Base64 of a PNG (no data: prefix). At most FEEDBACK_SCREENSHOT_MAX_BYTES once decoded. */
  screenshotPng: z.string().max(FEEDBACK_SCREENSHOT_MAX_B64).optional(),
});
export type FeedbackAddInput = z.infer<typeof FeedbackAddInputSchema>;

export const FeedbackScreenshotMetaSchema = z.strictObject({
  bytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

/** note.json, and what feedback.get returns. */
export const FeedbackNoteSchema = z.strictObject({
  id: FeedbackIdSchema,
  createdAt: isoDate,
  /** The principal that filed it (the UI calls as `human:ui`). */
  viewer: z.string().max(80),
  appVersion: z.string().max(40),
  clientBuild: z.string().max(60).nullable(),
  verdict: FeedbackVerdictSchema,
  region: z.string(),
  note: z.string(),
  snapshot: z.string().nullable(),
  viewState: FeedbackViewStateSchema,
  screenshot: FeedbackScreenshotMetaSchema.nullable(),
  /** Always `open`: acting on a note is out of scope here (as in Live UAT). */
  status: z.literal('open'),
});
export type FeedbackNote = z.infer<typeof FeedbackNoteSchema>;

/** One line of index.jsonl, and one row of feedback.list. */
export const FeedbackSummarySchema = z.strictObject({
  id: FeedbackIdSchema,
  createdAt: isoDate,
  viewer: z.string().max(80),
  verdict: FeedbackVerdictSchema,
  region: z.string(),
  /** The note, cut to 200 characters. */
  note: z.string().max(201),
  route: z.string(),
  view: z.string().nullable(),
  selectedRig: z.string().nullable(),
  hasScreenshot: z.boolean(),
  appVersion: z.string(),
});
export type FeedbackSummary = z.infer<typeof FeedbackSummarySchema>;

export const FeedbackAddOutputSchema = z.strictObject({
  id: FeedbackIdSchema,
  createdAt: isoDate,
  hasScreenshot: z.boolean(),
  screenshot: FeedbackScreenshotMetaSchema.nullable(),
  /** Notes stored after this one. */
  count: z.number().int().positive(),
  /** True for a dry run: validated, nothing written. */
  dryRun: z.boolean(),
});
export type FeedbackAddOutput = z.infer<typeof FeedbackAddOutputSchema>;

export const FeedbackListInputSchema = z.strictObject({
  limit: z
    .number()
    .int()
    .min(1)
    .max(FEEDBACK_NOTES_MAX)
    .optional()
    .describe('most recent N (default 50)'),
  verdict: FeedbackVerdictSchema.optional().describe('only this verdict'),
  region: FeedbackRegionSchema.optional().describe('only this region'),
  since: isoDate.optional().describe('only notes filed at or after this time'),
});
export type FeedbackListInput = z.infer<typeof FeedbackListInputSchema>;

export const FeedbackListOutputSchema = z.strictObject({
  /** Total notes stored (before the filters). */
  total: z.number().int().nonnegative(),
  notes: z.array(FeedbackSummarySchema),
  /** The index file on the hub's disk, which an agent on that machine can simply read; null with no data dir. */
  indexFile: z.string().nullable(),
});
export type FeedbackListOutput = z.infer<typeof FeedbackListOutputSchema>;

export const FeedbackGetInputSchema = z.strictObject({ id: FeedbackIdSchema });
export type FeedbackGetInput = z.infer<typeof FeedbackGetInputSchema>;

export const FeedbackGetOutputSchema = z.strictObject({
  note: FeedbackNoteSchema,
  /** The screenshot route, when the note has one: GET it with the same session or token. */
  screenshotUrl: z.string().nullable(),
  /** The note's folder on the hub's disk (note.json, screenshot.png). */
  folder: z.string().nullable(),
});
export type FeedbackGetOutput = z.infer<typeof FeedbackGetOutputSchema>;
