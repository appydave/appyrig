import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM config with no types
import eslint from '@root/eslint.config.js';
import oxlint from '@root/oxlint.config';
// @ts-expect-error CommonJS config with no types
import depcruise from '@root/.dependency-cruiser.cjs';
// @ts-expect-error CommonJS config with no types
import depcruiseFolders from '@root/.dependency-cruiser-folders.cjs';
// @ts-expect-error plain ESM script with no types
import { collect, problems, render } from '@root/scripts/gates-doc/exemptions.mjs';
// @ts-expect-error plain ESM script with no types
import { REASONS } from '@root/scripts/gates-doc/reasons.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SOURCES = [
  'eslint',
  'knip',
  'jscpd',
  'tsconfig',
  'vitest',
  'prettier',
  'oxlint',
  'depcruise',
  'depcruise-folders',
  'folder-limits',
  'test-trust',
];

interface Entry {
  key: string;
  source: string;
  where: string;
  kind: string;
  pattern: string;
}
type Reasons = Record<string, string>;
type Problems = { missing: string[]; stale: string[] };

const entries: Entry[] = collect(ROOT, { eslint, oxlint, depcruise, depcruiseFolders });
const reasons: Reasons = REASONS;
const check: (e: Entry[], r: Reasons) => Problems = problems;
const draw: (e: Entry[], r: Reasons) => string = render;

describe('Feature: docs/gates.md lists every exemption in the configs, each with a reason', () => {
  it.each(SOURCES)(
    'Scenario: given the %s config, then at least one exemption is read from it',
    (source) => {
      expect(entries.some((e) => e.source === source)).toBe(true);
    }
  );

  it('Scenario: given the configs, then every exemption has a reason', () => {
    expect(
      check(entries, reasons).missing,
      'These exemptions have no entry in scripts/gates-doc/reasons.mjs. Add the reason, or "reason unknown: <how to find out>"; do not invent one.'
    ).toEqual([]);
  });

  it('Scenario: given the reasons, then none names an exemption that is gone', () => {
    expect(
      check(entries, reasons).stale,
      'These reasons name an exemption no config has any more. Delete them from scripts/gates-doc/reasons.mjs.'
    ).toEqual([]);
  });

  it('Scenario: given the configs, then docs/gates.md is what npm run docs:gates writes', () => {
    expect(
      readFileSync(join(ROOT, 'docs/gates.md'), 'utf8'),
      'docs/gates.md is stale. Run npm run docs:gates and commit the result.'
    ).toBe(draw(entries, reasons));
  });
});

describe('Feature: the checks fail on a deliberately bad example', () => {
  const one: Entry = {
    key: 'eslint|ignore|x/**',
    source: 'eslint',
    where: '',
    kind: 'ignore',
    pattern: 'x/**',
  };

  it('Scenario: given an exemption with no reason, then it is reported missing', () => {
    expect(check([one], {}).missing).toEqual([one.key]);
  });

  it('Scenario: given a reason for an exemption that is gone, then it is reported stale', () => {
    expect(check([], { [one.key]: 'why' }).stale).toEqual([one.key]);
  });

  it('Scenario: given a changed reason, then the rendered text differs', () => {
    expect(draw([one], { [one.key]: 'a' })).not.toBe(draw([one], { [one.key]: 'b' }));
  });

  it('Scenario: given an exemption with a reason, then both are in the rendered text', () => {
    const text = draw([one], { [one.key]: 'because' });

    expect(text).toContain('`x/**`');
    expect(text).toContain('because');
  });
});

describe('Feature: a new tsconfig or vitest config cannot sit outside the list unseen', () => {
  // Tracked configs that have no exclude or coverage exclude to list.
  const EXEMPTION_FREE = ['tsconfig.json', 'test/root/vitest.config.ts'];
  const tracked = execFileSync('git', ['ls-files', '*tsconfig*.json', '*vitest.config.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);

  it('Scenario: given the tracked tsconfigs and vitest configs, then each is listed or named exemption-free', () => {
    const known = new Set([...entries.map((e) => e.where), ...EXEMPTION_FREE]);

    expect(
      tracked.filter((file) => !known.has(file)),
      'These configs are not read by scripts/gates-doc/files.mjs. Add each to TSCONFIGS or VITEST_CONFIGS there, or to EXEMPTION_FREE in this test if it excludes nothing.'
    ).toEqual([]);
  });
});
