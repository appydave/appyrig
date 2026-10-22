/**
 * The ratchet every baselined architecture gate shares (G13 cohesion, G14 coupling): scan, compare
 * with the committed baseline, and fail on anything above it or below it. A baseline may shrink and
 * never grow; `--init` writes the first one and refuses to overwrite one; a run that did not look
 * (the scan threw) exits 2 and is never reported as clean.
 *
 * Exit: 0 clean, 1 findings above the baseline (or a baseline that can shrink), 2 the run itself failed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './archlint-scan.mjs';
import { baseRef, refuseInitOverBaseline, sectionsOnBase, sortedByKey } from './baseline-tools.mjs';

const ABOUT_KEY = 'about';

function differences({ from, against, isOff }) {
  return Object.entries(from)
    .map(([file, count]) => ({ file, count, other: against[file] ?? 0 }))
    .filter(({ count, other }) => isOff(count, other));
}

/** `grown`: a file above its baseline or not in it. `shrunk`: a file below it or gone, so the baseline is stale. */
export function compare(actual, baseline) {
  return {
    grown: differences({ from: actual, against: baseline, isOff: (now, was) => now > was }).map(
      ({ file, count, other }) => ({ file, now: count, was: other })
    ),
    shrunk: differences({ from: baseline, against: actual, isOff: (was, now) => now < was }).map(
      ({ file, count, other }) => ({ file, now: other, was: count })
    ),
  };
}

function fail(code, ...lines) {
  console.error(lines.join('\n'));
  process.exit(code);
}

/** Per section, the entries above and below the baseline, each tagged with the section's message. */
function compareSections({ sections, actual, baseline }) {
  const grown = [];
  const shrunk = [];

  for (const [name, messageFor] of Object.entries(sections)) {
    const found = compare(actual[name], baseline[name] ?? {});

    grown.push(...found.grown.map((g) => ({ ...g, section: name, text: messageFor(g) })));
    shrunk.push(...found.shrunk.map((s) => ({ ...s, text: `  ${s.file}: ${s.was} -> ${s.now}` })));
  }

  return { grown, shrunk };
}

/** A baseline holding a section this gate does not own would hide findings of another rule. */
export function foreignSections({ saved, sections }) {
  return Object.keys(saved).filter((key) => key !== ABOUT_KEY && !(key in sections));
}

function writeBaseline({ gate, file, about, actual, sections }) {
  const body = { [ABOUT_KEY]: about };

  for (const name of Object.keys(sections)) {
    body[name] = sortedByKey(actual[name]);
  }

  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`${gate}: wrote ${file.split('/').pop()} (${summary({ sections, actual })})`);
}

function scanOrExit({ gate, scan }) {
  try {
    return scan();
  } catch (error) {
    return fail(2, `${gate}: the run failed, so nothing was checked.\n${error.message}`);
  }
}

/** The saved baseline, or {} when there is none and `--init` is about to write it. Exits when it cannot be used. */
function loadBaseline({ gate, baselineFile, sections }) {
  const file = join(ROOT, baselineFile);

  if (!existsSync(file)) {
    if (!process.argv.includes('--init')) {
      fail(
        2,
        `${gate}: ${baselineFile} is missing. Create it once with: node lint/gates/${gate}.mjs --init`
      );
    }

    return {};
  }

  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const foreign = foreignSections({ saved, sections });

  if (foreign.length) {
    fail(
      1,
      `${gate}: ${baselineFile} holds ${foreign.join(', ')}, which this gate does not own. Remove it: a baseline holds only its own rule's findings.`
    );
  }

  return saved;
}

const summary = ({ sections, actual }) =>
  Object.keys(sections)
    .map((name) => `${Object.keys(actual[name]).length} ${name}`)
    .join(', ');

/** The sections `--adopt=<section>` asks for. */
const adoptionsAsked = (argv = process.argv) =>
  argv.filter((arg) => arg.startsWith('--adopt=')).map((arg) => arg.slice('--adopt='.length));

