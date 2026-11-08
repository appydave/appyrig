import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The real `npm run cohesion` entry, run as a child process on a scratch copy of lint/gates (the gate
 * takes its root from where the file sits). This is the only place the exit code of the CLI is pinned:
 * report() is tested elsewhere, but nothing there runs the block that calls process.exit.
 */

const REPO = join(import.meta.dirname, '..', '..', '..', '..');
const WORKSPACES = ['client', 'server', 'collector'];

/** Five exports that never use each other: a catch-all bucket. */
const MIXED = `
export const formatMoney = (n: number) => '$' + n.toFixed(2);
export const formatDate = (d: Date) => d.toISOString();
export const parseId = (s: string) => Number(s);
export const MAX_RETRIES = 3;
export const slug = (s: string) => s.toLowerCase();
`;

const made: string[] = [];

/** A scratch root holding a copy of the gate; `sources` are the workspaces whose src/ exists. */
function scratchRoot(sources: Record<string, string>): string {
  // realpath: the gate's entry guard compares argv[1] with its own resolved URL, and /tmp is a symlink.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cohesion-cli-')));

  made.push(root);
  mkdirSync(join(root, 'lint'));
  cpSync(join(REPO, 'lint', 'gates'), join(root, 'lint', 'gates'), { recursive: true });
  symlinkSync(join(REPO, 'node_modules'), join(root, 'node_modules'));

  for (const [workspace, text] of Object.entries(sources)) {
    mkdirSync(join(root, workspace, 'src'), { recursive: true });
    writeFileSync(join(root, workspace, 'src', 'mixed.ts'), text);
  }

  return root;
}

const runCli = (root: string) =>
  spawnSync(process.execPath, [join(root, 'lint', 'gates', 'cohesion.mjs')], { encoding: 'utf8' });

afterEach(() => {
  while (made.length) {
    rmSync(made.pop() as string, { recursive: true, force: true });
  }
});

describe('Feature: the cohesion CLI reports, and only fails when the scan did not look', () => {
  it('Scenario: given no workspace sources to scan, then it exits 2 and says nothing was checked', () => {
    const run = runCli(scratchRoot({}));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain('nothing was checked');
  });

  it('Scenario: given a catch-all file, then it prints the finding and still exits 0', () => {
    const run = runCli(scratchRoot(Object.fromEntries(WORKSPACES.map((w) => [w, MIXED]))));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('server/src/mixed.ts');
    expect(run.stdout).toContain('Informational');
  });
});

describe('Feature: the cohesion npm script runs the gate bare', () => {
  it('Scenario: given package.json, then scripts.cohesion is exactly the gate command, with no wrapper that swallows exit 2', () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../../package.json'), 'utf8')
    );

    expect(pkg.scripts.cohesion).toBe('node lint/gates/cohesion.mjs');
  });
});
