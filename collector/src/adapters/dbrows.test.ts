import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DB_CELL_MAX,
  DB_HIDDEN_CELL,
  DB_ROWS_BYTES_MAX,
  DB_ROWS_MAX,
  DB_SECRET_COLUMN,
  DbRowsPushSchema,
} from '@appydave/shared';
import { DbRowsReader, readAllTableRows } from './dbrows.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function makeDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'appyrig-rows-'));
  dirs.push(dir);
  const path = join(dir, 'openrig.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE sessions (id INTEGER PRIMARY KEY, name TEXT, resume_token TEXT, note TEXT, data BLOB);
    CREATE TABLE big (id INTEGER PRIMARY KEY, v TEXT);
    CREATE TABLE fat (id INTEGER PRIMARY KEY, c0 TEXT, c1 TEXT, c2 TEXT, c3 TEXT, c4 TEXT, c5 TEXT, c6 TEXT, c7 TEXT, c8 TEXT, c9 TEXT);
    CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID;
    CREATE VIEW v_sessions AS SELECT name FROM sessions;
  `);
  const ins = db.prepare(
    'INSERT INTO sessions (name, resume_token, note, data) VALUES (?, ?, ?, ?)'
  );
  ins.run(
    'dev-build',
    'plain-unprefixed-token-123',
    'key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    new Uint8Array(7)
  );
  ins.run('dev-qa', null, 'x'.repeat(DB_CELL_MAX + 50).replace(/x/g, 'a b '), null);
  const big = db.prepare('INSERT INTO big (v) VALUES (?)');
  for (let i = 1; i <= DB_ROWS_MAX + 20; i++) big.run(`row ${i}`);
  const fat = db.prepare(
    'INSERT INTO fat (c0, c1, c2, c3, c4, c5, c6, c7, c8, c9) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  // ten wide text columns: 500 rows of ~2 KB each overflow the 600 KB per-push cap
  for (let i = 0; i < 500; i++) fat.run(...Array.from({ length: 10 }, () => 'word '.repeat(60)));
  db.prepare('INSERT INTO kv VALUES (?, ?)').run('a', '1');
  db.close();
  return path;
}

const hash = (p: string) => createHash('sha1').update(readFileSync(p)).digest('hex');

describe('B5 readAllTableRows', () => {
  it('reads tables (not views) newest first, redacted, secret-named columns blanked, blobs described', () => {
    const path = makeDb();
    const pushes = readAllTableRows('m2', path, '2026-10-12T00:00:00.000Z');
    expect(pushes.map((p) => p.table)).toEqual(['big', 'fat', 'kv', 'sessions']);
    for (const p of pushes) expect(DbRowsPushSchema.safeParse(p).success).toBe(true);
    const s = pushes.find((p) => p.table === 'sessions')!;
    expect(s).toMatchObject({
      total: 2,
      truncated: false,
      order: 'rowid',
      hiddenColumns: ['resume_token'],
    });
    const [newest, oldest] = s.rows;
    expect(newest![1]).toBe('dev-qa');
    // readable but short: ~200 characters, then … and the full length
    expect(String(newest![3])).toMatch(new RegExp(`^.{${DB_CELL_MAX}}… \\(\\d[\\d,]* chars\\)$`));
    expect(oldest![2]).toBe(DB_HIDDEN_CELL);
    expect(String(oldest![3])).not.toContain('sk-ant-api03');
    expect(oldest![4]).toBe('(blob 7 bytes)');
  });

  it('caps rows per table and bytes per push, and says the table was cut', () => {
    const pushes = readAllTableRows('m2', makeDb(), '2026-10-12T00:00:00.000Z');
    const big = pushes.find((p) => p.table === 'big')!;
    expect(big).toMatchObject({ total: DB_ROWS_MAX + 20, truncated: true });
    expect(big.rows).toHaveLength(DB_ROWS_MAX);
    expect(big.rows[0]![1]).toBe(`row ${DB_ROWS_MAX + 20}`);
    const fat = pushes.find((p) => p.table === 'fat')!;
    expect(fat.truncated).toBe(true);
    expect(fat.rows.length).toBeLessThan(500);
    expect(Buffer.byteLength(JSON.stringify(fat.rows))).toBeLessThanOrEqual(DB_ROWS_BYTES_MAX + 2);
  });

  it('a WITHOUT ROWID table is read in stored order', () => {
    const kv = readAllTableRows('m2', makeDb(), '2026-10-12T00:00:00.000Z').find(
      (p) => p.table === 'kv'
    )!;
    expect(kv).toMatchObject({ order: null, rows: [['a', '1']] });
  });

  it('is read-only: the file is byte-identical and nothing is created beside it', () => {
    const path = makeDb();
    const before = hash(path);
    readAllTableRows('m2', path, '2026-10-12T00:00:00.000Z');
    expect(hash(path)).toBe(before);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
    expect(existsSync(`${path}-journal`)).toBe(false);
  });
});

describe('B5 DbRowsReader', () => {
  it('sends every table once, then only when the database changed, and again after reset', async () => {
    const path = makeDb();
    let t = 60_000;
    const r = new DbRowsReader('m2', path, () => new Date(t), 60_000);
    const first = await r.next();
    expect(first?.pushes).toHaveLength(4);
    first!.markSent();
    t += 60_000;
    expect(await r.next()).toBeNull();
    const db = new DatabaseSync(path);
    db.prepare('INSERT INTO kv VALUES (?, ?)').run('b', '2');
    db.close();
    t += 60_000;
    const changed = await r.next();
    expect(changed?.pushes.map((p) => p.table)).toEqual(['kv']);
    changed!.markSent();
    r.reset();
    expect((await r.next())?.pushes).toHaveLength(4);
  });

  it('no database: nothing to send', async () => {
    expect(
      await new DbRowsReader('m2', '/nope/openrig.sqlite', () => new Date(60_000)).next()
    ).toBeNull();
  });
});

describe('F2 (security #6): column names that look secret', () => {
  it('hides auth, cookie, session id, bearer, oauth and env columns', () => {
    for (const c of [
      'auth',
      'auth_header',
      'authorization',
      'session_cookie',
      'bearer',
      'oauth_state',
      'env',
      'env_json',
      'environment',
      'session_id',
      'native_session_id_at_boot',
      'resume_token',
    ])
      expect(DB_SECRET_COLUMN.test(c), c).toBe(true);
  });

  it('keeps the seat-name columns and ordinary words readable', () => {
    for (const c of [
      'source_session',
      'destination_session',
      'session_name',
      'tmux_session',
      'author',
      'event',
      'inventory',
      'seat_session',
    ])
      expect(DB_SECRET_COLUMN.test(c), c).toBe(false);
  });
});
