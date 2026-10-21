// G03: readable spacing. Mirrors Omer's lint/spacing.ts (spaghetti-busters 6b8b7f3).
// Spacing comes before the size limits, so "under 40 lines" can't be met by cramming code together.
export const spacingRules = {
  curly: ['error', 'all'],
  'no-sequences': 'error',
  'one-var': ['error', 'never'],
  '@stylistic/max-statements-per-line': ['error', { max: 1 }],
  '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: false }],
  '@stylistic/lines-between-class-members': [
    'error',
    {
      enforce: [
        { blankLine: 'always', prev: 'method', next: '*' },
        { blankLine: 'always', prev: '*', next: 'method' },
      ],
    },
  ],
  '@stylistic/padding-line-between-statements': [
    'error',
    { blankLine: 'always', prev: 'import', next: '*' },
    { blankLine: 'any', prev: 'import', next: 'import' },
    { blankLine: 'always', prev: '*', next: 'return' },
    { blankLine: 'always', prev: '*', next: ['function', 'class'] },
    { blankLine: 'always', prev: ['function', 'class'], next: '*' },
  ],
};
