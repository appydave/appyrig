// G06: complexity. Cognitive and cyclomatic mirror Omer's complexity policy (spaghetti-busters 3bfcf06 -> c9d9939 -> 176a8f0).
// Cyclomatic is SonarJS's rule, as in Omer's (a stricter-to-count subset of ESLint's core `complexity`).
// Calibrated on AppyRig as a ratchet (see the run record): cognitive 15 -> 12 -> 10 -> 8; cyclomatic 10 -> 8 -> 6.
// Expressions: g06/expression-shape (lint/expression-shape.js), David's ruling of 12 Nov 2026, in place of
// sonarjs/expression-complexity (max 3). A flat && or || chain and JSX conditional markup are fine; a ternary
// inside another expression, and && mixed with || on one line without brackets, are flagged.
import sonarjs from 'eslint-plugin-sonarjs';
import { expressionShape } from './expression-shape.js';

const MAX_COGNITIVE_COMPLEXITY = 8;
const MAX_CYCLOMATIC_COMPLEXITY = 6;

// SonarJS encodes this rule's message as JSON for SonarLint ({"message":..., "cost":..., "secondaryLocations":[...]}).
// Unwrap it so the lint output (the next agent's prompt) is one plain sentence. The rule id is unchanged.
const cyclomatic = sonarjs.rules['cyclomatic-complexity'];
const plainCyclomatic = {
  ...cyclomatic,
  create(context) {
    const report = (descriptor) => {
      const message = typeof descriptor.message === 'string' ? descriptor.message : '';
      let plain = message;

      try {
        plain = JSON.parse(message).message ?? message;
      } catch {
        // Not encoded: report as is.
      }

      context.report({ ...descriptor, message: plain });
    };

    return cyclomatic.create(Object.create(context, { report: { value: report } }));
  },
};

export const complexityPlugins = {
  sonarjs: { ...sonarjs, rules: { ...sonarjs.rules, 'cyclomatic-complexity': plainCyclomatic } },
  g06: { rules: { 'expression-shape': expressionShape } },
};

export const complexityRules = {
  'sonarjs/cognitive-complexity': ['error', MAX_COGNITIVE_COMPLEXITY],
  'sonarjs/cyclomatic-complexity': ['error', { threshold: MAX_CYCLOMATIC_COMPLEXITY }],
  'g06/expression-shape': 'error',
};
