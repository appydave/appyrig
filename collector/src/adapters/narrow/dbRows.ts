import type { SQLOutputValue } from 'node:sqlite';
import { z } from 'zod';

/**
 * The SQLite rows the OpenRig database reads already depend on (sqlite_master and the table-valued
 * pragma functions), parsed where they come out of the database. A row of any other shape is refused
 * with a plain message saying what was seen, instead of being coerced with String() / Number().
 */

const SqlValue = z.union([z.null(), z.number(), z.bigint(), z.string(), z.instanceof(Uint8Array)]);

/** `SELECT name, type FROM sqlite_master`: one table or view. */
export const ObjectRow = z.object({ name: z.string(), type: z.enum(['table', 'view']) });

/** `SELECT name FROM sqlite_master` or `... FROM pragma_table_info(?)`: just a name. */
export const NameRow = z.object({ name: z.string() });

/** `pragma_table_info(?)`, with `notnull` read as `nn`. */
export const ColumnRow = z.object({
  name: z.string(),
  type: z.string().nullable(),
  nn: z.number(),
  dflt_value: SqlValue,
  pk: z.number(),
});

/** `pragma_foreign_key_list(?)`, with `from`, `table`, `to` read as `f`, `t`, `o`. */
export const ForeignKeyRow = z.object({ f: z.string(), t: z.string(), o: z.string().nullable() });

/** `SELECT COUNT(*) AS n`. */
export const CountRow = z.object({ n: z.number() });

const SEEN_MAX = 120;

const seen = (row: Record<string, SQLOutputValue>): string =>
  Object.entries(row)
    .map(
      ([k, v]) =>
        `${k}=${v instanceof Uint8Array ? `(blob ${v.byteLength} bytes)` : JSON.stringify(typeof v === 'bigint' ? String(v) : v)}`
    )
    .join(', ')
    .slice(0, SEEN_MAX);

export function parseRows<S extends z.ZodType>(
  schema: S,
  rows: Record<string, SQLOutputValue>[],
  what: string
): z.output<S>[] {
  return rows.map((row) => {
    const parsed = schema.safeParse(row);

    if (!parsed.success) {
      throw new Error(`unexpected ${what} row from the OpenRig database: ${seen(row)}`);
    }

    return parsed.data;
  });
}

export function parseRow<S extends z.ZodType>(
  schema: S,
  row: Record<string, SQLOutputValue> | undefined,
  what: string
): z.output<S> {
  const [parsed] = parseRows(schema, row ? [row] : [], what);

  if (parsed === undefined) {
    throw new Error(`the OpenRig database returned no ${what} row`);
  }

  return parsed;
}
