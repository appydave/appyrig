#!/usr/bin/env node
/**
 * G14: coupling and hubs. A file should not depend on too many others, and a pass-through file should
 * not sit between a crowd of importers and a crowd of imports. Runs archlint's `high_coupling` (CBO:
 * the files a file imports plus the files that import it) and `hub_module` over the production code of
 * client, server, collector and shared, and compares the findings with coupling-baseline.json, so only
 * NEW findings fail while today's are recorded.
 *
 *   npm run coupling           fail on a file above its baseline (or not in it), or below it
 *   npm run coupling:baseline  rewrite the baseline; refuses if anything would grow
 *
 * Exit codes are the ratchet's (ratchet-gate.mjs).
 */
import { fileURLToPath } from 'node:url';
import {
  ARCHLINT_EXCLUDES,
  WORKSPACES,
  archlintSmellsOf,
  archlintSmells,
  metric,
} from './archlint-scan.mjs';
import { runRatchetGate } from './ratchet-gate.mjs';

const BASELINE_FILE = 'coupling-baseline.json';

/** The calibrated policy: a file may touch at most MAX_CBO others. */
const MAX_CBO = 20;
/** A hub: imported by at least HUB_FAN_IN files, importing at least HUB_FAN_OUT, with little logic of its own. */
const HUB_FAN_IN = 8;
const HUB_FAN_OUT = 8;
const HUB_MAX_COMPLEXITY = 5;

/** `shared/` is the wire contract that everything imports: scanned, and measured at zero on both rules. */
const SCANNED = [...WORKSPACES, 'shared'];

const RULES = {
  high_coupling: { severity: 'high', max_cbo: MAX_CBO, exclude: ARCHLINT_EXCLUDES },
  hub_module: {
    severity: 'high',
    min_fan_in: HUB_FAN_IN,
    min_fan_out: HUB_FAN_OUT,
    max_complexity: HUB_MAX_COMPLEXITY,
    exclude: ARCHLINT_EXCLUDES,
  },
};

/** archlint's findings as { coupling: { file: cbo }, hubs: { file: fanIn + fanOut } }. */
function sectionsOf(smells) {
  const coupling = {};
  const hubs = {};

  for (const smell of smells) {
    if (smell.type.startsWith('HighCoupling')) {
      coupling[smell.files[0]] = metric(smell, 'cbo');
    } else if (smell.type.startsWith('HubModule')) {
      hubs[smell.files[0]] = metric(smell, 'fanIn') + metric(smell, 'fanOut');
    }
  }

  return { coupling, hubs };
}

/** Findings for one source directory. Throws when the run did not look. */
export function scanDirectory({ sourceDir, workspace, prefix }) {
  return sectionsOf(archlintSmells({ sourceDir, workspace, prefix, rules: RULES }));
}

const scanApplication = () => sectionsOf(archlintSmellsOf({ workspaces: SCANNED, rules: RULES }));

/** What to do about a file that is over the limit, written for the agent that reads it as its prompt. */
export function couplingMessage({ file, now, was }) {
  const status = was ? `was ${was} in the baseline` : 'not in the baseline';

  return `${file}: it touches ${now} other files (${status}; limit ${MAX_CBO}). Find the groups of files it uses together and move that work into a module of their own, so this file depends on one thing instead of many.`;
}

/** What to do about a hub, written for the agent that reads it as its prompt. */
export function hubMessage({ file, now, was }) {
  const status = was ? `was ${was} in the baseline` : 'not in the baseline';

  return `${file}: ${now} files import or are imported by this hub (${status}; a hub has ${HUB_FAN_IN}+ in and ${HUB_FAN_OUT}+ out and almost no logic). Let the importers import what they use directly, or give the hub a job of its own.`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRatchetGate({
    gate: 'coupling',
    baselineFile: BASELINE_FILE,
    command: 'coupling:baseline',
    about:
      'G14 findings recorded when the gate was added. coupling: files touching more than the limit, with how many. hubs: files that are hubs, with fan-in plus fan-out. It may shrink, never grow. Rewrite with npm run coupling:baseline.',
    scan: scanApplication,
    sections: { coupling: couplingMessage, hubs: hubMessage },
  });
}
