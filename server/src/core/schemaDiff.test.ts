import { describe, it, expect } from 'vitest';
import type { DbColumn, DbTable } from '@appydave/shared';
import { diffSchemas } from './schemaDiff.js';

const col = (name: string, type = 'TEXT', o: Partial<DbColumn> = {}): DbColumn => ({
  name,
  type,
  notNull: false,
  pk: 0,
  default: null,
  ...o,
});
const table = (name: string, columns: DbColumn[], fks: DbTable['foreignKeys'] = []): DbTable => ({
  name,
  kind: 'table',
  columns,
  foreignKeys: fks,
});

describe('diffSchemas', () => {
  const v1 = [
    table('rigs', [col('id', 'TEXT', { pk: 1 }), col('name')]),
    table('nodes', [col('id'), col('rig_id')], [{ from: 'rig_id', table: 'rigs', to: 'id' }]),
  ];

  it('no earlier version is a baseline, with nothing to compare', () => {
    expect(diffSchemas(null, v1)).toEqual({
      status: 'baseline',
      comparedTo: null,
      addedTables: [],
      removedTables: [],
      changedTables: [],
    });
  });

  it('the same schema under a new version is unchanged', () => {
    expect(diffSchemas({ version: '0.6.6', tables: v1 }, structuredClone(v1))).toMatchObject({
      status: 'unchanged',
      comparedTo: '0.6.6',
    });
  });

  it('names added and removed tables, and added, removed and changed columns and links', () => {
    const v2 = [
      table('rigs', [
        col('id', 'TEXT', { pk: 1 }),
        col('name', 'TEXT', { notNull: true }),
        col('owner'),
      ]), // name now NOT NULL, owner added
      table('nodes', [col('id')]), // rig_id dropped, so is its link
      table('profiles', [col('id')]), // new
    ];
    const d = diffSchemas({ version: '0.6.6', tables: v1 }, v2);

    expect(d.status).toBe('changed');
    expect(d.addedTables).toEqual(['profiles']);
    expect(d.removedTables).toEqual([]);
    expect(d.changedTables).toEqual([
      {
        name: 'rigs',
        addedColumns: ['owner'],
        removedColumns: [],
        changedColumns: [{ name: 'name', from: 'TEXT NULL', to: 'TEXT NOT NULL' }],
        addedForeignKeys: [],
        removedForeignKeys: [],
      },
      {
        name: 'nodes',
        addedColumns: [],
        removedColumns: ['rig_id'],
        changedColumns: [],
        addedForeignKeys: [],
        removedForeignKeys: ['rig_id → rigs.id'],
      },
    ]);
    expect(diffSchemas({ version: '0.7.0', tables: v2 }, v1).removedTables).toEqual(['profiles']);
  });

  it('a type change and a primary-key change are changes', () => {
    const d = diffSchemas(
      { version: 'a', tables: [table('t', [col('n', 'INTEGER'), col('id', 'TEXT')])] },
      [table('t', [col('n', 'TEXT'), col('id', 'TEXT', { pk: 1 })])]
    );

    expect(d.changedTables[0]!.changedColumns.map((c) => c.name)).toEqual(['n', 'id']);
  });
});
