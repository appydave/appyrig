#!/usr/bin/env node
/**
 * G13: module cohesion, a PRINTED REPORT (List 7b), not a gate. A file's exports should belong together.
 * Runs archlint's `module_cohesion` over the production code of client, server and collector and prints
 * today's findings. It has no baseline and never fails the build over a finding (David's ruling: rule 2,
 * "no warning-only gates", is set aside for this one).
 *
 *   npm run cohesion           print the findings; exit 0
 *
 * Exit: 0 the scan looked (with or without findings), 2 the run itself failed: a scan that did not
 * look must never read as a report with nothing in it.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARCHLINT_EXCLUDES, ROOT, WORKSPACES, archlintSmells, metric } from './archlint-scan.mjs';

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

/** One finding, written for the agent that reads it as its prompt. */
export function messageFor({ file, now }) {
  return `${file}: its exports fall into ${now} unconnected groups (limit ${MAX_COMPONENTS} once a file has ${MIN_EXPORTS} exports). Informational. If you are changing this file anyway, split it by responsibility: move each group of exports that do not use each other into its own file, named for what it does.`;
}

/** The report for one scan: the exit code and the text. A scan that throws is code 2, never an empty report. */
export function report(scan) {
  let found;

  try {
    found = scan();
  } catch (error) {
    return { code: 2, text: `cohesion: the run failed, so nothing was checked.\n${error.message}` };
  }

  const files = Object.keys(found).sort();
  const head = `cohesion (a report, not a gate; nothing fails over it): ${files.length} file(s) have exports in more than ${MAX_COMPONENTS} unconnected groups.`;

  return {
    code: 0,
    text: [head, ...files.map((file) => messageFor({ file, now: found[file] }))].join('\n'),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, text } = report(scanApplication);

  (code === 0 ? console.log : console.error)(text);
  process.exit(code);
}
