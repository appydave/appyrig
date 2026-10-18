import type { SchemaChanges } from '@appydave/shared';

/** A believable "changed" result built from real table names, for when no machine has one yet. */
export function sampleChanges(tables: string[], from: string): SchemaChanges {
  // Prefer tables a reader knows (seats live in nodes, handoffs in queue_items), else the first two.
  const pick = (want: string[], i: number) =>
    want.find((w) => tables.includes(w)) ?? tables[i] ?? want[0]!;
  const a = pick(['nodes', 'rigs', 'edges'], 0);
  const b = pick(['queue_items', 'events', 'checkpoints'], 1);
  return {
    status: 'changed',
    comparedTo: from,
    addedTables: [`${b}_history`],
    removedTables: [],
    changedTables: [
      {
        name: a,
        addedColumns: ['context_tokens'],
        removedColumns: [],
        changedColumns: [{ name: 'status', from: 'TEXT', to: 'TEXT NOT NULL' }],
        addedForeignKeys: [],
        removedForeignKeys: [],
      },
    ],
  };
}
