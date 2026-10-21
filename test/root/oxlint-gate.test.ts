import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CAST_MARKER,
  CAST_RULE,
  MARKER_HOMES,
  NOT_SCANNED,
  compare,
  countFindings,
  findCastExemptions,
  findDisableDirectives,
  messageFor,
  reportProblem,
  rulesThatGrew,
  scanTexts,
} from '../../scripts/oxlint-gate.mjs';

/**
 * G02 gate wrapper: scripts/oxlint-gate.mjs turns Oxlint's findings into a baseline ratchet. This
 * covers our logic (counting, comparing, trusting a run) and the wiring, not Oxlint's own rules.
 */

const ROOT = new URL('../..', import.meta.url).pathname;
const OX = `oxlint-${'dis'}able`;
const ES = `eslint-${'dis'}able`;
const finding = (filename: string, rule: string) => ({ filename, code: `anti-slop(${rule})` });

describe('Feature: findings are counted per file and per rule', () => {
  it('Scenario: given three findings in two files, when counted, then they group by file and rule', () => {
    const counts = countFindings({
      diagnostics: [
        finding('a.ts', 'no-unknown-parameters'),
        finding('a.ts', 'no-unknown-parameters'),
        finding('b.ts', 'no-module-mocking'),
      ],
    });

    expect(counts).toEqual({
      'a.ts': { 'no-unknown-parameters': 2 },
      'b.ts': { 'no-module-mocking': 1 },
    });
  });

  it('Scenario: given a report with no diagnostics, when counted, then nothing is found', () => {
    expect(countFindings({})).toEqual({});
  });
});

describe('Feature: the baseline can shrink but never grow', () => {
  const baseline = { 'a.ts': { 'no-unknown-parameters': 2 } };

  it('Scenario: given the same findings as the baseline, then nothing grew or shrank', () => {
    expect(compare({ 'a.ts': { 'no-unknown-parameters': 2 } }, baseline)).toEqual({
      grown: [],
      shrunk: [],
    });
  });

  it('Scenario: given one more finding in a baselined file, then it has grown', () => {
    const r = compare({ 'a.ts': { 'no-unknown-parameters': 3 } }, baseline);

    expect(r.grown).toEqual([{ file: 'a.ts', rule: 'no-unknown-parameters', now: 3, was: 2 }]);
  });

  it('Scenario: given a finding in a file the baseline does not list, then it has grown from zero', () => {
    const r = compare({ ...baseline, 'new.ts': { 'no-module-mocking': 1 } }, baseline);

    expect(r.grown).toEqual([{ file: 'new.ts', rule: 'no-module-mocking', now: 1, was: 0 }]);
  });

  it('Scenario: given a different rule in a baselined file, then it has grown from zero', () => {
    const r = compare({ 'a.ts': { 'no-unknown-parameters': 2, 'no-module-mocking': 1 } }, baseline);

    expect(r.grown.map((g) => g.rule)).toEqual(['no-module-mocking']);
  });

  it('Scenario: given fewer findings than the baseline, then the baseline is stale', () => {
    const r = compare({ 'a.ts': { 'no-unknown-parameters': 1 } }, baseline);

    expect(r.shrunk).toEqual([{ file: 'a.ts', rule: 'no-unknown-parameters', now: 1, was: 2 }]);
    expect(r.grown).toEqual([]);
  });

  it('Scenario: given a baselined file with no findings left, then the baseline is stale', () => {
    expect(compare({}, baseline).shrunk).toEqual([
      { file: 'a.ts', rule: 'no-unknown-parameters', now: 0, was: 2 },
    ]);
  });

  it('Scenario: given a fix in one file and a new finding in another, then both are reported', () => {
    const r = compare({ 'b.ts': { 'no-module-mocking': 1 } }, baseline);

    expect(r.grown).toHaveLength(1);
    expect(r.shrunk).toHaveLength(1);
  });
});

describe('Feature: moving a file is not growing the baseline', () => {
  const baseline = { 'old.ts': { 'no-unknown-parameters': 2 }, 'x.ts': { 'no-module-mocking': 1 } };

  it('Scenario: given the same findings under a new path, then no rule grew', () => {
    const moved = { 'new.ts': { 'no-unknown-parameters': 2 }, 'x.ts': { 'no-module-mocking': 1 } };

    expect(rulesThatGrew(baseline, moved)).toEqual([]);
  });

  it('Scenario: given one new finding while another was fixed elsewhere in the same rule, then no rule grew', () => {
    const swapped = {
      'old.ts': { 'no-unknown-parameters': 1 },
      'z.ts': { 'no-unknown-parameters': 1 },
    };

    expect(rulesThatGrew(baseline, swapped)).toEqual([]);
  });

  it('Scenario: given a new finding with nothing fixed, then that rule grew', () => {
    const worse = { ...baseline, 'new.ts': { 'no-unknown-parameters': 1 } };

    expect(rulesThatGrew(baseline, worse)).toEqual(['no-unknown-parameters']);
  });

  it('Scenario: given a finding for a rule the baseline never had, then that rule grew', () => {
    expect(rulesThatGrew({}, { 'a.ts': { 'inline-disable': 1 } })).toEqual(['inline-disable']);
  });
});

