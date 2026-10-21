import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DB_COLUMNS_MAX, DB_TABLES_MAX, type DbTable, type SchemaPush } from '@appydave/shared';
import type { Run } from './health.js';

/**
 * v1.4 · S7: the shape of the OpenRig database on this machine. READ-ONLY, three ways over:
 *   - the connection is opened with SQLite's read-only flag (immutable when nothing is writing, see
 *     openReadOnly), and `PRAGMA query_only = ON` is set;
 *   - the only statements run are SELECTs on sqlite_master and the table-valued pragma functions
 *     pragma_table_info / pragma_foreign_key_list (table and column names and types, never a row);
 *   - the database is in WAL mode, and a read-only connection can neither write nor checkpoint.
 */

export const defaultOpenrigDb = (home = homedir()): string =>
  join(home, '.openrig', 'openrig.sqlite');

const SELECT_OBJECTS =
  "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name";

/**
 * How to open the database without leaving a trace. A WAL-mode database read through an ordinary
 * read-only connection still CREATES `-wal` and `-shm` beside it when they are absent (QA S7 D2),
 * which would put files in ~/.openrig whenever OpenRig is stopped. So:
 *   - no `-wal` beside it: nothing is writing (OpenRig is stopped), so open it `immutable`, which
 *     takes no WAL or shared-memory files at all and creates nothing;
 *   - a `-wal` exists: a live (or crashed) writer's files are already there; open read-only normally
 *     so the reader sees the committed state in the WAL, and creates nothing new.
 */
export function openReadOnly(dbPath: string): DatabaseSync {
  if (!existsSync(`${dbPath}-wal`)) {
    return new DatabaseSync(`${pathToFileURL(dbPath).href}?mode=ro&immutable=1`, {
      readOnly: true,
    });
  }

  return new DatabaseSync(dbPath, { readOnly: true });
}

export function readTables(dbPath: string): DbTable[] {
  const db = openReadOnly(dbPath);
  try {
    db.exec('PRAGMA query_only = ON');
    const objects = db.prepare(SELECT_OBJECTS).all() as { name: string; type: 'table' | 'view' }[];
    const cols = db.prepare(
      'SELECT name, type, "notnull" AS nn, dflt_value, pk FROM pragma_table_info(?)'
    );
    const fks = db.prepare(
      'SELECT "from" AS f, "table" AS t, "to" AS o FROM pragma_foreign_key_list(?)'
    );

    return objects.slice(0, DB_TABLES_MAX).map((o) => ({
      name: o.name,
      kind: o.type,
      columns: (cols.all(o.name) as Record<string, unknown>[])
        .slice(0, DB_COLUMNS_MAX)
        .map((c) => ({
          name: String(c.name),
          type: String(c.type ?? ''),
          notNull: Number(c.nn) === 1,
          pk: Number(c.pk),
          default:
            c.dflt_value === null || c.dflt_value === undefined
              ? null
              : String(c.dflt_value).slice(0, 200),
        })),
      foreignKeys: (fks.all(o.name) as Record<string, unknown>[])
        .slice(0, DB_COLUMNS_MAX)
        .map((k) => ({
          from: String(k.f),
          table: String(k.t),
          to: k.o === null || k.o === undefined ? null : String(k.o),
        })),
    }));
  } finally {
    db.close();
  }
}

/** `rig --version` → "0.6.6 (2620dea8)": the whole first line, which names the build as well as the release. */
export async function readOpenrigVersion(run: Run, rigBin = 'rig'): Promise<string | null> {
  try {
    const r = await run(rigBin, ['--version']);
    const line = r.stdout.split('\n')[0]?.trim();

    return r.code === 0 && line ? line.slice(0, 80) : null;
  } catch {
    return null;
  }
}

export async function sampleSchema(
  machineId: string,
  run: Run,
  opts: { dbPath?: string; rigBin?: string; now?: () => Date } = {}
): Promise<SchemaPush> {
  const dbPath = opts.dbPath ?? defaultOpenrigDb();
  const collectedAt = (opts.now ?? (() => new Date()))().toISOString();
  const base = { machineId, collectedAt, tables: [] as DbTable[] };
  if (!existsSync(dbPath)) {
    return {
      ...base,
      status: 'no-openrig',
      reason: `no OpenRig database at ${dbPath.replace(homedir(), '~')}`,
      openrigVersion: null,
    };
  }
  const openrigVersion = await readOpenrigVersion(run, opts.rigBin);
  try {
    return { ...base, status: 'ok', reason: null, openrigVersion, tables: readTables(dbPath) };
  } catch (e) {
    return {
      ...base,
      status: 'unreadable',
      reason: `could not read the OpenRig database: ${(e as Error).message}`.slice(0, 300),
      openrigVersion,
    };
  }
}

export interface PendingSchema {
  push: SchemaPush;
  markSent(): void;
}

/**
 * Samples rarely (every `ttlMs`, 5 minutes) and hands back a push only when something other than
 * the timestamp changed since the hub last accepted one. Never on the snapshot path.
 */
export class SchemaReader {
  private sentKey: string | null = null;
  private lastSample = 0;

  constructor(
    private readonly machineId: string,
    private readonly run: Run,
    private readonly opts: {
      dbPath?: string;
      rigBin?: string;
      now?: () => Date;
      ttlMs?: number;
    } = {}
  ) {}

  reset(): void {
    this.sentKey = null;
    this.lastSample = 0;
  }

  async next(): Promise<PendingSchema | null> {
    const now = (this.opts.now ?? (() => new Date()))().getTime();
    if (now - this.lastSample < (this.opts.ttlMs ?? 300_000)) {
      return null;
    }
    this.lastSample = now;
    const push = await sampleSchema(this.machineId, this.run, this.opts);
    const key = JSON.stringify({ ...push, collectedAt: null });
    if (key === this.sentKey) {
      return null;
    }

    return { push, markSent: () => (this.sentKey = key) };
  }
}
