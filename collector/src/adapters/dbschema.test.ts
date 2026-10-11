import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readOpenrigVersion, readTables, sampleSchema, SchemaReader } from './dbschema.js';
import type { Run } from './health.js';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'appyrig-db-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A stand-in OpenRig database: WAL mode, a link between two tables, a view, rows that must never be read. */
function makeDb(extra = '') {
  const path = join(tmp(), 'openrig.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE rigs (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT DEFAULT 'running');
    CREATE TABLE nodes (id TEXT PRIMARY KEY, rig_id TEXT NOT NULL REFERENCES rigs(id), n INTEGER);
    CREATE VIEW running_nodes AS SELECT * FROM nodes;
    INSERT INTO rigs VALUES ('r1', 'SECRET-ROW-VALUE-DO-NOT-READ', 'running');
    ${extra}
  `);
  db.close();
  return path;
}

const rigRun =
  (out = '0.6.6 (2620dea8)\n', code = 0): Run =>
  async () => ({ stdout: out, stderr: '', code });

describe('readTables (read-only)', () => {
  it('lists tables and views with columns, types, nullability, primary key, defaults and foreign keys', () => {
    const t = readTables(makeDb());
    expect(t.map((x) => [x.name, x.kind])).toEqual([
      ['nodes', 'table'],
      ['rigs', 'table'],
      ['running_nodes', 'view'],
    ]);
    const rigs = t.find((x) => x.name === 'rigs')!;
    expect(rigs.columns).toEqual([
      { name: 'id', type: 'TEXT', notNull: false, pk: 1, default: null },
      { name: 'name', type: 'TEXT', notNull: true, pk: 0, default: null },
      { name: 'status', type: 'TEXT', notNull: false, pk: 0, default: "'running'" },
    ]);
    expect(t.find((x) => x.name === 'nodes')!.foreignKeys).toEqual([
      { from: 'rig_id', table: 'rigs', to: 'id' },
    ]);
  });

  /** name, size and mtime of everything in a folder: what "nothing was created or touched" means. */
  const listing = (dir: string) =>
    readdirSync(dir)
      .sort()
      .map((n) => [n, statSync(join(dir, n)).size, statSync(join(dir, n)).mtimeMs]);

  it('QA D2: with OpenRig STOPPED (no -wal, no -shm) a read creates nothing beside the database', async () => {
    const path = makeDb(); // closed cleanly: only the .sqlite file is left
    const dir = join(path, '..');
    expect(readdirSync(dir)).toEqual(['openrig.sqlite']);
    const before = listing(dir);
    readTables(path);
    readTables(path);
    await sampleSchema('m2', rigRun(), { dbPath: path });
    expect(listing(dir)).toEqual(before);
    expect(readdirSync(dir)).toEqual(['openrig.sqlite']); // no -wal, no -shm appeared
    // and it still reads the real contents
    expect(readTables(path).map((t) => t.name)).toEqual(['nodes', 'rigs', 'running_nodes']);
  });

  it('QA D2: with OpenRig RUNNING (a -wal exists) a read still creates and changes nothing, and sees the WAL', () => {
    const path = makeDb();
    const dir = join(path, '..');
    const writer = new DatabaseSync(path);
    writer.exec('ALTER TABLE rigs ADD COLUMN in_the_wal TEXT'); // committed to the -wal, not yet checkpointed
    expect(readdirSync(dir).sort()).toEqual([
      'openrig.sqlite',
      'openrig.sqlite-shm',
      'openrig.sqlite-wal',
    ]);
    const before = listing(dir);
    const t = readTables(path);
    expect(listing(dir)).toEqual(before);
    expect(t.find((x) => x.name === 'rigs')!.columns.map((c) => c.name)).toContain('in_the_wal');
    writer.close();
  });

  it('a path with spaces and odd characters opens (the immutable form is a file: URL)', () => {
    const path = makeDb();
    const odd = join(path, '..', 'my openrig #1 %20.sqlite');
    copyFileSync(path, odd);
    expect(readTables(odd).map((t) => t.name)).toContain('rigs');
    expect(readdirSync(join(path, '..')).sort()).toEqual([
      'my openrig #1 %20.sqlite',
      'openrig.sqlite',
    ]);
  });

  it('never reads a row: the output holds no row value', () => {
    expect(JSON.stringify(readTables(makeDb()))).not.toContain('SECRET-ROW-VALUE');
  });

  it('leaves the database exactly as it was: no write, no checkpoint, no new file', () => {
    const path = makeDb();
    const dir = join(path, '..');
    // keep a writer open so the -wal file is live while we read, as OpenRig's daemon does
    const writer = new DatabaseSync(path);
    writer.exec("INSERT INTO rigs VALUES ('r2', 'x', 'y')");
    const before = readdirSync(dir).map((n) => [
      n,
      statSync(join(dir, n)).size,
      statSync(join(dir, n)).mtimeMs,
    ]);
    readTables(path);
    readTables(path);
    const after = readdirSync(dir).map((n) => [
      n,
      statSync(join(dir, n)).size,
      statSync(join(dir, n)).mtimeMs,
    ]);
    writer.close();
    expect(after).toEqual(before);
    const check = new DatabaseSync(path, { readOnly: true });
    expect((check.prepare('SELECT count(*) AS n FROM rigs').get() as { n: number }).n).toBe(2);
    check.close();
  });

  it('a read-only connection cannot be written through (the flag itself is enforced)', () => {
    const path = makeDb();
    const ro = new DatabaseSync(path, { readOnly: true });
    expect(() => ro.exec("INSERT INTO rigs VALUES ('r9', 'x', 'y')")).toThrow(
      /readonly|read-only/i
    );
    expect(() => ro.exec('CREATE TABLE sneaky (a)')).toThrow(/readonly|read-only/i);
    ro.close();
  });
});

describe('sampleSchema', () => {
  const now = () => new Date('2026-10-11T12:00:00.000Z');
  it('ok: the tables and the version `rig --version` named', async () => {
    const s = await sampleSchema('m2', rigRun(), { dbPath: makeDb(), now });
    expect(s).toMatchObject({
      machineId: 'm2',
      status: 'ok',
      reason: null,
      openrigVersion: '0.6.6 (2620dea8)',
      collectedAt: now().toISOString(),
    });
    expect(s.tables).toHaveLength(3);
  });
  it('no database on the machine is no-openrig with a reason (the M4), and nothing is created', async () => {
    const dir = tmp();
    const s = await sampleSchema('m4', rigRun('', 1), {
      dbPath: join(dir, '.openrig', 'openrig.sqlite'),
      now,
    });
    expect(s).toMatchObject({ status: 'no-openrig', openrigVersion: null, tables: [] });
    expect(s.reason).toMatch(/no OpenRig database/);
    expect(existsSync(join(dir, '.openrig'))).toBe(false);
  });
  it('a file that is not a database is unreadable with a reason, not a crash', async () => {
    const dir = tmp();
    const bad = join(dir, 'openrig.sqlite');
    new DatabaseSync(bad).close();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(bad, 'this is not sqlite at all, just text '.repeat(40));
    const s = await sampleSchema('m2', rigRun(), { dbPath: bad, now });
    expect(s.status).toBe('unreadable');
    expect(s.reason).toMatch(/could not read the OpenRig database/);
  });
  it('a version that cannot be read is null, and the tables still come back', async () => {
    const s = await sampleSchema('m2', rigRun('', 1), { dbPath: makeDb(), now });
    expect(s.status).toBe('ok');
    expect(s.openrigVersion).toBeNull();
    expect(
      await readOpenrigVersion(async () => {
        throw new Error('rig not found');
      })
    ).toBeNull();
  });
});

describe('SchemaReader', () => {
  it('samples rarely, sends on change only, and again after reset()', async () => {
    const dbPath = makeDb();
    let t = 1_000_000;
    const r = new SchemaReader('m2', rigRun(), { dbPath, now: () => new Date(t), ttlMs: 300_000 });
    const first = await r.next();
    expect(first?.push.status).toBe('ok');
    expect(await r.next()).toBeNull(); // inside the ttl
    t += 301_000;
    expect(await r.next()).not.toBeNull(); // not accepted yet: same content, still pending
    first!.markSent();
    t += 301_000;
    expect(await r.next()).toBeNull(); // unchanged since accepted (timestamp aside)
    const db = new DatabaseSync(dbPath);
    db.exec('ALTER TABLE rigs ADD COLUMN owner TEXT');
    db.close();
    t += 301_000;
    const changed = await r.next();
    expect(
      changed?.push.tables.find((x) => x.name === 'rigs')?.columns.map((c) => c.name)
    ).toContain('owner');
    changed!.markSent();
    r.reset();
    t += 1;
    expect(await r.next()).not.toBeNull();
  });
});
