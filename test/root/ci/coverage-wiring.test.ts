import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (file: string): string => readFileSync(join(ROOT, file), 'utf8');
const WORKSPACES = ['server', 'client', 'collector'];

describe('Feature: every workspace with a coverage floor is measured in CI', () => {
  const ci = read('.github/workflows/ci.yml');
  const rootScripts = JSON.parse(read('package.json')).scripts as Record<string, string>;

  it('Scenario: given the CI workflow, then it runs npm run test:coverage', () => {
    expect(ci).toMatch(/run:\s*npm run test:coverage\s*$/m);
  });

  it.each(WORKSPACES)('Scenario: given the root test:coverage script, then it runs %s', (name) => {
    expect(rootScripts['test:coverage']).toMatch(new RegExp(`-w ${name}(\\s|$)`));
  });

  it.each(WORKSPACES)('Scenario: given %s, then it has a test:coverage script', (name) => {
    const scripts = JSON.parse(read(`${name}/package.json`)).scripts as Record<string, string>;

    expect(scripts['test:coverage']).toContain('--coverage');
  });

  it.each(['LINES', 'STATEMENTS', 'FUNCTIONS', 'BRANCHES'])(
    'Scenario: given the collector config, then the %s floor is a negative count (a maximum uncovered)',
    (measure) => {
      const config = read('collector/vitest.config.ts');

      expect(config).toMatch(new RegExp(`${measure.toLowerCase()}:\\s*-UNCOVERED_${measure}`));
      expect(config).toMatch(new RegExp(`const UNCOVERED_${measure} = \\d+;`));
    }
  );

  it.each([
    ['LINES', 319],
    ['STATEMENTS', 338],
    ['FUNCTIONS', 69],
    ['BRANCHES', 367],
  ])(
    'Scenario: given the collector config, then UNCOVERED_%s is pinned at %i',
    (measure, pinned) => {
      const config = read('collector/vitest.config.ts');

      // Lowering the floor is fine: edit this number and the config together. Raising it is a loosening
      // that the judge must withdraw; raising it here as well does not make it acceptable.
      expect(
        config,
        `UNCOVERED_${measure} is pinned at ${pinned} in this test. Added tests? Lower it here and in collector/vitest.config.ts in the same PR. Raising it loosens the coverage floor and needs the judge's ruling.`
      ).toContain(`const UNCOVERED_${measure} = ${pinned};`);
    }
  );

  it('Scenario: given the collector config, then coverage measures all of src except tests', () => {
    const config = read('collector/vitest.config.ts');

    expect(config).toContain("include: ['src/**/*.ts'],");
    expect(config).toContain("exclude: ['src/**/*.test.ts'],");
  });
});
