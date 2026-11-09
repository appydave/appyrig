import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SeatHistory, SeatLoadout } from '@appydave/shared';
import { FleetStore } from '@server/hub/stores/fleetStore.js';
import { LoadoutStore } from '@server/hub/stores/loadoutStore.js';
import { MissionFileStore } from '@server/hub/stores/missionFileStore.js';
import { RigFileStore } from '@server/hub/stores/rigFileStore.js';
import { MEMORY_LIMITS, RecentMap } from './recentMap.js';

/** Every store keyed by a seat or rig name: names come and go, so memory must not follow them up. */

const AT = '2026-11-09T00:00:00.000Z';
const dirs: string[] = [];

afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const history = (seat: string): SeatHistory => ({
  machineId: 'roamy',
  seat,
  collectedAt: AT,
  events: [],
  truncated: false,
});
const seats = (n: number) => Array.from({ length: n }, (_, i) => `s${i}@r`);

function diskStore() {
  const dataDir = mkdtempSync(join(tmpdir(), 'appyrig-bound-'));

  dirs.push(dataDir);

  return { store: new FleetStore({ dataDir }), dataDir };
}

describe('Feature: RecentMap', () => {
  it('Scenario: given more entries than its limit, then the least recently set or read goes', () => {
    const m = new RecentMap<string, number>(2);

    m.set('a', 1).set('b', 2);
    expect(m.get('a')).toBe(1); // 'a' is now the newer of the two
    m.set('c', 3);

    expect([...m.keys()]).toEqual(['a', 'c']);
  });

  it('Scenario: given a key set again, then it is not counted twice', () => {
    const m = new RecentMap<string, number>(2);

    m.set('a', 1).set('a', 2).set('b', 3);

    expect(m.size).toBe(2);
    expect(m.get('a')).toBe(2);
  });

  it('Scenario: given a falsy stored value, then a read still finds it', () => {
    const m = new RecentMap<string, number>(1);

    m.set('a', 0);

    expect(m.get('a')).toBe(0);
  });
});

describe('Feature: seat histories stay bounded in memory and whole on disk', () => {
  const over = seats(MEMORY_LIMITS.historySeats + 20);

  it('Scenario: given more seats than the limit, then memory holds the limit and every file stays', async () => {
    const { store, dataDir } = diskStore();

    over.forEach((s) => store.putHistory(history(s)));
    await store.flush();

    expect(await store.loadHistories()).toBe(MEMORY_LIMITS.historySeats);
    expect(readdirSync(join(dataDir, 'history'))).toHaveLength(over.length);
  });

  it('Scenario: given a seat dropped from memory, then its history is read back from disk', async () => {
    const { store } = diskStore();

    over.forEach((s) => store.putHistory(history(s)));
    await store.flush();

    expect(store.getHistory('roamy', over[0]!)?.seat).toBe(over[0]);
  });

  it('Scenario: given a seat that never had a history, then there is none and nothing throws', () => {
    expect(diskStore().store.getHistory('roamy', 'never@r')).toBeUndefined();
  });

  it('Scenario: given no data directory, then a dropped seat is simply gone', () => {
    const store = new FleetStore();

    over.forEach((s) => store.putHistory(history(s)));

    expect(store.getHistory('roamy', over[0]!)).toBeUndefined();
    expect(store.getHistory('roamy', over.at(-1)!)?.seat).toBe(over.at(-1));
  });
});

describe('Feature: the memory-only stores drop the longest-unused name', () => {
  it('Scenario: loadouts', () => {
    const store = new LoadoutStore();
    const names = seats(MEMORY_LIMITS.loadoutSeats + 1);

    names.forEach((seat) => store.put({ machineId: 'roamy', seat } as SeatLoadout));

    expect(store.get('roamy', names[0]!)).toBeUndefined();
    expect(store.get('roamy', names.at(-1)!)).toBeDefined();
  });

  it('Scenario: rig files', () => {
    const store = new RigFileStore();
    const rigs = seats(MEMORY_LIMITS.fileRigs + 1);

    rigs.forEach((rig) =>
      store.put({ machineId: 'roamy', collectedAt: AT, rig, replace: true, files: [] })
    );

    expect(store.has('roamy', rigs[0]!)).toBe(false);
    expect(store.has('roamy', rigs.at(-1)!)).toBe(true);
  });

  it('Scenario: mission file lists', () => {
    const store = new MissionFileStore();
    const rigs = seats(MEMORY_LIMITS.missionRigs + 1);

    rigs.forEach((rig) =>
      store.put({ kind: 'manifest', machineId: 'roamy', collectedAt: AT, rig, paths: ['/a'] })
    );

    expect(store.list('roamy', rigs[0]!)).toBeUndefined();
    expect(store.list('roamy', rigs.at(-1)!)).toEqual(['/a']);
  });
});
