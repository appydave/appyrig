/**
 * Vitest globalSetup, shared by every vitest config (server, client, collector, test/root).
 * Every workspace reads @appydave/shared from the gitignored shared/dist, so a stale dist can make a
 * test pass against code that no longer exists. This rebuilds shared once per vitest run, always
 * (no "is it fresh" check, which would be the same staleness risk), and throws if the build fails,
 * which fails the run. Workspaces run one after another, so builds never overlap.
 * Watch mode runs it once at start-up; edits to shared/src while watching still need a rebuild.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** @public vitest calls this (globalSetup) */
export default function setup() {
  const build = spawnSync('npm', ['run', 'build', '-w', 'shared'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (build.status !== 0) {
    throw new Error(
      `shared build failed (exit ${build.status}); tests would read a stale shared/dist.\n${build.stdout}${build.stderr}`
    );
  }
}
