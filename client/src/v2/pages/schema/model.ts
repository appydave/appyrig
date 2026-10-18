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

/**
 * walk #5: one compact line per machine for the version-to-version state, so the table browser
 * comes first. "M2: baseline 0.6.6 (2620dea8), nothing to compare yet".
 */
export function versionLine(
  label: string,
  out: {
    status: string;
    reason: string | null;
    openrigVersion: string | null;
    changes: SchemaChanges | null;
  } | null,
  refused: string | null
): string {
  if (refused) return `${label}: could not read (${refused.replace(/\.+$/, '')})`;
  if (!out) return `${label}: asking…`;
  if (out.status !== 'ok') return `${label}: ${out.reason ?? out.status}`;
  const v = out.openrigVersion ?? 'version not reported';
  const c = out.changes;
  if (!c) return `${label}: ${v}, no comparison available`;
  if (c.status === 'baseline') return `${label}: baseline ${v}, nothing to compare yet`;
  if (c.status === 'unchanged')
    return `${label}: ${v}, same tables and columns as ${c.comparedTo ?? 'before'}`;
  const bits = [
    c.addedTables.length
      ? `${c.addedTables.length} table${c.addedTables.length === 1 ? '' : 's'} added`
      : '',
    c.removedTables.length ? `${c.removedTables.length} removed` : '',
    c.changedTables.length ? `${c.changedTables.length} changed` : '',
  ].filter(Boolean);
  return `${label}: ${v}, changed since ${c.comparedTo ?? 'the previous version'}: ${bits.join(', ')}`;
}
