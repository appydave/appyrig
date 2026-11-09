import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
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

const REPO = join(import.meta.dirname, '../../..');

/** Runs the real depcruise with the real config over a scratch `client/src/probe.ts`; returns its error lines. */
function cruiseProbe(imports: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'dc-probe-'));

  try {
    mkdirSync(join(dir, 'client/src'), { recursive: true });
    symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'));
    writeFileSync(join(dir, 'tsconfig.json'), '{"compilerOptions":{"moduleResolution":"bundler"}}');
    writeFileSync(
      join(dir, 'client/package.json'),
      JSON.stringify({
        name: 'p',
        devDependencies: Object.fromEntries(imports.map((i) => [i, '*'])),
      })
    );
    writeFileSync(
      join(dir, 'client/src/probe.ts'),
      `${imports.map((i) => `import '${i}';`).join('\n')}\nexport {};\n`
    );

    try {
      execFileSync(
        join(REPO, 'node_modules/.bin/depcruise'),
        ['client/src', '--config', join(REPO, '.dependency-cruiser.cjs'), '--output-type', 'err'],
        { cwd: dir, encoding: 'utf8', stdio: 'pipe' }
      );

      return '';
    } catch (e) {
      return String((e as { stdout?: string }).stdout);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('not-to-dev-dep sees the test tools', () => {
  it.each(['vitest', '@testing-library/react', 'jsdom'])(
    'a production file importing %s fails the rule',
    (pkg) => {
      expect(cruiseProbe([pkg])).toContain(`not-to-dev-dep: client/src/probe.ts`);
    },
    30_000
  );
});
