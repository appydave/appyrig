/**
 * The library: three daemon lists turned into LibraryRow[] for the Library page. Specs (agent, rig
 * and workflow specs), skills (file names and sizes only, never file text) and context packs. A row
 * needs an id and a name; any other odd field drops only that field.
 */
import {
  LIBRARY_FILES_MAX,
  LIBRARY_ROWS_MAX,
  TEXT_XLONG_MAX,
  TEXT_PATH_MAX,
  TEXT_XXLONG_MAX,
  TEXT_XXXLONG_MAX,
  TEXT_SHORT_MAX,
  type LibraryRow,
} from '@appydave/shared';
import {
  countOrNull,
  isRec,
  kept,
  list,
  num,
  rowsOf,
  txt,
} from '@collector/adapters/daemondata/parse/lenient.js';

const FACT_TEXT_MAX = 200;

/** Primitive facts picked from a record; anything else is skipped, never guessed. */
function pickFacts(r: Record<string, unknown>, keys: string[]): LibraryRow['facts'] {
  const out: LibraryRow['facts'] = {};

  for (const k of keys) {
    const v = r[k];

    if (typeof v === 'string') {
      out[k] = v.slice(0, FACT_TEXT_MAX);
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
    } else if (typeof v === 'boolean') {
      out[k] = v;
    }
  }

  return out;
}

/** A library row's record with its required id and name; null (skip the row) when either is missing. */
function namedRow(raw: unknown) {
  if (!isRec(raw)) {
    return null;
  }

  const id = txt(raw.id, TEXT_XXLONG_MAX);
  const name = txt(raw.name, TEXT_XLONG_MAX);

  return id && name ? { r: raw, id, name } : null;
}

type NamedRow = NonNullable<ReturnType<typeof namedRow>>;

/** One spec row of GET /api/specs/library. */
function specRowOf(raw: unknown): LibraryRow | null {
  const row = namedRow(raw);

  if (!row) {
    return null;
  }

  const { r, id, name } = row;

  return {
    id,
    kind: txt(r.kind, TEXT_SHORT_MAX),
    name,
    version: txt(r.version, TEXT_SHORT_MAX),
    sourceType: txt(r.sourceType, TEXT_SHORT_MAX),
    summary: txt(r.summary, TEXT_XXXLONG_MAX, true),
    path: txt(r.sourcePath, TEXT_PATH_MAX),
    updatedAt: txt(r.updatedAt, TEXT_SHORT_MAX),
    facts: pickFacts(r, [
      'rolesCount',
      'stepsCount',
      'terminalTurnRule',
      'targetRig',
      'isBuiltIn',
      'status',
    ]),
    files: [],
  };
}

/** GET /api/specs/library: agent, rig and workflow specs. Rows without an id or a name are skipped. */
export function parseLibrarySpecs(raw: unknown): LibraryRow[] {
  return kept(rowsOf(raw, 'specs'), specRowOf).slice(0, LIBRARY_ROWS_MAX);
}

/** A skill's files: a name each (a file with none is skipped) and a size in bytes when one is given. */
function skillFilesOf(v: unknown) {
  return list(v).flatMap((f) => {
    const name = isRec(f) ? txt(f.name, TEXT_XLONG_MAX) : null;

    return isRec(f) && name ? [{ name, size: countOrNull(f.size) }] : [];
  });
}

/** One skill row of GET /api/skills/library: file counts and sizes are facts, file text is never read. */
function skillRowOf(raw: unknown): LibraryRow | null {
  const row = namedRow(raw);

  if (!row) {
    return null;
  }

  const files = skillFilesOf(row.r.files);

  return {
    id: row.id,
    kind: 'skill',
    name: row.name,
    version: null,
    sourceType: txt(row.r.source, TEXT_SHORT_MAX),
    summary: null,
    path: txt(row.r.absolutePath, TEXT_PATH_MAX),
    updatedAt: null,
    facts: {
      fileCount: files.length,
      totalBytes: files.reduce((n, f) => n + (f.size ?? 0), 0),
    },
    files: files.slice(0, LIBRARY_FILES_MAX),
  };
}

/** GET /api/skills/library. File text is NOT read: names and sizes only. */
export function parseLibrarySkills(raw: unknown): LibraryRow[] {
  return kept(rowsOf(raw, 'skills'), skillRowOf).slice(0, LIBRARY_ROWS_MAX);
}

/** A context pack's facts: its taxonomy, and its token estimate (the manifest's, else the derived one). */
function packFactsOf({ r }: NamedRow): LibraryRow['facts'] {
  const tokens = num(r.manifestEstimatedTokens) ?? num(r.derivedEstimatedTokens);

  return { ...pickFacts(r, ['taxonomy']), ...(tokens !== null ? { tokens } : {}) };
}

/** One row of GET /api/context-packs/library. */
function packRowOf(raw: unknown): LibraryRow | null {
  const row = namedRow(raw);

  if (!row) {
    return null;
  }

  const { r, id, name } = row;

  return {
    id,
    kind: txt(r.kind, TEXT_SHORT_MAX) ?? 'context-pack',
    name,
    version: txt(r.version, TEXT_SHORT_MAX),
    sourceType: txt(r.sourceType, TEXT_SHORT_MAX),
    summary: txt(r.purpose, TEXT_XXXLONG_MAX, true),
    path: txt(r.sourcePath, TEXT_PATH_MAX),
    updatedAt: null,
    facts: packFactsOf(row),
    files: [],
  };
}

/** GET /api/context-packs/library. */
export function parseLibraryPacks(raw: unknown): LibraryRow[] {
  return kept(rowsOf(raw, 'contextPacks'), packRowOf).slice(0, LIBRARY_ROWS_MAX);
}
