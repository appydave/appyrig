import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FleetStore, type LivenessChange } from './fleetStore.js';
import { loadSnapshot, manualClock } from '../test/hubHarness.js';

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
    clock.advance(14_999);
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
  });
});