describe('Feature: a disable comment cannot hide a finding', () => {
  it('Scenario: given a comment that disables an anti-slop rule, then it is found with its line', () => {
    const text = `const a = 1;\n// ${OX}-next-line anti-slop/no-unknown-parameters\nfn(x);\n`;

    expect(findDisableDirectives(text)).toEqual([
      { line: 2, text: `${OX}-next-line anti-slop/no-unknown-parameters` },
    ]);
  });

  it('Scenario: given an eslint-style comment for an anti-slop rule, then it is found too', () => {
    expect(findDisableDirectives(`// ${ES}-line anti-slop/no-module-mocking`)).toHaveLength(1);
  });

  it('Scenario: given a blanket disable that names no rule, then it is found', () => {
    expect(findDisableDirectives(`/* ${ES} */`)).toHaveLength(1);
    expect(findDisableDirectives(`// ${OX}`)).toHaveLength(1);
  });

  it('Scenario: given a disable for another rule, even with a reason, then it is left alone', () => {
    expect(findDisableDirectives(`// ${ES}-next-line no-control-regex`)).toEqual([]);
    expect(
      findDisableDirectives(`// ${ES}-next-line react-hooks/exhaustive-deps -- by key`)
    ).toEqual([]);
  });

  it('Scenario: given a reason that mentions anti-slop after the dashes, then it is left alone', () => {
    expect(findDisableDirectives(`// ${ES}-next-line no-undef -- not anti-slop`)).toEqual([]);
  });

  it('Scenario: given the folders the disable-comment scan skips, then they are exactly the vendored, recorded and tooling ones', () => {
    // Skipping another folder lets a disable comment hide a finding there: change this on purpose.
    expect(NOT_SCANNED).toEqual([
      'test/fixtures/',
      'test/root/fixtures/',
      'server/src/core/vendor/',
      '.claude/',
    ]);
  });

  it('Scenario: given the folders the scan skips, then each is also ignored by oxlint.config.ts', () => {
    const config = readFileSync(join(ROOT, 'oxlint.config.ts'), 'utf8');

    for (const prefix of NOT_SCANNED) {
      expect(config, prefix).toContain(`'${prefix}**'`);
    }
  });
});

describe('Feature: the count of type casts in production code can only go down', () => {
  const config = readFileSync(join(ROOT, 'oxlint.config.ts'), 'utf8');

  it('Scenario: given a comment that uses the exemption marker, then it is found with its line', () => {
    const text = `const a = 1;\n// ${CAST_MARKER}: trust me\nconst b = x as Foo;\n`;

    expect(findCastExemptions(text)).toEqual([{ line: 2, text: `// ${CAST_MARKER}: trust me` }]);
  });

  it('Scenario: given an ordinary SAFETY comment, then it is not an exemption and not flagged', () => {
    expect(findCastExemptions('// SAFETY: checked upstream\nconst b = x as Foo;')).toEqual([]);
  });

  it('Scenario: given the cast rule fails, then the message says no comment exempts a cast', () => {
    const msg = messageFor(CAST_RULE, 'This type assertion has no `SAFETY:` justification.');

    expect(msg).toContain('no comment exempts one');
    expect(msg).not.toContain('SAFETY');
    expect(msg).not.toContain(CAST_MARKER);
  });

  it('Scenario: given any other rule, then its own message is passed through unchanged', () => {
    expect(messageFor('no-module-mocking', 'Replace module mocking.')).toBe(
      'Replace module mocking.'
    );
  });

  it('Scenario: given the config, then the cast rule runs with the unwritable marker', () => {
    expect(config).toContain(`anti-slop/${CAST_RULE}`);
    expect(config).toContain(`markers: ['${CAST_MARKER}']`);
  });

  it('Scenario: given the files that define the marker, then each contains it and is exempt from the scan', () => {
    for (const home of MARKER_HOMES) {
      expect(readFileSync(join(ROOT, home), 'utf8'), home).toContain(CAST_MARKER);
    }
  });

  it('Scenario: given the config, then test code, e2e and test support are switched off for the cast rule', () => {
    for (const glob of ['**/*.test.', '**/*.spec.', "'e2e/**'", "'test/**'", "'**/test/**'"]) {
      expect(config, glob).toContain(glob);
    }

    expect(config).toMatch(new RegExp(`anti-slop/${CAST_RULE}': 'off'`));
  });

  it('Scenario: given the baseline, then every recorded cast is in production code', () => {
    const { findings } = JSON.parse(readFileSync(join(ROOT, 'oxlint-baseline.json'), 'utf8'));
    const files = Object.keys(findings).filter((f) => findings[f][CAST_RULE]);
    const testLike = /\.(test|spec)\.|(^|\/)(e2e|test)\/|test-kit/;

    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => testLike.test(f))).toEqual([]);
  });
});

