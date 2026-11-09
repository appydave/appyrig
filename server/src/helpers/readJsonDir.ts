import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';

/** What to say when a file is bad: `label` completes "<file> is not <label>; skipped". */
export interface JsonDirTell {
  label: string;
  onDiskError: (message: string, err: Error) => void;
}

/** The `*.json` names in `dir`. A missing folder is silent (nothing stored yet); any other failure is told. */
async function jsonNames(dir: string, tell: JsonDirTell): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((n) => n.endsWith('.json'));
  } catch (err) {
    const missing = err instanceof Error && 'code' in err && err.code === 'ENOENT';

    if (!missing) {
      tell.onDiskError(`cannot read ${dir}`, err instanceof Error ? err : new Error(String(err)));
    }

    return [];
  }
}

/** One file: its parsed value, or undefined after telling `onDiskError` why it was skipped. */
async function loadOne<T>(file: string, schema: z.ZodType<T>, tell: JsonDirTell) {
  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(file, 'utf8')));

    if (!parsed.success) {
      tell.onDiskError(`${file} is not ${tell.label}; skipped`, parsed.error);
    }

    return parsed.success ? { value: parsed.data } : undefined;
  } catch (err) {
    tell.onDiskError(
      `cannot load ${file}; skipped`,
      err instanceof Error ? err : new Error(String(err))
    );

    return undefined;
  }
}

/**
 * Every `*.json` file in `dir` that parses and matches `schema`, in directory order. The hub keeps
 * serving past a bad folder: anything that cannot be read, parsed or matched is told to
 * `onDiskError` and skipped.
 */
export async function readJsonDir<T>(
  dir: string,
  schema: z.ZodType<T>,
  tell: JsonDirTell
): Promise<T[]> {
  const found: T[] = [];

  for (const name of await jsonNames(dir, tell)) {
    const one = await loadOne(join(dir, name), schema, tell);

    if (one) {
      found.push(one.value);
    }
  }

  return found;
}
