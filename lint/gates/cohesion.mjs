#!/usr/bin/env node
/**
 * G13: module cohesion. A file's exports should belong together. Runs archlint's `module_cohesion`
 * over the production code of client, server and collector and compares the findings with
 * cohesion-baseline.json, so only NEW findings fail while today's are recorded.
 *
 *   npm run cohesion           fail on a file above its baseline (or not in it), or below it
 *   npm run cohesion:baseline  rewrite the baseline; refuses if anything would grow
 *
 * Exit: 0 clean, 1 findings above the baseline (or a baseline that can shrink), 2 the run itself
 * failed: a run that did not look is never reported as a clean one.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHLINT_EXCLUDES, ROOT, WORKSPACES, archlintSmells, metric } from './archlint-scan.mjs';
import { runRatchetGate } from './ratchet-gate.mjs';

const BASELINE_FILE = 'cohesion-baseline.json';

/**
 * `shared/` is not scanned for cohesion: it is the wire contract (zod schemas with their inferred
 * types, their limits and enum lists, event tables, plain types and a dozen helper functions). archlint
 * counts each schema/type pair as an unconnected group, so scanning it would turn every new schema into
 * a red build. Seven files there carry functions (daemondata, loadout, openrig/chainFiles,
 * openrig/rigSpec, rigspecs, snapshot, health); they are on the cleanup list so shared/ holds only
 * declarations (rigSpec.ts and snapshot.ts first):
 * /Users/davidcruwys/dev/appyrigs/runs/spaghetti/appyrig/burn-down-backlog.md
 */

/** The calibrated policy: a file with at least MIN_EXPORTS exports may fall into at most MAX_COMPONENTS groups. */
const MIN_EXPORTS = 5;
const MAX_COMPONENTS = 2;

/** Components per file for one source directory: { 'server/src/x.ts': 3 }. Throws when the run did not look. */
export function scanDirectory({ sourceDir, workspace, prefix }) {
  const rules = {
    module_cohesion: {
      severity: 'high',
      min_exports: MIN_EXPORTS,
      max_components: MAX_COMPONENTS,
      exclude: ARCHLINT_EXCLUDES,
    },
  };
  const smells = archlintSmells({ sourceDir, workspace, prefix, rules });

  return Object.fromEntries(smells.map((smell) => [smell.files[0], metric(smell, 'components')]));
}

/** Findings for the whole application. */
function scanApplication() {
  const counts = {};

  for (const workspace of WORKSPACES) {
    Object.assign(
      counts,
      scanDirectory({
        sourceDir: join(ROOT, workspace, 'src'),
        workspace,
        prefix: `${workspace}/src`,
      })
    );
  }

  return counts;
}

/** What to do about a file that is over the limit, written for the agent that reads it as its prompt. */
export function messageFor({ file, now, was }) {
  const status = was ? `was ${was} groups in the baseline` : 'not in the baseline';

  return `${file}: its exports fall into ${now} unconnected groups (${status}; limit ${MAX_COMPONENTS} once a file has ${MIN_EXPORTS} exports). Split it by responsibility: move each group of exports that do not use each other into its own file, named for what it does.`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRatchetGate({
    gate: 'cohesion',
    baselineFile: BASELINE_FILE,
    command: 'cohesion:baseline',
    about:
      'Files whose exports fall into more groups than G13 allows, with the group count when it was recorded. It may shrink, never grow. Rewrite with npm run cohesion:baseline.',
    scan: () => ({ findings: scanApplication() }),
    sections: { findings: messageFor },
  });
}
