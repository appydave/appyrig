import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * AC 4: the collector never calls the transcript routes. That route can start a capture as a side
 * effect, so terminal text comes from the tmux adapter only. This scans collector/ and server/
 * source for the route string (built from parts so this file does not contain it).
 */
const ROOT = resolve(import.meta.dirname, '../..');
const NEEDLE = ['/api', 'transcripts'].join('/');

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|mjs|cjs|json|sh|plist)$/.test(name)) yield p;
  }
}

describe('collector never calls the transcript route (AC 4)', () => {
  it.each(['collector', 'server'])('%s has no reference to the route', (dir) => {
    const files = [...walk(join(ROOT, dir))];
    expect(files.length).toBeGreaterThan(0);
    const hits = files
      .filter((f) => readFileSync(f, 'utf8').includes(NEEDLE))
      .map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });

  it('the scan can see a violation (positive control)', () => {
    expect(['x', `GET ${NEEDLE}/a/tail`].some((s) => s.includes(NEEDLE))).toBe(true);
  });
});
