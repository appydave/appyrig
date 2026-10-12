import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  DB_CELL_MAX,
  DB_HIDDEN_CELL,
  DB_ROWS_BYTES_MAX,
  DB_ROWS_MAX,
  DB_SECRET_COLUMN,
  type DbCell,
  type DbRowsPush,
} from '@appydave/shared';
import { redactString } from '../redact.js';
import { defaultOpenrigDb, openReadOnly } from './dbschema.js';

/**
 * Batch 1 · B5 (fb-0003): the OpenRig database's rows, read-only, for the schema view.
 *
 * READ-ONLY exactly as the schema read (dbschema.ts): the same openReadOnly connection (read-only
 * flag; immutable, creating no files, when OpenRig is stopped), `PRAGMA query_only = ON`, and only
 * SELECT statements. Per table: COUNT(*), then the newest rows by rowid up to DB_ROWS_MAX and
 * DB_ROWS_BYTES_MAX. Text is redacted and capped at DB_CELL_MAX; a BLOB is described, never sent.
 */

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function cellOf(v: unknown): DbCell {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint')
    return v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(v)
      : v.toString();
  if (v instanceof Uint8Array) return `(blob ${v.byteLength} bytes)`;
  const s = redactString(String(v));
  return s.length > DB_CELL_MAX ? `${s.slice(0, DB_CELL_MAX - 1)}…` : s;
}

export function readAllTableRows(
  machineId: string,
  dbPath: string,
  collectedAt: string
): DbRowsPush[] {
  const db = openReadOnly(dbPath);
  try {
    db.exec('PRAGMA query_only = ON');
    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as { name: string }[]
    ).map((t) => t.name);
    const colsOf = db.prepare('SELECT name FROM pragma_table_info(?) ORDER BY cid');
    const out: DbRowsPush[] = [];
    for (const table of tables) {
      const columns = (colsOf.all(table) as { name: string }[]).map((c) => String(c.name));
      const total = Number(
        (db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get() as { n: number }).n
      );
      let raw: Record<string, unknown>[];
      let order: 'rowid' | null = 'rowid';
      try {
        raw = db
          .prepare(`SELECT * FROM ${quote(table)} ORDER BY rowid DESC LIMIT ${DB_ROWS_MAX}`)
          .all() as Record<string, unknown>[];
      } catch {
        // WITHOUT ROWID tables have no rowid: their stored order
        order = null;
        raw = db.prepare(`SELECT * FROM ${quote(table)} LIMIT ${DB_ROWS_MAX}`).all() as Record<
          string,
          unknown
        >[];
      }
      const hidden = columns.filter((c) => DB_SECRET_COLUMN.test(c));
      const rows: DbCell[][] = [];
      let bytes = 0;
      for (const r of raw) {
        const row = columns.map((c) => (hidden.includes(c) ? DB_HIDDEN_CELL : cellOf(r[c])));
        // The byte cap counts what is actually sent: the serialized row.
        bytes += Buffer.byteLength(JSON.stringify(row));
        if (bytes > DB_ROWS_BYTES_MAX) break;
        rows.push(row);
      }
      out.push({
        machineId,
        collectedAt,
        table,
        columns,
        total,
        rows,
        truncated: rows.length < total,
        order,
        hiddenColumns: hidden,
      });
    }
    return out;
  } finally {
    db.close();
  }
}

export interface PendingDbRows {
  pushes: DbRowsPush[];
  markSent(): void;
}

/**
 * Reads the rows at most every `ttlMs`, and only when the database files changed (size or mtime of
 * the db and its -wal); hands back only the tables whose rows changed since the hub accepted them.
 */
export class DbRowsReader {
  private readonly sent = new Map<string, string>();
  private lastRead = 0;
  private fileSig = '';

  constructor(
    private readonly machineId: string,
    private readonly dbPath: string = defaultOpenrigDb(),
    private readonly now: () => Date = () => new Date(),
    private readonly ttlMs = 60_000
  ) {}

  /** Forget what was sent (a reconnect: the hub may have restarted and holds nothing). */
  reset(): void {
    this.sent.clear();
    this.lastRead = 0;
    this.fileSig = '';
  }

  async next(): Promise<PendingDbRows | null> {
    if (this.now().getTime() - this.lastRead < this.ttlMs) return null;
    this.lastRead = this.now().getTime();
    if (!existsSync(this.dbPath)) return null;
    const sigOf = async (p: string) => {
      try {
        const st = await stat(p);
        return `${st.size}:${st.mtimeMs}`;
      } catch {
        return '-';
      }
    };
    const fileSig = `${await sigOf(this.dbPath)}|${await sigOf(`${this.dbPath}-wal`)}`;
    if (fileSig === this.fileSig) return null;
    let pushes: DbRowsPush[];
    try {
      pushes = readAllTableRows(this.machineId, this.dbPath, this.now().toISOString());
    } catch {
      return null; // unreadable this round (db.schema reports why); the next round retries
    }
    const changed: DbRowsPush[] = [];
    const sigs = new Map<string, string>();
    for (const p of pushes) {
      const sig = createHash('sha1')
        .update(JSON.stringify({ ...p, collectedAt: '' }))
        .digest('hex');
      if (this.sent.get(p.table) === sig) continue;
      changed.push(p);
      sigs.set(p.table, sig);
    }
    const thisSig = fileSig;
    if (changed.length === 0) {
      this.fileSig = thisSig;
      return null;
    }
    return {
      pushes: changed,
      markSent: () => {
        sigs.forEach((sig, t) => this.sent.set(t, sig));
        this.fileSig = thisSig;
      },
    };
  }
}
