// G10: root imports. Mirrors Omer's lint/import-policy.ts (spaghetti-busters 76afd84), retargeted to
// AppyRig's aliases. `./` stays allowed (same folder); `../` is banned in every import form.
// The aliases live in tsconfig `paths` (root tsconfig.json for scripts, tests and e2e).
const message =
  "Import with a project alias instead of '../': @client/… (client/src), @server/… (server/src), @collector/… (collector/src), @shared/… (shared/src), @root/… (scripts, test, e2e, lint).";
const staticMessage =
  'Use a literal import path so project-root imports can be checked statically.';
const UP = '^\\.\\.[/]';

/** The static forms (`import`, `export … from`) go to ESLint's own `no-restricted-imports`. */
export const importRules = {
  'no-restricted-imports': ['error', { patterns: [{ regex: '^\\.\\./', message }] }],
};

/** The forms `no-restricted-imports` skips: import(), import types, require(), and computed paths. */
export const importSelectors = [
  { selector: `ImportExpression[source.value=/${UP}/]`, message },
  { selector: `TSImportType[argument.literal.value=/${UP}/]`, message },
  { selector: `CallExpression[callee.name='require'][arguments.0.value=/${UP}/]`, message },
  {
    selector:
      ":matches(ImportExpression:not([source.type='Literal']), CallExpression[callee.name='require']:not([arguments.0.type='Literal']))",
    message: staticMessage,
  },
];
