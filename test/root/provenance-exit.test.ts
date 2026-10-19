import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The provenance check's exit contract: 0 = clean, 1 = drift ONLY, 2 = the check could not run.
 * An error the script did not expect must never read as drift (exit 1), and a report it cannot
 * write (a read-only tree) must not turn a clean run into a failure.
 */

const ROOT = new URL('../..', import.meta.url).pathname;
const TSX = join(ROOT, 'node_modules/.bin/tsx');
const CHECK = join(ROOT, 'scripts/provenance/main.ts');
const pin = JSON.parse(readFileSync(join(ROOT, 'shared/src/openrig/PROVENANCE.json'), 'utf8')) as {
  source: { repo: string };
  cli: { path: string };
};
/** A full run needs the pinned OpenRig clone and the installed CLI on this machine. */
const canRunFull = existsSync(pin.source.repo) && existsSync(pin.cli.path);

const scratch = mkdtempSync(join(tmpdir(), 'prov-exit-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(TSX, [CHECK, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 60_000,
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

describe('provenance exit codes', () => {
  it('an unexpected error exits 2 with "cannot run", never 1', () => {
    // --source over a tree holding a dangling symlink: walking it throws an error the script did not
    // anticipate (ENOENT from stat), which used to escape as Node's own exit code 1.
    const src = join(scratch, 'broken-tree');
    mkdirSync(src, { recursive: true });
    symlinkSync(join(scratch, 'nowhere'), join(src, 'dangling'));
    const r = run(['--source', src]);
    expect(r.status, r.out).toBe(2);
    expect(r.out).toContain('provenance: cannot run:');
  });

  it.skipIf(!canRunFull)(
    'a report that cannot be written goes to the temp folder and a clean run still exits 0',
    () => {
      // A FILE where scripts/provenance/out should be: mkdir and the writes under it fail, as on a
      // read-only tree. The real folder is set aside and put back whatever happens.
      const out = join(ROOT, 'scripts/provenance/out');
      const aside = join(scratch, 'out-aside');
      const had = existsSync(out);
      if (had) renameSync(out, aside);
      try {
        writeFileSync(out, 'not a folder');
        const r = run([]);
        expect(r.out).toContain('# OpenRig provenance: clean');
        expect(r.status, r.out).toBe(0);
        expect(r.out).toMatch(/provenance: could not write .*; wrote the report to /);
      } finally {
        rmSync(out, { force: true });
        if (had) renameSync(aside, out);
      }
    }
  );
});
