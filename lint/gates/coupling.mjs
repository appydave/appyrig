#!/usr/bin/env node
/**
 * G14 + G15: coupling, hubs and stability. A file should not depend on too many others, a pass-through
 * file should not sit between a crowd of importers and a crowd of imports, and a file should not
 * depend on one that changes more often than it does. Runs archlint's `high_coupling` (CBO: the files a
 * file imports plus the files that import it), `hub_module` and `sdp_violation` (the Stable
 * Dependencies Principle: instability = imports / (imports + importers)) over the production code of
 * client, server, collector and shared, and compares the findings with coupling-baseline.json, so only
 * NEW findings fail while today's are recorded.
 *
 *   npm run coupling           fail on a file above its baseline (or not in it), or below it
 *   npm run coupling:baseline  rewrite the baseline; refuses if anything would grow
 *
 * Exit codes are the ratchet's (ratchet-gate.mjs).
 *
 * Two things the numbers do not see:
 *  - archlint follows `./x.js` to `x.ts` but not to `x.tsx`; the scan strips `.js` from its disposable
 *    copy (archlint-scan.mjs) so edges into React files are counted.
 *  - A hub written as a re-export barrel is invisible to both rules: archlint scores a file's own
 *    symbols and a barrel has none (client/src/kit/index.ts and collector/src/adapters/index.ts are
 *    real ones). Coupling that hides behind a barrel shows up on the files that import it.
 */
import { fileURLToPath } from 'node:url';
import {
  ARCHLINT_EXCLUDES,
  ERROR_TAIL,
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
/**
 * Stability: a file with at least SDP_MIN_FAN_TOTAL imports plus importers must not import a file that is
 * SDP_MIN_INSTABILITY_GAP more unstable (instability 0 = everything depends on it, 1 = it depends on
 * everything). Omer's 5 / 0.3 finds nothing here; this is the strictest setting whose findings are
 * worth fixing (the next step down only adds page-to-kit pairs 0.05-0.09 apart, which is noise).
 */
const SDP_MIN_FAN_TOTAL = 2;
const SDP_MIN_INSTABILITY_GAP = 0.1;

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
  sdp_violation: {
    severity: 'high',
    min_fan_total: SDP_MIN_FAN_TOTAL,
    instability_diff: SDP_MIN_INSTABILITY_GAP,
    exclude: ARCHLINT_EXCLUDES,
  },
};

/** The file a stability finding says the finding's file depends on: "... from <path>". */
const DEPENDS_ON = / from (\S+)$/;

/** `<file> -> <the less stable file it imports>`: the finding's identity, so a second bad import in one file is its own entry. */
function stabilityPair(smell) {
  const target = DEPENDS_ON.exec(smell.locations?.[0]?.description ?? '')?.[1];

  if (!target) {
    throw new Error(`unreadable stability finding: ${JSON.stringify(smell).slice(0, ERROR_TAIL)}`);
  }

  return `${smell.files[0]} -> ${target}`;
}

/** archlint's findings as { coupling: { file: cbo }, hubs: { file: fanIn + fanOut }, stability: { 'a -> b': 1 } }. */
function sectionsOf(smells) {
  const coupling = {};
  const hubs = {};
  const stability = {};

  for (const smell of smells) {
    if (smell.type.startsWith('HighCoupling')) {
      coupling[smell.files[0]] = metric(smell, 'cbo');
    } else if (smell.type.startsWith('HubModule')) {
      hubs[smell.files[0]] = metric(smell, 'fanIn') + metric(smell, 'fanOut');
    } else if (smell.type.startsWith('sdp_violation')) {
      stability[stabilityPair(smell)] = 1;
    }
  }

  return { coupling, hubs, stability };
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

/** What to do about a file that imports something less stable than itself, written for the agent that reads it as its prompt. */
export function stabilityMessage({ file: pair }) {
  const [file, dependency] = pair.split(' -> ');

  return `${file} depends on ${dependency}, which changes more often than it does (limit: a gap of ${SDP_MIN_INSTABILITY_GAP} in instability once a file has ${SDP_MIN_FAN_TOTAL} imports plus importers). Move what ${file} uses out of ${dependency} into a module both import, or pass it in, so the stable file never depends on the volatile one.`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRatchetGate({
    gate: 'coupling',
    baselineFile: BASELINE_FILE,
    command: 'coupling:baseline',
    about:
      'G14 and G15 findings recorded when the gates were added. coupling: files touching more than the limit, with how many. hubs: files that are hubs, with fan-in plus fan-out. stability: a file and the less stable file it imports. It may shrink, never grow. Rewrite with npm run coupling:baseline.',
    scan: scanApplication,
    sections: { coupling: couplingMessage, hubs: hubMessage, stability: stabilityMessage },
  });
}
