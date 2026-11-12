import { describe, expect, it } from 'vitest';
import { Linter, RuleTester, type Rule } from 'eslint';
import tsParser from '@typescript-eslint/parser';
// @ts-expect-error plain .js policy with no type declarations
import { expressionShape } from '@root/lint/expression-shape.js';

/**
 * G06 expression shape (lint/expression-shape.js): David's ruling of 12 Nov 2026 on the ten-finding sample
 * (appyrigs runs/ladder/appyrig/g06-expression-sample.md). Samples 1-5, 7, 8 and 10 are fine; 6 and 9 were the problems.
 */
RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const rule = expressionShape as Rule.RuleModule;
const nested = (count: number) => [{ messageId: 'nestedTernary', data: { count: String(count) } }];
const mixed = (count: number) => [{ messageId: 'mixedChain', data: { count: String(count) } }];

// The eight samples David called fine, exactly as the sample shows them (wrapped so each parses on its own).
const FINE_SAMPLES: Array<[string, string]> = [
  [
    '1: a short "or" chain, as a guard',
    'if (sameRow(ca, cb) || p.planned || !pa || !pb || pa === pb) {\n  draw();\n}',
  ],
  [
    '2: an "or" chain checking a record',
    'function f() {\n  if (!id || id.length > 30 || !qitemId || !state || !Number.isFinite(ms)) {\n    return null;\n  }\n}',
  ],
  [
    '3: an "and" chain on a key press',
    "if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTextEntry(e.target)) {\n  go();\n}",
  ],
  [
    '4: "and" with a bracketed "or", either order',
    'xs.filter((e) => !e.self && ((e.from === p.a && e.to === p.b) || (e.from === p.b && e.to === p.a)));',
  ],
  [
    '5: a filter written as a list of cases',
    "const matches = (f: WallFilter, flags: SeatFlags) =>\n  f === 'all' ||\n  (f === 'needs' && flags.needs) ||\n  (f === 'stuck' && flags.stuck) ||\n  (f === 'failing' && flags.failing);",
  ],
  [
    '7: a nested ternary laid out as a ladder',
    "const outcome: Outcome = fresh.length\n  ? 'running'\n  : open.length\n    ? 'stalled'\n    : lastPhase && dotState(lastPhase.last.state) === 'stopped'\n      ? 'stopped'\n      : 'finished';",
  ],
  [
    '8: a ternary with a long test in front',
    'use(preview && real && fm && rig && real.jobs.length > 0 ? sampleRun(real, fm, rig.name) : real);',
  ],
  [
    '10: a screen piece that shows one of two blocks',
    `const view = (
  <div>
    {live && specsRead ? (
      <>
        <SpecList specs={live.specs} label={label} />
        {specsUnread.length > 0 && (
          <p className="quiet" data-testid="wf-specs-unread">
            Specs not read on {specsUnread.map((m) => label(m.machine)).join(', ')}
          </p>
        )}
      </>
    ) : (
      <p>Nothing to show yet.</p>
    )}
  </div>
);`,
  ],
];

// Sample 9 verbatim; sample 6's operators with its first bracket dropped, on one line (what the rule can see of it).
const SAMPLE_9 =
  'const sorted = ids.sort(\n  (x, y) =>\n    (created.get(x) ?? -Infinity) - (created.get(y) ?? -Infinity) ||\n    (x < y ? -1 : x > y ? 1 : 0)\n);';
const SAMPLE_6_SHAPE =
  "if (c === '*' || c === '_' && src[i + 1] !== ' ' && (c === '*' || i === 0 || /\\W/.test(src[i - 1]!))) {\n  open();\n}";
const SAMPLE_6_VERBATIM =
  "if (\n  (c === '*' || c === '_') &&\n  src[i + 1] !== ' ' &&\n  (c === '*' || i === 0 || /\\W/.test(src[i - 1]!))\n) {\n  open();\n}";

tester.run('g06/expression-shape: the ten samples', rule, {
  valid: FINE_SAMPLES.map(([name, code]) => ({ name, code })),
  invalid: [
    {
      name: '9: a sort whose tie-break is a ternary ladder inside ||',
      code: SAMPLE_9,
      errors: nested(5),
    },
    {
      name: '6: && mixed with || on one line, unbracketed',
      code: SAMPLE_6_SHAPE,
      errors: mixed(5),
    },
  ],
});

