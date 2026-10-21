// G06: complexity. Mirrors Omer's complexity policy (spaghetti-busters 3bfcf06 -> c9d9939 -> 176a8f0).
// Cyclomatic is SonarJS's rule, as in Omer's (a stricter-to-count subset of ESLint's core `complexity`).
// Calibrated on AppyRig as a ratchet (see the run record): cognitive 15 -> 12 -> 10 -> 8; cyclomatic 10 -> 8 -> 6; expression 3.
import sonarjs from 'eslint-plugin-sonarjs';

const MAX_COGNITIVE_COMPLEXITY = 8;
const MAX_CYCLOMATIC_COMPLEXITY = 6;
const MAX_EXPRESSION_COMPLEXITY = 3;

export const complexityPlugins = { sonarjs };

export const complexityRules = {
  'sonarjs/cognitive-complexity': ['error', MAX_COGNITIVE_COMPLEXITY],
  'sonarjs/cyclomatic-complexity': ['error', { threshold: MAX_CYCLOMATIC_COMPLEXITY }],
  'sonarjs/expression-complexity': ['error', { max: MAX_EXPRESSION_COMPLEXITY }],
};
