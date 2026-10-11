import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { RIG_SUMMARY_MAX } from '@appydave/shared';
import { redactString } from '../redact.js';

/**
 * Finds each rig's `rig.yaml` on this machine. OpenRig does not keep the spec path (its `rigs`
 * table has no spec column), so AppyRig looks in a configured list of folders and matches on the
 * file's `name:`. Read-only: files are read, never written. A rig with no match is reported as
 * not found by the caller, never guessed at.
 */

export interface SpecInfo {
  /** Absolute path of the rig.yaml. */
  path: string;
  /** The `summary:` text with whitespace folded; null when the file has none. */
  summary: string | null;
}

const MAX_DEPTH = 5;
const SKIP = new Set(['node_modules', '.git', 'dist', 'build']);

export function parseSpec(text: string): { name: string; summary: string | null } | null {
  let doc: unknown;
  try {
    doc = parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null) return null;
  const { name, summary } = doc as { name?: unknown; summary?: unknown };
  if (typeof name !== 'string' || !name.trim()) return null;
  const folded =
    typeof summary === 'string' ? redactString(summary.replace(/\s+/g, ' ').trim()) : '';
  return {
    name: name.trim(),
    summary: folded ? folded.slice(0, RIG_SUMMARY_MAX) : null,
  };
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // a configured folder that is missing on this machine is simply empty
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isFile() && e.name === 'rig.yaml') out.push(join(dir, e.name));
    else if (e.isDirectory() && depth < MAX_DEPTH && !SKIP.has(e.name))
      await walk(join(dir, e.name), depth + 1, out);
  }
}

/** rig name → spec. Folders are searched in order, so the first folder listed wins a name clash. */
export async function scanSpecs(folders: string[]): Promise<Map<string, SpecInfo>> {
  const found = new Map<string, SpecInfo>();
  for (const folder of folders) {
    const files: string[] = [];
    await walk(folder, 0, files);
    for (const path of files) {
      try {
        const spec = parseSpec(await readFile(path, 'utf8'));
        if (spec && !found.has(spec.name)) found.set(spec.name, { path, summary: spec.summary });
      } catch {
        // unreadable file: skip it
      }
    }
  }
  return found;
}

/** A scan reused for `ttlMs`, so a push every few seconds does not walk the disk each time. */
export function createSpecIndex(
  folders: string[],
  ttlMs = 60_000,
  now: () => number = Date.now
): () => Promise<Map<string, SpecInfo>> {
  let cache: { at: number; value: Map<string, SpecInfo> } | null = null;
  return async () => {
    if (cache && now() - cache.at < ttlMs) return cache.value;
    cache = { at: now(), value: await scanSpecs(folders) };
    return cache.value;
  };
}
