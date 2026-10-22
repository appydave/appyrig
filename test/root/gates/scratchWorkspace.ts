import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const made: string[] = [];

/** The `src/` of a scratch workspace holding `files` (name -> text), for a gate to scan like a real one. */
export function scratchSource(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'gate-probe-'));

  made.push(root);

  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, 'src', name)), { recursive: true });
    writeFileSync(join(root, 'src', name), text);
  }

  return join(root, 'src');
}

/** Deletes every scratch workspace made since the last call: run it in `afterEach`. */
export function removeScratch(): void {
  while (made.length) {
    rmSync(made.pop() as string, { recursive: true, force: true });
  }
}

/** What a gate's `scanDirectory` takes: a source folder and the names its findings are reported under. */
type DirectoryScan<T> = (options: { sourceDir: string; workspace: string; prefix: string }) => T;

/** Scans a scratch workspace holding `files` the way the gate scans a real one. */
export function scanProbe<T>(scanDirectory: DirectoryScan<T>, files: Record<string, string>): T {
  return scanDirectory({
    sourceDir: scratchSource(files),
    workspace: 'probe',
    prefix: 'probe/src',
  });
}
