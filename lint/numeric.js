// G05: runtime numbers come from named constants. Mirrors Omer's lint/numeric-policy.ts (spaghetti-busters 104c7cc).
// Calibrated on AppyRig: 2 is allowed inline too (halving: `(a + b) / 2`), 0, 1 and -1 as in Omer's.
export const numericRules = {
  'no-magic-numbers': [
    'error',
    {
      ignore: [0, 1, -1, 2],
      detectObjects: true,
      enforceConst: true,
      ignoreEnums: true,
      ignoreNumericLiteralTypes: true,
    },
  ],
};
