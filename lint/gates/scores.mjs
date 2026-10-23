#!/usr/bin/env node
/**
 * G04 + G06 scores: a frozen finding may not get worse. The size and complexity rules are frozen in
 * eslint-suppressions.json as a COUNT per file, so a baselined function could grow (cognitive 51 -> 52)
 * and every gate stayed green. This records each frozen finding's SCORE (its line count, parameter count,
 * cognitive / cyclomatic complexity, operator count) in scores-baseline.json and fails when a score rises,
 * when a finding appears that the baseline does not have, and when a score falls without being recorded.
 *
 *   npm run scores           fail on a score above its baseline, a new finding, or a baseline that can shrink
 *   npm run scores:baseline  rewrite the baseline; refuses if anything would grow
 *
 * `max-lines` (a file's length) is not frozen here: it grows by design while code is fixed in place, so it
 * stays on the count ratchet in eslint-suppressions.json. Exit codes are the ratchet's (ratchet-gate.mjs):
 * 2 when the run did not look (ESLint failed, a message had no score, the frozen findings do not match
 * eslint-suppressions.json, or none of the rules reported anything).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './archlint-scan.mjs';
import { runRatchetGate } from './ratchet-gate.mjs';
import { keysFor } from './scores-keys.mjs';

const BASELINE_FILE = 'scores-baseline.json';
const SUPPRESSIONS_FILE = 'eslint-suppressions.json';
const KIB = 1024;
const BUFFER_MIB = 64;
const MAX_BUFFER = BUFFER_MIB * KIB * KIB;
const ERROR_TAIL = 400;
const ESLINT_FAILED = 2;
const ESLINT_BIN = join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');

/** The rules whose findings carry a score: how to read it from the message, and what to do instead. */
const RULES = {
  'max-lines-per-function': {
    score: /too many lines \((\d+)\)/,
    advice: 'Split the function into named steps until it is within the limit.',
  },
  'max-params': {
    score: /too many parameters \((\d+)\)/,
    advice: 'Pass one named options object instead of more positional parameters.',
  },
  'sonarjs/cognitive-complexity': {
    score: /Cognitive Complexity from (\d+) to/,
    advice: 'Flatten the branching: move each branch into a named function.',
  },
  'sonarjs/cyclomatic-complexity': {
    score: /complexity of (\d+) which/,
    advice: 'Move branches into named functions, or replace them with a lookup table.',
  },
  'sonarjs/expression-complexity': {
    score: /operators \((\d+)\)/,
    advice: 'Name the sub-conditions as booleans.',
  },
};

const ruleNames = Object.keys(RULES);

/** The score in an ESLint message. Throws when the wording changed: a score we cannot read must not read as zero. */
export function scoreOf(ruleId, message) {
  const found = RULES[ruleId].score.exec(message);

  if (!found) {
    throw new Error(
      `${ruleId}: no score in "${message}". The rule's wording changed; update RULES.`
    );
  }

  return Number(found[1]);
}

const emptySections = () => Object.fromEntries(ruleNames.map((rule) => [rule, {}]));

/** Every message of the scored rules in one file result, suppressed or not. */
const scored = (result) =>
  [...result.messages, ...(result.suppressedMessages ?? [])].filter((m) => m.ruleId in RULES);

/** `{ rule: { 'file::function': score } }` for ESLint's JSON results. `readText` is injectable for tests. */
export function collectScores(results, readText = (file) => readFileSync(file, 'utf8')) {
  const sections = emptySections();

  for (const result of results) {
    const found = scored(result);
    const file = relative(ROOT, result.filePath);
    const keys = found.length
      ? keysFor({ file, text: readText(result.filePath), findings: found })
      : [];

    found.forEach((message, index) => {
      sections[message.ruleId][`${file}::${keys[index]}`] = scoreOf(
        message.ruleId,
        message.message
      );
    });
  }

  return sections;
}

const relPath = (path) => (isAbsolute(path) ? relative(ROOT, path) : path);

const zeroByRule = () => Object.fromEntries(ruleNames.map((rule) => [rule, 0]));

/**
 * The files that report an unsuppressed finding of a scored rule, per rule. ESLint's bulk suppression is
 * all-or-nothing per file and rule: a new long function in a file that froze one makes that file report
 * ALL its findings of the rule unsuppressed, so its frozen count no longer matches the suppressed one.
 * Such files go to the ratchet, which names the function; the coverage guard leaves them out.
 */
