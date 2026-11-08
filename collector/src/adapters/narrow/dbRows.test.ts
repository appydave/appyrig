import { describe, expect, it } from 'vitest';
import type { SQLOutputValue } from 'node:sqlite';
import {
  ColumnRow,
  CountRow,
  ForeignKeyRow,
  NameRow,
  ObjectRow,
  parseRow,
  parseRows,
} from './dbRows.js';

type Row = Record<string, SQLOutputValue>;

describe('row schemas accept what SQLite returns for the queries the adapters run', () => {
  it('table or view, name only, count', () => {
    expect(
      parseRows(
        ObjectRow,
        [
          { name: 'a', type: 'table' },
          { name: 'v', type: 'view' },
        ],
        'x'
      )
    ).toEqual([
      { name: 'a', type: 'table' },
      { name: 'v', type: 'view' },
    ]);
    expect(parseRows(NameRow, [{ name: 'a' }], 'x')).toEqual([{ name: 'a' }]);
    expect(parseRow(CountRow, { n: 3 }, 'x')).toEqual({ n: 3 });
  });
  it('a column keeps a null type and every SQL value kind as its default', () => {
    for (const dflt of [null, 1, 2n, 'x', new Uint8Array([1])]) {
      const row: Row = { name: 'c', type: null, nn: 0, dflt_value: dflt, pk: 1 };

      expect(parseRows(ColumnRow, [row], 'x')[0]).toEqual(row);
    }
  });
  it('a foreign key keeps a null target column', () => {
    expect(parseRows(ForeignKeyRow, [{ f: 'a', t: 'b', o: null }], 'x')).toEqual([
      { f: 'a', t: 'b', o: null },
    ]);
  });
});

describe('row schemas refuse the wrong shape, naming what was seen', () => {
  it('a blob name, an unknown object type, a missing field, a string count', () => {
    expect(() => parseRows(NameRow, [{ name: new Uint8Array(3) }], 'table list')).toThrow(
      'unexpected table list row from the OpenRig database: name=(blob 3 bytes)'
    );
    expect(() => parseRows(ObjectRow, [{ name: 'a', type: 'index' }], 'x')).toThrow(/type="index"/);
    expect(() => parseRows(ObjectRow, [{ name: 7, type: 'table' }], 'x')).toThrow(/name=7/);
    for (const bad of [
      { name: 1, type: 'T', nn: 0, dflt_value: null, pk: 0 },
      { name: 'c', type: 'T', nn: '0', dflt_value: null, pk: 0 },
      { name: 'c', type: 'T', nn: 0, dflt_value: null, pk: '0' },
    ]) {
      expect(() => parseRows(ColumnRow, [bad], 'x')).toThrow(/unexpected x row/);
    }

    expect(() => parseRows(ColumnRow, [{ name: 'c', type: 'T', nn: 0, pk: 0 }], 'x')).toThrow(
      /unexpected x row/
    );
    expect(() => parseRow(CountRow, { n: '3' }, 'x')).toThrow(/n="3"/);
    expect(() => parseRows(CountRow, [{ n: 5n }], 'x')).toThrow(/n="5"/);
  });
  it('a missing single row is refused, and a long row is cut', () => {
    expect(() => parseRow(CountRow, undefined, 'row count of t')).toThrow(
      'returned no row count of t row'
    );

    let message = '';

    try {
      parseRows(NameRow, [{ name: 1, pad: 'p'.repeat(500) }], 'x');
    } catch (e) {
      message = e instanceof Error ? e.message : '';
    }

    expect(message).toMatch(/^unexpected x row/);
    expect(message.length).toBeLessThan(200);
  });
});
