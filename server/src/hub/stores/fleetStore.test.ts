import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASLEEP_AFTER_MS } from '@appydave/shared';
import { FleetStore, type LivenessChange } from './fleetStore.js';
import { loadSnapshot, manualClock } from '@server/test/hubHarness.js';

const dirs: string[] = [];

afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('FleetStore writes', () => {
  it('coalesces rapid pushes: the file ends with the latest, and no temp file is left', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'appyrig-store-'));

    dirs.push(dataDir);

    const clock = manualClock();
    const store = new FleetStore({ dataDir, now: clock.now });
    const snap = loadSnapshot('roamy');

    for (let i = 0; i < 20; i++) {
      clock.advance(1_000);
      store.put({ ...snap, collectedAt: clock.now().toISOString() });
    }

    await store.flush();

    const files = readdirSync(join(dataDir, 'snapshots'));

    expect(files).toEqual(['roamy.json']);

    const stored = JSON.parse(readFileSync(join(dataDir, 'snapshots', 'roamy.json'), 'utf8'));

    expect(stored.lastSeen).toBe(clock.now().toISOString());
  });

  it('reports a write it cannot make instead of throwing', async () => {
    const errors: string[] = [];
    // A data dir under a file path can never be created.
    const store = new FleetStore({
      dataDir: '/dev/null/appyrig',
      onDiskError: (m) => errors.push(m),
    });

    expect(() => store.put(loadSnapshot('roamy'))).not.toThrow();
    await store.flush();
    expect(errors.join()).toMatch(/cannot write/);
    expect(store.get('roamy')?.liveness).toBe('live'); // memory still serves
  });

  it('without a data dir it is memory-only', async () => {
    const store = new FleetStore();

    store.put(loadSnapshot('m2'));
    await store.flush();
    expect(await store.load()).toEqual([]);
    expect(store.list().map((m) => m.machine.id)).toEqual(['m2']);
  });
});

describe('FleetStore liveness changes (logged by the hub, so AC 6 is visible in its log)', () => {
  it('reports first push, live -> asleep with lastSeen, and asleep -> live, once each', () => {
    const clock = manualClock();
    const changes: LivenessChange[] = [];
    const store = new FleetStore({ now: clock.now, onLiveness: (c) => changes.push(c) });

    store.put(loadSnapshot('m2'));

    const firstSeen = clock.now().toISOString();

    clock.advance(3_000);
    store.put(loadSnapshot('m2')); // still live: no change

    const lastSeen = clock.now().toISOString();

    clock.advance(ASLEEP_AFTER_MS - 1);
    store.sweep();
    clock.advance(1);
    store.sweep();
    store.sweep(); // already asleep: no change
    clock.advance(60_000);
    store.put(loadSnapshot('m2'));
    expect(changes).toEqual([
      { machine: 'm2', from: null, to: 'live', lastSeen: firstSeen },
      { machine: 'm2', from: 'live', to: 'asleep', lastSeen },
      { machine: 'm2', from: 'asleep', to: 'live', lastSeen: clock.now().toISOString() },
    ]);
  });

  it('a machine loaded asleep from disk reports asleep -> live on its next push', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'appyrig-store-'));

    dirs.push(dataDir);

    const clock = manualClock();
    const first = new FleetStore({ dataDir, now: clock.now });

    first.put(loadSnapshot('roamy'));
    await first.flush();
    clock.advance(3_600_000);

    const changes: LivenessChange[] = [];
    const restarted = new FleetStore({
      dataDir,
      now: clock.now,
      onLiveness: (c) => changes.push(c),
    });

    await restarted.load();
    expect(changes).toEqual([]); // loading is not a change; the hub logs what it loaded separately
    restarted.put(loadSnapshot('roamy'));
    expect(changes.map((c) => `${c.from} -> ${c.to}`)).toEqual(['asleep -> live']);
    await restarted.flush(); // put() starts a write; afterEach must not remove the dir under it
  });
});

const AT = '2026-10-11T12:00:00.000Z';

/** The three stores that load a folder of JSON files and skip what is bad, each with its own wording. */
const FOLDER_STORES: {
  name: string;
  dir: string;
  notA: string;
  seed: (s: FleetStore) => void;
  load: (s: FleetStore) => Promise<number>;
}[] = [
  {
    name: 'histories',
    dir: 'history',
    notA: 'a seat history',
    seed: (s) =>
      s.putHistory({
        machineId: 'roamy',
        seat: 'a@r',
        collectedAt: AT,
        events: [],
        truncated: false,
      }),
    load: (s) => s.loadHistories(),
  },
  {
    name: 'handoffs',
    dir: 'handoffs',
    notA: 'stored queue bodies',
    seed: (s) =>
      s.putHandoffs({
        machineId: 'roamy',
        collectedAt: AT,
        items: [{ id: 'q1', body: 'b', truncated: false }],
      }),
    load: (s) => s.loadHandoffs(),
  },
  {
    name: 'schemas',
    dir: 'schemas',
    notA: 'a stored schema',
    seed: (s) =>
      s.schemas.put({
        machineId: 'roamy',
        collectedAt: AT,
        status: 'ok',
        reason: null,
        openrigVersion: '1.0.0',
        tables: [],
      }),
    load: (s) => s.schemas.load(),
  },
];

describe.each(FOLDER_STORES)('$name load: a folder of JSON files, bad ones skipped', (kind) => {
  function open() {
    const dataDir = mkdtempSync(join(tmpdir(), 'appyrig-folder-'));

    dirs.push(dataDir);

    const told: string[] = [];
    const store = () => new FleetStore({ dataDir, onDiskError: (m) => told.push(m) });

    return { dataDir, told, store, dir: join(dataDir, kind.dir) };
  }

  it("loads the good file, skips bad JSON and a wrong shape, each said in this store's words", async () => {
    const { store, told, dir } = open();
    const first = store();

    kind.seed(first);
    await first.flush();
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    writeFileSync(join(dir, 'wrong.json'), '{}');
    writeFileSync(join(dir, 'ignored.txt'), 'not a .json file');

    expect(await kind.load(store())).toBe(1);
    expect(told.sort()).toEqual(
      [
        `cannot load ${join(dir, 'broken.json')}; skipped`,
        `${join(dir, 'wrong.json')} is not ${kind.notA}; skipped`,
      ].sort()
    );
  });

  it('a folder that does not exist yet is silent', async () => {
    const { store, told } = open();

    expect(await kind.load(store())).toBe(0);
    expect(told).toEqual([]);
  });

  it('a folder it cannot read is said once and loads nothing', async () => {
    const { store, told, dir } = open();

    writeFileSync(dir, 'a file where the folder should be');

    expect(await kind.load(store())).toBe(0);
    expect(told).toEqual([`cannot read ${dir}`]);
  });
});