/**
 * The asked-for sections that may be adopted: the one way a rule added to a gate has its first findings
 * recorded. A section the baseline holds, or that the base branch holds (`onBase`), cannot be adopted:
 * deleting it from the working file must not turn its existing findings into new ones.
 */
export function adoptable({ saved, sections, onBase = [], argv = process.argv }) {
  return adoptionsAsked(argv).filter(
    (name) => name in sections && !(name in saved) && !onBase.includes(name)
  );
}

/** The sections already on the base branch, read from git; exits (closed) when git cannot say. */
function committedSections({ gate, baselineFile }) {
  try {
    return sectionsOnBase({ root: ROOT, baselineFile });
  } catch (error) {
    return fail(
      1,
      `${gate}: --adopt needs ${baselineFile} as committed on ${baseRef(ROOT)}, and could not read it: ${error.message}`
    );
  }
}

/** Refuses an adoption of a section the base branch already holds, saying why. */
function refuseAdoptingBase({ gate, baselineFile, onBase }) {
  const blocked = adoptionsAsked().filter((name) => onBase.includes(name));

  if (blocked.length) {
    fail(
      1,
      `${gate}: cannot adopt ${blocked.join(', ')}: ${baselineFile} on ${baseRef(ROOT)} already holds ${blocked.length > 1 ? 'them' : 'it'}. A rule already in the baseline cannot be re-recorded with more findings. Restore the section from ${baseRef(ROOT)} and fix the new findings instead.`
    );
  }
}

/** Writes the baseline for `--init` and `--update`; `--update` refuses to grow it, except a section being adopted. */
function record({ gate, baselineFile, about, actual, sections, grown, saved }) {
  const onBase = adoptionsAsked().length ? committedSections({ gate, baselineFile }) : [];

  refuseAdoptingBase({ gate, baselineFile, onBase });

  const adopted = adoptable({ saved, sections, onBase });
  const refused = grown.filter((g) => !adopted.includes(g.section));

  if (refused.length && !process.argv.includes('--init')) {
    const newRule = refused.some((g) => !(g.section in saved));
    const hint = newRule
      ? ' (A rule new to this gate is recorded once with --update --adopt=<section>; a section already on the base branch cannot be adopted.)'
      : '';

    fail(1, `${gate}: refusing to grow the baseline.${hint}`, ...refused.map((g) => g.text));
  }

  writeBaseline({ gate, file: join(ROOT, baselineFile), about, actual, sections });
}

/** Fails when the scan is above the baseline, or below it (the baseline is stale). */
function check({ gate, command, actual, sections, grown, shrunk }) {
  if (grown.length) {
    fail(
      1,
      `${gate} FAILED: ${grown.length} finding(s) above the baseline\n`,
      ...grown.map((g) => g.text)
    );
  }

  if (shrunk.length) {
    fail(
      1,
      `${gate} FAILED: ${shrunk.length} finding(s) are better than the baseline, so it is stale. Record the gain with npm run ${command}:`,
      ...shrunk.map((s) => s.text)
    );
  }

  console.log(`${gate}: ok (${summary({ sections, actual })} at their baseline)`);
}

/**
 * @param {object} gate
 * @param {string} gate.gate        name used to prefix messages: 'cohesion'
 * @param {string} gate.baselineFile  repo-relative baseline: 'cohesion-baseline.json'
 * @param {string} gate.command     the npm script that rewrites it: 'cohesion:baseline'
 * @param {string} gate.about       the baseline's own explanation line
 * @param {() => object} gate.scan  { section: { file: count } }; throws when the run did not look
 * @param {object} gate.sections    { section: (grownEntry) => message written for the agent that reads it }
 */
export function runRatchetGate(options) {
  const { gate, baselineFile, command, sections } = options;

  refuseInitOverBaseline({ gate, root: ROOT, baseline: baselineFile, command });

  const saved = loadBaseline(options);
  const actual = scanOrExit(options);
  const { grown, shrunk } = compareSections({ sections, actual, baseline: saved });

  if (process.argv.includes('--init') || process.argv.includes('--update')) {
    record({ ...options, actual, grown, saved });
  } else {
    check({ gate, command, actual, sections, grown, shrunk });
  }
}
