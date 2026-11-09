import { describe, expect, it } from 'vitest';
import type { QueueItem } from '@appydave/shared';
import { oldestFirst } from '@client/domain/fleet/views/map/edges.js';
import type { MapEdge } from '@client/domain/fleet/views/map/types.js';
import { filterHistory, type HistFilters, type HistRow } from './model.js';

/** AFTER audit X3: the contract allows any offset, so the text order is not the time order. */
const EARLIER = '2026-11-09T10:00:00+07:00'; // 03:00Z
const LATER = '2026-11-09T05:00:00.000Z';

describe('sorted by the moment, not the text', () => {
  it('Rig Map: a line lists its handoffs oldest first, whatever offset they carry', () => {
    const item = (id: string, createdAt: string) => ({ id, createdAt }) as QueueItem;
    const edge = { items: [item('later', LATER), item('earlier', EARLIER)] } as MapEdge;

    expect(oldestFirst(new Map([['k', edge]]))[0]!.items.map((q) => q.id)).toEqual([
      'earlier',
      'later',
    ]);
  });

  it('History: the newest event comes first, whatever offset it carries', () => {
    const row = (key: string, at: string) => ({ key, at }) as HistRow;
    const rows = filterHistory([row('earlier', EARLIER), row('later', LATER)], {
      text: '',
    } as HistFilters);

    expect(rows.map((r) => r.key)).toEqual(['later', 'earlier']);
  });
});
