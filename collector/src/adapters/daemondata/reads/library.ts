/**
 * The library read: three lists (specs, skills, context packs) read independently, plus the daemon's
 * version from /healthz. A list that cannot be read is null (kept apart from an empty one) and logged
 * once; the read as a whole is `unsupported` when all three lists are 404s and fails when all three
 * fail. /healthz never decides either: it only labels the version.
 */
import { TEXT_SHORT_MAX, type LibraryData } from '@appydave/shared';
import { isRec, txt } from '@collector/adapters/daemondata/parse/lenient.js';
import {
  parseLibraryPacks,
  parseLibrarySkills,
  parseLibrarySpecs,
} from '@collector/adapters/daemondata/parse/library.js';
import {
  allFailed,
  settle,
  valueOf,
  type DaemonGet,
  type Settled,
} from '@collector/adapters/daemondata/reads/get.js';
import {
  okOutcome,
  readPart,
  unsupportedOutcome,
  type FailureLog,
  type Outcome,
} from '@collector/adapters/daemondata/reads/outcome.js';

/** The OpenRig version /healthz reports, or null. */
const semverOf = (health: Settled): string | null =>
  health.ok && isRec(health.value) ? txt(health.value.semver, TEXT_SHORT_MAX) : null;

export async function readLibrary(ctx: {
  get: DaemonGet;
  failures: FailureLog;
}): Promise<Outcome[]> {
  const [specs, skills, packs, health] = await Promise.all([
    settle(ctx.get, '/api/specs/library'),
    settle(ctx.get, '/api/skills/library'),
    settle(ctx.get, '/api/context-packs/library'),
    settle(ctx.get, '/healthz'),
  ]);

  if (allFailed([specs, skills, packs]) === 'unsupported') {
    return [unsupportedOutcome('this OpenRig has no library routes')];
  }

  const list = (name: string, r: Settled, parse: (raw: unknown) => LibraryData['specs']) =>
    readPart(ctx.failures, {
      key: `library:${name}`,
      label: `library ${name}`,
      read: () => parse(valueOf(r)),
    });
  const data: LibraryData = {
    openrigVersion: semverOf(health),
    specs: list('specs', specs, parseLibrarySpecs),
    skills: list('skills', skills, parseLibrarySkills),
    contextPacks: list('context packs', packs, parseLibraryPacks),
  };

  return [okOutcome(data)];
}
