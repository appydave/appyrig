import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Rule = { name: string; severity: string; to: { reachable?: boolean } };

const config = createRequire(import.meta.url)(
  join(import.meta.dirname, '../../../.dependency-cruiser.cjs')
);
const rules: Rule[] = config.forbidden;
const byName = (name: string) => rules.find((r) => r.name === name);
const LAYER_RULES = [
  'client-not-server-or-collector',
  'collector-not-server-or-client',
  'server-not-client-or-collector',
  'shared-imports-nothing-local',
  'client-domain-has-no-ui',
  'client-kit-has-no-screens',
  'client-lib-is-a-leaf',
  'client-shell-below-pages',
  'collector-adapters-below-orchestration',
];

describe('boundary rules', () => {
  it.each(LAYER_RULES)('%s also forbids reaching the layer through another module', (name) => {
    expect(byName(name)?.to.reachable).toBe(true);
  });

  it.each(['not-to-dev-dep', 'not-to-spec', 'no-deprecated-core', 'no-circular'])(
    '%s is present',
    (name) => {
      expect(byName(name)).toBeDefined();
    }
  );

  it('has no rule that only warns', () => {
    expect(rules.filter((r) => r.severity !== 'error').map((r) => r.name)).toEqual([]);
  });

  it('keeps npm packages in the graph, or not-to-dev-dep has nothing to look at', () => {
    expect(config.options.exclude.path).not.toContain('node_modules');
  });
});
