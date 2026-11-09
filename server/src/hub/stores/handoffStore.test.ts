import { describe, it, expect } from 'vitest';
import { HANDOFF_STORE_MAX, type MachineSnapshot } from '@appydave/shared';
import { FleetStore } from './fleetStore.js';
import { loadSnapshot } from '@server/test/hubHarness.js';

const bodies = (ids: string[]) => ({
  machineId: 'roamy',
  collectedAt: '2026-10-11T12:00:00.000Z',
  items: ids.map((id) => ({ id, body: `b ${id}`, truncated: false })),
});

describe('queue body store cap (QA D1)', () => {
  it('past the cap it drops the OLDEST items, not the earliest arrivals', () => {
    // 1600 ids, id order = age. The machine's queue rows are the newest 500.
    const ids = Array.from(
      { length: HANDOFF_STORE_MAX + 100 },
      (_, i) => `q${String(i).padStart(5, '0')}`
    );
    const base = Date.parse('2026-10-01T00:00:00.000Z');
    const rows = ids.slice(-500).map((id) => {
      const t = new Date(base + ids.indexOf(id) * 60_000).toISOString();

      return {
        id,
        source: 'a@r',
        destination: 'b@r',
        state: 'done',
        priority: null,
        tags: [],
        summary: null,
        createdAt: t,
        updatedAt: t,
      };
    });
    const snapshot = { ...loadSnapshot('roamy'), queue: rows } as MachineSnapshot;
    const store = new FleetStore();

    store.put(snapshot);

    // the collector sends newest first, in batches of 100
    const newestFirst = [...ids].reverse();

    for (let i = 0; i < newestFirst.length; i += 100) {
      store.putHandoffs(bodies(newestFirst.slice(i, i + 100)));
    }

    // every item a person can open (the 500 rows) is still there, including the 100 newest
    for (const row of rows) {
      expect(store.getHandoff('roamy', row.id), row.id).toBeDefined();
    }

    // and what went was the oldest
    expect(store.getHandoff('roamy', ids[0]!)).toBeUndefined();
    expect(store.getHandoff('roamy', ids[99]!)).toBeUndefined();
  });

  it('with no queue rows known yet it still stays within the cap', () => {
    const store = new FleetStore();
    const ids = Array.from(
      { length: HANDOFF_STORE_MAX + 5 },
      (_, i) => `q${String(i).padStart(5, '0')}`
    );

    for (let i = 0; i < ids.length; i += 100) {
      store.putHandoffs(bodies(ids.slice(i, i + 100)));
    }

    const kept = ids.filter((id) => store.getHandoff('roamy', id));

    expect(kept).toHaveLength(HANDOFF_STORE_MAX);
  });
});
