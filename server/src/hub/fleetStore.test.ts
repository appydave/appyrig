import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FleetStore } from './fleetStore.js';
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