tester.run('g06/expression-shape: point 1, a run of one operator counts as one', rule, {
  valid: [
    { name: 'a long && run', code: 'const ok = a && b && c && d && e && f && g;' },
    { name: 'a long || run', code: 'const no = a || b || c || d || e || f || g;' },
    { name: 'a long ?? run', code: 'const v = a ?? b ?? c ?? d ?? e;' },
  ],
  invalid: [],
});

tester.run('g06/expression-shape: point 2, JSX conditional markup is not scored', rule, {
  valid: [
    { name: '{a && <X />}', code: 'const v = <div>{a && b && c && <X />}</div>;' },
    { name: '{a ? <X /> : <Y />}', code: 'const v = <div>{a && b ? <X /> : <Y />}</div>;' },
    {
      name: 'an either-or block behind a guard',
      code: 'const v = <div>{a && (b ? <X /> : <Y />)}</div>;',
    },
    { name: 'mixed guard in front of markup', code: 'const v = <div>{a || b && <X />}</div>;' },
  ],
  invalid: [
    {
      name: 'a text ternary inside || in JSX is still an expression',
      code: "const v = <span>{line ?? (stopped ? 'stopped' : 'none')}</span>;",
      errors: nested(2),
    },
  ],
});

tester.run('g06/expression-shape: point 3, a ternary nested inside another expression', rule, {
  valid: [
    { name: 'a ladder as an initializer', code: 'const v = a ? 1 : b ? 2 : 3;' },
    {
      name: 'a ladder as a whole return',
      code: 'const byId = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);',
    },
    { name: 'one plain ternary in arithmetic', code: 'const n = total + (a ? 1 : 0);' },
    {
      name: 'one plain ternary in a comparison',
      code: 'const big = bytes > (image ? MAX_IMG : MAX_TXT);',
    },
    { name: 'a ternary as a call argument', code: 'use(a ? b : c, d ? e : f);' },
  ],
  invalid: [
    { name: 'x || (a ? b : c)', code: 'const v = x || (a ? b : c);', errors: nested(2) },
    { name: 'x ?? (a ? b : c)', code: 'const v = x ?? (a ? b : c);', errors: nested(2) },
    {
      name: 'a ternary as the test of a ternary',
      code: 'const v = (a ? b : c) ? d : e;',
      errors: nested(2),
    },
    {
      name: 'a ladder as an arithmetic operand',
      code: 'const n = 1 + (a ? 1 : b ? 2 : 3);',
      errors: nested(2),
    },
    {
      name: "a ternary inside a comparator's return",
      code: 'xs.sort((x, y) => x.n - y.n || (x.id < y.id ? -1 : 1));',
      errors: nested(2),
    },
  ],
});

tester.run('g06/expression-shape: point 4, && mixed with || on one line without brackets', rule, {
  valid: [
    { name: 'the inner group bracketed', code: 'const v = (a && b) || c;' },
    { name: 'bracketed on the right', code: 'const v = a || (b && c);' },
    { name: 'a line break between || and &&', code: 'const v =\n  a ||\n  b && c;' },
  ],
  invalid: [
    { name: 'a && b || c', code: 'const v = a && b || c;', errors: mixed(2) },
    { name: 'a || b && c', code: 'const v = a || b && c;', errors: mixed(2) },
    {
      name: '&& and || on one line before a break',
      code: 'const v = a && b ||\n  c;',
      errors: mixed(2),
    },
  ],
});

describe('g06/expression-shape: what a shape rule cannot see', () => {
  it('passes sample 6 as written: its problem was the repeated c === "*", which no operator rule detects', () => {
    const linter = new Linter();
    const messages = linter.verify(SAMPLE_6_VERBATIM, {
      languageOptions: { parser: tsParser },
      plugins: { g06: { rules: { 'expression-shape': rule } } },
      rules: { 'g06/expression-shape': 'error' },
    });

    expect(messages).toEqual([]);
  });
});
