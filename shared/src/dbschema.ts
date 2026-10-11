import { z } from 'zod';
import { MachineIdentitySchema } from './snapshot.js';

/**
 * v1.4 · S7: the live shape of the OpenRig database on a machine, so AppyRig follows whatever
 * OpenRig version is installed. The collector opens `~/.openrig/openrig.sqlite` READ-ONLY and reads
 * only `sqlite_master`, `pragma table_info` and `pragma foreign_key_list`: table and column names
 * and types, never a row. The hub keeps the schema it saw per OpenRig version (in AppyRig's own
 * data directory, never in OpenRig) and diffs against the previous version. Hub first.
 */

export const DB_TABLES_MAX = 300;
export const DB_COLUMNS_MAX = 200;
export const DB_VERSIONS_KEPT = 20;

const isoDate = z.iso.datetime({ offset: true });

export const DbColumnSchema = z.strictObject({
  name: z.string().min(1).max(120),
  /** Declared type as SQLite stores it ("TEXT", "INTEGER", "" for none). */
  type: z.string().max(80),
  notNull: z.boolean(),
  /** Position in the primary key (1-based), 0 when not part of it. */
  pk: z.number().int().nonnegative(),
  /** The declared default expression, or null. */
  default: z.string().max(200).nullable(),
});
export type DbColumn = z.infer<typeof DbColumnSchema>;

export const DbForeignKeySchema = z.strictObject({
  from: z.string().min(1).max(120),
  /** The table it points at. */
  table: z.string().min(1).max(120),
  /** The column it points at; null means "that table's primary key". */
  to: z.string().max(120).nullable(),
});
export type DbForeignKey = z.infer<typeof DbForeignKeySchema>;

export const DbTableSchema = z.strictObject({
  name: z.string().min(1).max(120),
  kind: z.enum(['table', 'view']),
  columns: z.array(DbColumnSchema).max(DB_COLUMNS_MAX),
  foreignKeys: z.array(DbForeignKeySchema).max(DB_COLUMNS_MAX),
});
export type DbTable = z.infer<typeof DbTableSchema>;

export const SchemaStatusSchema = z.enum(['ok', 'no-openrig', 'unreadable']);

/** collector → hub, when the schema, the version or the status changed (and after every reconnect). */
export const SchemaPushSchema = z.strictObject({
  machineId: MachineIdentitySchema.shape.id,
  collectedAt: isoDate,
  status: SchemaStatusSchema,
  /** Why it is not ok: no database here, or the plain-words failure. Null when ok. */
  reason: z.string().max(300).nullable(),
  /** `rig --version`'s answer, e.g. "0.6.6 (2620dea8)"; null when it could not be read. */
  openrigVersion: z.string().max(80).nullable(),
  tables: z.array(DbTableSchema).max(DB_TABLES_MAX),
});
export type SchemaPush = z.infer<typeof SchemaPushSchema>;

// ── the db.schema verb ─────────────────────────────────────────────────────────────────────────

export const DbSchemaInputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id.describe('machine id, e.g. m2'),
});
export type DbSchemaInput = z.infer<typeof DbSchemaInputSchema>;

export const ColumnChangeSchema = z.strictObject({
  name: z.string(),
  /** e.g. "TEXT NOT NULL" before and after. */
  from: z.string(),
  to: z.string(),
});

export const TableChangeSchema = z.strictObject({
  name: z.string(),
  addedColumns: z.array(z.string()),
  removedColumns: z.array(z.string()),
  changedColumns: z.array(ColumnChangeSchema),
  addedForeignKeys: z.array(z.string()),
  removedForeignKeys: z.array(z.string()),
});
export type TableChange = z.infer<typeof TableChangeSchema>;

/**
 *  baseline   only one OpenRig version has been seen: nothing to compare yet
 *  unchanged  the version changed (or not) and the schema is the same as the previous version's
 *  changed    the schema differs from the previous version's (see the lists)
 */
export const SchemaChangesSchema = z.strictObject({
  status: z.enum(['baseline', 'unchanged', 'changed']),
  /** The version compared against (the one seen before the current); null for a baseline. */
  comparedTo: z.string().nullable(),
  addedTables: z.array(z.string()),
  removedTables: z.array(z.string()),
  changedTables: z.array(TableChangeSchema),
});
export type SchemaChanges = z.infer<typeof SchemaChangesSchema>;

/**
 *  ok          tables listed, version named
 *  no-openrig  the machine has no OpenRig database (the M4 today)
 *  unreadable  there is one and it could not be read (reason says why)
 *  no-data     the machine's collector does not report schemas (older than v1.4)
 */
export const DbSchemaOutputSchema = z.strictObject({
  machine: MachineIdentitySchema.shape.id,
  status: z.enum(['ok', 'no-openrig', 'unreadable', 'no-data']),
  reason: z.string().nullable(),
  openrigVersion: z.string().nullable(),
  sampledAt: isoDate.nullable(),
  sampleAgeMs: z.number().int().min(0).nullable(),
  tables: z.array(DbTableSchema),
  changes: SchemaChangesSchema.nullable(),
  /** Every OpenRig version seen on this machine, oldest first. */
  versionsSeen: z.array(z.strictObject({ version: z.string(), firstSeenAt: isoDate })),
});
export type DbSchemaOutput = z.infer<typeof DbSchemaOutputSchema>;