describe('Feature: the scan applies both checks to every file it is given', () => {
  const marker = `// ${CAST_MARKER}: trust me\nconst b = x as Foo;`;
  const disable = `// ${OX}-next-line anti-slop/no-unknown-parameters\nfunction f(a: unknown) {}`;

  it('Scenario: given a file using the exemption marker, then it is reported as a cast-exemption-comment', () => {
    const d = scanTexts([{ name: 'server/src/a.ts', text: marker }]);

    expect(d.map((x) => [x.filename, x.code, x.labels[0]!.span.line])).toEqual([
      ['server/src/a.ts', 'anti-slop(cast-exemption-comment)', 1],
    ]);
  });

  it('Scenario: given a file with a disable comment, then it is reported as an inline-disable', () => {
    const d = scanTexts([{ name: 'server/src/b.ts', text: disable }]);

    expect(d.map((x) => x.code)).toEqual(['anti-slop(inline-disable)']);
  });

  it('Scenario: given a clean file, then nothing is reported', () => {
    expect(scanTexts([{ name: 'server/src/c.ts', text: 'export const a = 1;' }])).toEqual([]);
  });

  it('Scenario: given the files that define the marker, then using it there is not a finding', () => {
    const d = scanTexts(MARKER_HOMES.map((name) => ({ name, text: marker })));

    expect(d).toEqual([]);
  });

  it('Scenario: given the same marker in a vendored folder, then it is not scanned', () => {
    expect(scanTexts([{ name: `${NOT_SCANNED[0]}x.ts`, text: marker }])).toEqual([]);
  });

  it('Scenario: given several files, then each finding names its own file', () => {
    const d = scanTexts([
      { name: 'client/src/x.ts', text: marker },
      { name: 'server/src/y.ts', text: disable },
    ]);

    expect(d.map((x) => x.filename)).toEqual(['client/src/x.ts', 'server/src/y.ts']);
  });
});

describe('Feature: a run that looked at nothing is never a pass', () => {
  it('Scenario: given a report that checked 0 files, then it cannot be trusted', () => {
    expect(reportProblem({ number_of_files: 0, number_of_rules: 8 })).toContain('0 files');
  });

  it('Scenario: given a report that loaded 0 rules, then it cannot be trusted', () => {
    expect(reportProblem({ number_of_files: 400, number_of_rules: 0 })).toContain('0 rules');
  });

  it('Scenario: given files and rules, then the report is trusted', () => {
    expect(reportProblem({ number_of_files: 400, number_of_rules: 8 })).toBeNull();
  });
});

describe('Feature: the gate runs in CI and the baseline is well formed', () => {
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  it('Scenario: given the CI workflow, then it runs npm run oxlint', () => {
    expect(ci).toMatch(/run:\s*npm run oxlint\s*$/m);
  });

  it('Scenario: given every CI job that installs, then pnpm is there first (the plugin builds with it)', () => {
    const installs = ci.match(/run: npm install\s*$/gm)?.length ?? 0;
    const pnpm = ci.match(/run: npm install -g pnpm\s*$/gm)?.length ?? 0;

    expect(installs).toBeGreaterThan(0);
    expect(pnpm).toBe(installs);
  });

  it('Scenario: given package.json, then the plugin is pinned to a full commit sha and oxlint to an exact version', () => {
    expect(pkg.devDependencies['oxlint-plugin-anti-slop']).toMatch(
      /^github:sirknigget\/anti-slop#[0-9a-f]{40}$/
    );
    expect(pkg.devDependencies.oxlint).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('Scenario: given the baseline file, then every count is a positive whole number', () => {
    const { findings } = JSON.parse(readFileSync(join(ROOT, 'oxlint-baseline.json'), 'utf8'));
    const counts = Object.values(findings).flatMap((rules) => Object.values(rules as object));

    expect(counts.length).toBeGreaterThan(0);
    expect(counts.every((n) => Number.isInteger(n) && (n as number) > 0)).toBe(true);
  });
});
