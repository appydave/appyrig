import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
// @ts-expect-error plain .js policy with no type declarations
import { limitRules } from '@root/lint/limits.js';
// @ts-expect-error plain .js policy with no type declarations
import { complexityPlugins, complexityRules } from '@root/lint/complexity.js';
// @ts-expect-error plain .mjs gate with no type declarations
import { checkCoverage, collectScores, scoreOf } from '@root/lint/gates/scores.mjs';
// @ts-expect-error plain .mjs gate with no type declarations
import { keysFor } from '@root/lint/gates/scores-keys.mjs';
// @ts-expect-error plain .mjs gate with no type declarations
import { compare } from '@root/lint/gates/ratchet-gate.mjs';

interface Message {
  ruleId: string;
  message: string;
  line: number;
  column: number;
}

/** The real messages of the installed ESLint and SonarJS for `code`, under the repo's own size and complexity rules. */
async function lint(code: string): Promise<Message[]> {
  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [{ plugins: complexityPlugins, rules: { ...limitRules, ...complexityRules } }],
  });
  const [result] = await eslint.lintText(code, { filePath: 'probe.js' });

  return result!.messages as Message[];
}

const LONG = `function long() {\n${'  step();\n'.repeat(41)}}\n`;
const MANY_PARAMS = 'function many(a, b, c, d) {\n  return a;\n}\n';
const NESTED =
  'function nested(a, b, c, d) {\n  if (a) { if (b) { if (c) { if (d) { run(); } } } }\n}\n';
const BRANCHY = `function branchy(x) {\n${[1, 2, 3, 4, 5, 6, 7].map((n) => `  if (x === ${n}) { return ${n}; }`).join('\n')}\n}\n`;
const WIDE = 'const wide = a && b && c && d && e;\n';

const keysOf = async (code: string, ruleId: string) => {
  const found = (await lint(code)).filter((m) => m.ruleId === ruleId);

  return keysFor({ file: 'probe.js', text: code, findings: found });
};

describe('the score in each rule message (pinned to the installed ESLint and SonarJS wording)', () => {
  it.each([
    ['max-lines-per-function', LONG, 43],
    ['max-params', MANY_PARAMS, 4],
    ['sonarjs/cognitive-complexity', NESTED, 10],
    ['sonarjs/cyclomatic-complexity', BRANCHY, 8],
    ['sonarjs/expression-complexity', WIDE, 4],
  ])('%s reads as its score', async (ruleId, code, score) => {
    const message = (await lint(code)).find((m) => m.ruleId === ruleId);

    expect(message, `${ruleId} did not fire on its probe`).toBeDefined();
    expect(scoreOf(ruleId, message!.message)).toBe(score);
  });

  it('refuses a message it cannot read, rather than scoring it zero', () => {
    expect(() => scoreOf('max-params', 'something else entirely')).toThrow(/no score/);
  });
});

describe('the key of a finding', () => {
  it('is the function name, never a line number', async () => {
    expect(await keysOf(LONG, 'max-lines-per-function')).toEqual(['long']);
    expect(await keysOf(`// a new comment\n\n${LONG}`, 'max-lines-per-function')).toEqual(['long']);
  });

  it('names an arrow function by what it is assigned to, and a callback by its parent', async () => {
    const body = '  step();\n'.repeat(41);
    const code = `const named = () => {\n${body}};\nfunction outer(xs) {\n  return xs.map((x) => {\n${body}  });\n}\n`;

    expect(await keysOf(code, 'max-lines-per-function')).toEqual([
      'named',
      'outer',
      'outer>callback',
    ]);
  });

  it('numbers repeats of one name in source order', async () => {
    const run = `  run() {\n${'    step();\n'.repeat(41)}  }\n`;
    const keys = await keysOf(`class A {\n${run}}\nclass B {\n${run}}\n`, 'max-lines-per-function');

    expect(keys).toEqual(['run', 'run#2']);
  });

  it('keys an expression under the function around it', async () => {
    const code = 'function check(a, b, c, d, e) {\n  return a && b && c && d && e;\n}\n';

    expect(await keysOf(code, 'sonarjs/expression-complexity')).toEqual(['check>expr']);
  });
});

describe('the ratchet over scores', () => {
  const baseline = { 'a.ts::run': 52 };

  it('fails a frozen score that rose by one', () => {
    expect(compare({ 'a.ts::run': 53 }, baseline).grown).toEqual([
      { file: 'a.ts::run', now: 53, was: 52 },
    ]);
  });

  it('fails a finding the baseline does not have', () => {
    expect(compare({ 'a.ts::run': 52, 'a.ts::new': 41 }, baseline).grown).toEqual([
      { file: 'a.ts::new', now: 41, was: 0 },
    ]);
  });

  it('passes a lower score, but calls the baseline stale until it is recorded', () => {
    const found = compare({ 'a.ts::run': 40 }, baseline);

    expect(found.grown).toEqual([]);
    expect(found.shrunk).toEqual([{ file: 'a.ts::run', now: 40, was: 52 }]);
  });
});

describe('a run that did not look', () => {
  const result = (suppressed: number) => ({
    filePath: 'x.js',
    messages: [],
    suppressedMessages: Array.from({ length: suppressed }, () => ({ ruleId: 'max-params' })),
  });
  const frozen = (count: number) => ({ 'x.js': { 'max-params': { count } } });

  it('throws when no scored rule reported anything', () => {
    expect(() => checkCoverage({ results: [result(0)], suppressions: frozen(0) })).toThrow(
      /none of the scored rules/
    );
  });

  it('throws when ESLint saw fewer frozen findings than eslint-suppressions.json holds', () => {
    expect(() => checkCoverage({ results: [result(1)], suppressions: frozen(2) })).toThrow(
      /holds 2/
    );
  });

  it('passes when the two agree', () => {
    expect(() => checkCoverage({ results: [result(2)], suppressions: frozen(2) })).not.toThrow();
  });

  it('collects the scores of suppressed and unsuppressed findings alike', async () => {
    const code = MANY_PARAMS;
    const [message] = await lint(code);
    const results = [{ filePath: '/probe.js', messages: [], suppressedMessages: [message] }];
    const found = collectScores(results, () => code);

    expect(Object.values(found['max-params'])).toEqual([4]);
  });
});
