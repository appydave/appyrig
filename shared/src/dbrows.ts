import { z } from 'zod';
import { MachineIdentitySchema } from './snapshot.js';

/**
 * Batch 1 · B5 (fb-0003): read-only rows of the OpenRig database, for the schema view.
 *
 * Push only, like the schema itself: the hub never asks a collector anything. Each collector reads
 * its own `~/.openrig/openrig.sqlite` through the same read-only connection as `db.schema` (read-only
 * flag, `PRAGMA query_only`, immutable when OpenRig is stopped) and pushes, per table, its newest
 * rows (by rowid) up to DB_ROWS_MAX and DB_ROWS_BYTES_MAX, only when the database files changed.
 * Every text cell is redacted and capped. A table cut short says so (`total` vs the rows held).
 * Views are not read (they can be expensive); their own tables are.
 */

/** Most rows kept per table: newest first. */
export const DB_ROWS_MAX = 500;
/** Most characters kept per cell; longer text ends in "…". */
export const DB_CELL_MAX = 1000;
/**
 * Most bytes per push (one table), measured as the serialized rows, so one message stays well under
 * socket.io's 1 MB limit. Rows past it are left out and the table reads as cut.
 */
export const DB_ROWS_BYTES_MAX = 600 * 1024;

/**
 * Columns blanked whatever they hold (ruling, openrig-orch-m4): the redactor misses unprefixed
 * secrets, so a column whose NAME looks secret never leaves the collector.
 */
export const DB_SECRET_COLUMN = /token|secret|key|passw|credential|auth/i;
export const DB_HIDDEN_CELL = '(hidden: column name looks secret)';
/** Most rows one db.rows call returns. */
export const DB_ROWS_PAGE_MAX = 100;

const isoDate = z.iso.datetime({ offset: true });

/** A cell as text, a number, or null. A BLOB is shown as "(blob N bytes)", never its bytes. */
export const DbCellSchema = z.union([z.string(), z.number(), z.null()]);
export type DbCell = z.infer<typeof DbCellSchema>;

export const DbRowsPushSchema = z.strictObject({
  machineId: MachineIdentitySchema.shape.id,
  collectedAt: isoDate,
  table: z.string().min(1).max(200),
  columns: z.array(z.string().max(200)).max(200),
  /** COUNT(*) of the whole table when it was read. */
  total: z.number().int().nonnegative(),
  /** Newest first (by rowid); each row lines up with `columns`. */
  rows: z.array(z.array(DbCellSchema)).max(DB_ROWS_MAX),
  /** True when `rows` holds fewer than `total` (the row or byte cap was hit). */
  truncated: z.boolean(),
  /** "rowid" when sorted newest first; null when the table has no rowid (order as stored). */
  order: z.enum(['rowid']).nullable(),
  /** Columns blanked because their name looks secret (DB_SECRET_COLUMN). */
  hiddenColumns: z.array(z.string().max(200)).max(200),
});
export type DbRowsPush = z.infer<typeof DbRowsPushSchema>;

// ── verb ───────────────────────────────────────────────────────────────────────────────────────

export const DbRowsInputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id.describe('machine id, e.g. m2'),
  table: z.string().min(1).max(200).describe('table name, as db.schema lists it'),
  offset: z.number().int().nonnegative().optional().describe('rows to skip (default 0)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(DB_ROWS_PAGE_MAX)
    .optional()
    .describe(`rows to return, at most ${DB_ROWS_PAGE_MAX} (default 50)`),
});
export type DbRowsInput = z.infer<typeof DbRowsInputSchema>;

export const DbRowsOutputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id,
  table: z.string(),
  /** `pending` = no rows from this machine's collector for this table (older collector, or not yet). */
  status: z.enum(['ok', 'pending']),
  reason: z.string().nullable(),
  collectedAt: isoDate.nullable(),
  columns: z.array(z.string()),
  total: z.number().int().nonnegative(),
  /** Rows the hub holds for the table (≤ total). */
  held: z.number().int().nonnegative(),
  truncated: z.boolean(),
  order: z.enum(['rowid']).nullable(),
  hiddenColumns: z.array(z.string()),
  offset: z.number().int().nonnegative(),
  rows: z.array(z.array(DbCellSchema)).max(DB_ROWS_PAGE_MAX),
});
export type DbRowsOutput = z.infer<typeof DbRowsOutputSchema>;
