import { describe, expect, it } from 'vitest';
import type { DbRowsOutput } from '@appydave/shared';
import { rowsCaption } from './SchemaRows.js';

const out = (o: Partial<DbRowsOutput>): DbRowsOutput => ({
  machine: 'm2',
  table: 'events',
  status: 'ok',
  reason: null,
  collectedAt: '2026-10-12T00:00:00.000Z',
  columns: ['id'],
  total: 16106,
  held: 500,
  truncated: true,
  order: 'rowid',
  hiddenColumns: [],
  offset: 0,
  rows: Array.from({ length: 50 }, (_, i) => [i]),
  ...o,
});

describe('B5 rowsCaption: says plainly when a table is cut', () => {
  it('a cut table names how many of how many', () => {
    expect(rowsCaption(out({}))).toBe(
      'Rows 1–50 of 500 held, newest first. Showing the newest 500 of 16,106: the rest are not sent (at most 500 rows and 600 KB per table).'
    );
  });
  it('a whole table just pages', () => {
    expect(
      rowsCaption(out({ total: 61, held: 61, truncated: false, offset: 50, rows: [[1]] }))
    ).toBe('Rows 51–51 of 61 held, newest first.');
    expect(rowsCaption(out({ total: 0, held: 0, truncated: false, rows: [] }))).toBe(
      'This table is empty.'
    );
  });
});
