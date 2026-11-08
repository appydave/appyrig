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
});