function filesWithNewFindings(results) {
  const waived = Object.fromEntries(ruleNames.map((rule) => [rule, new Set()]));

  for (const result of results) {
    for (const message of result.messages.filter((m) => m.ruleId in RULES)) {
      waived[message.ruleId].add(relPath(result.filePath));
    }
  }

  return waived;
}

/** How many suppressed findings each scored rule has in ESLint's output, outside the waived files. */
function suppressedByRule({ results, waived }) {
  const counts = zeroByRule();

  for (const result of results) {
    for (const message of result.suppressedMessages ?? []) {
      const counted =
        message.ruleId in RULES && !waived[message.ruleId].has(relPath(result.filePath));

      counts[message.ruleId] += counted ? 1 : 0;
    }
  }

  return counts;
}

/** How many findings each scored rule has in eslint-suppressions.json, outside the waived files. */
function frozenByRule({ suppressions, waived }) {
  const counts = zeroByRule();

  for (const [file, rules] of Object.entries(suppressions)) {
    for (const rule of ruleNames.filter((name) => !waived[name].has(file))) {
      counts[rule] += rules[rule]?.count ?? 0;
    }
  }

  return counts;
}

/**
 * Throws unless the findings ESLint reported are exactly the ones eslint-suppressions.json froze. A file
 * that also has a NEW finding of a rule is skipped here and judged by the ratchet, so the message names
 * the function and not the suppressions file.
 */
export function checkCoverage({ results, suppressions }) {
  const waived = filesWithNewFindings(results);
  const seen = suppressedByRule({ results, waived });
  const frozen = frozenByRule({ suppressions, waived });

  if (!results.some((result) => scored(result).length)) {
    throw new Error(
      'none of the scored rules reported a finding: the rules are off or the run read nothing.'
    );
  }

  for (const rule of ruleNames) {
    if (seen[rule] !== frozen[rule]) {
      throw new Error(
        `${rule}: ESLint reported ${seen[rule]} frozen findings but ${SUPPRESSIONS_FILE} holds ${frozen[rule]}. Run npm run lint, fix what it reports, and if it reports nothing run npm run lint -- --prune-suppressions.`
      );
    }
  }
}

function runEslint() {
  const run = spawnSync(process.execPath, [ESLINT_BIN, '.', '-f', 'json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });

  if (run.status === null || run.status >= ESLINT_FAILED) {
    throw new Error(`ESLint failed to run: ${(run.stderr ?? '').slice(0, ERROR_TAIL)}`);
  }

  return JSON.parse(run.stdout);
}

let scanned = emptySections();

function scan() {
  const results = runEslint();
  const suppressions = JSON.parse(readFileSync(join(ROOT, SUPPRESSIONS_FILE), 'utf8'));

  checkCoverage({ results, suppressions });
  scanned = collectScores(results);

  return scanned;
}

/** A baseline entry of this rule with this score that is gone from the scan: the likely old name of a moved finding. */
function likelyOldKey(rule, score) {
  const file = join(ROOT, BASELINE_FILE);
  const saved = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8'))[rule] ?? {}) : {};

  return Object.keys(saved).find((key) => saved[key] === score && !(key in scanned[rule]));
}

const SHIFTED = /#\d+$|>callback|>expr/;

/** The message for a finding above its baseline, written for the agent that reads it as its prompt. */
function messageFor(rule) {
  return ({ file, now, was }) => {
    if (was) {
      return `${file}: ${rule} rose from ${was} to ${now}. A frozen finding may only get smaller: undo what made it worse, or reduce it. ${RULES[rule].advice}`;
    }

    const old = likelyOldKey(rule, now);
    const moved = old
      ? ` It may be ${old}, renamed or moved: a moved finding is recorded by a ruled hand edit of ${BASELINE_FILE}.`
      : '';
    const shifted = SHIFTED.test(file)
      ? ' A sibling may have shifted the ordinal in this key.'
      : '';

    return `${file}: ${rule} ${now} is not in the baseline.${moved}${shifted} A new function has to stay within the limit. ${RULES[rule].advice}`;
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runRatchetGate({
    gate: 'scores',
    baselineFile: BASELINE_FILE,
    command: 'scores:baseline',
    about:
      'The score of every frozen G04 / G06 finding (function length, parameters, cognitive, cyclomatic, expression), keyed by file::function. It may shrink, never grow. Rewrite with npm run scores:baseline.',
    scan,
    sections: Object.fromEntries(ruleNames.map((rule) => [rule, messageFor(rule)])),
  });
}
