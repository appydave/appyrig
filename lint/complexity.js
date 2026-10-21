// G06: complexity. Mirrors Omer's complexity policy (spaghetti-busters 3bfcf06 -> c9d9939 -> 176a8f0).
// Calibrated on AppyRig as a ratchet (see the run record): cognitive 15 -> 12 -> 10 -> 8; cyclomatic 10 -> 8 -> 6.
import sonarjs from 'eslint-plugin-sonarjs';

const MAX_COGNITIVE_COMPLEXITY = 8;
const MAX_CYCLOMATIC_COMPLEXITY = 6;

export const complexityPlugins = { sonarjs };

export const complexityRules = {
  'sonarjs/cognitive-complexity': ['error', MAX_COGNITIVE_COMPLEXITY],
  complexity: ['error', { max: MAX_CYCLOMATIC_COMPLEXITY }],
};
