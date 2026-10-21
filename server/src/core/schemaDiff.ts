import type { DbColumn, DbTable, SchemaChanges, TableChange } from '@appydave/shared';

/**
 * v1.4 · S7: what changed between two OpenRig database schemas. Pure. Tables are matched by name,
 * columns by name; a column "changed" when its declared type, nullability, primary-key position
 * or default differs. Foreign keys are compared as "from → table.to" strings.
 */

const describe = (c: DbColumn): string =>
  [
    c.type || '(no type)',
    c.notNull ? 'NOT NULL' : 'NULL',
    c.pk ? `PK${c.pk}` : '',
    c.default !== null ? `DEFAULT ${c.default}` : '',
  ]
    .filter(Boolean)
    .join(' ');

const fkString = (t: DbTable): string[] =>
  t.foreignKeys.map((k) => `${k.from} → ${k.table}${k.to ? `.${k.to}` : ''}`).sort();

function diffTable(before: DbTable, after: DbTable): TableChange | null {
  const b = new Map(before.columns.map((c) => [c.name, c]));
  const a = new Map(after.columns.map((c) => [c.name, c]));
  const addedColumns = [...a.keys()].filter((n) => !b.has(n));
  const removedColumns = [...b.keys()].filter((n) => !a.has(n));
  const changedColumns = [...a.entries()]
    .filter(([n, c]) => b.has(n) && describe(b.get(n)!) !== describe(c))
    .map(([n, c]) => ({ name: n, from: describe(b.get(n)!), to: describe(c) }));
  const fb = new Set(fkString(before));
  const fa = new Set(fkString(after));
  const addedForeignKeys = [...fa].filter((k) => !fb.has(k));
  const removedForeignKeys = [...fb].filter((k) => !fa.has(k));
  const none =
    !addedColumns.length &&
    !removedColumns.length &&
    !changedColumns.length &&
    !addedForeignKeys.length &&
    !removedForeignKeys.length;

  return none
    ? null
    : {
        name: after.name,
        addedColumns,
        removedColumns,
        changedColumns,
        addedForeignKeys,
        removedForeignKeys,
      };
}

/** `before` null = no earlier version: a baseline. */
export function diffSchemas(
  before: { version: string; tables: DbTable[] } | null,
  after: DbTable[]
): SchemaChanges {
  if (!before) {
    return {
      status: 'baseline',
      comparedTo: null,
      addedTables: [],
      removedTables: [],
      changedTables: [],
    };
  }

  const b = new Map(before.tables.map((t) => [t.name, t]));
  const a = new Map(after.map((t) => [t.name, t]));
  const addedTables = [...a.keys()].filter((n) => !b.has(n));
  const removedTables = [...b.keys()].filter((n) => !a.has(n));
  const changedTables = [...a.values()]
    .filter((t) => b.has(t.name))
    .map((t) => diffTable(b.get(t.name)!, t))
    .filter((c): c is TableChange => c !== null);
  const changed = addedTables.length > 0 || removedTables.length > 0 || changedTables.length > 0;

  return {
    status: changed ? 'changed' : 'unchanged',
    comparedTo: before.version,
    addedTables,
    removedTables,
    changedTables,
  };
}
