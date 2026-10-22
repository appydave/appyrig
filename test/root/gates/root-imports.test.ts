import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs codemod with no type declarations
import { convert, rewrite } from '@root/lint/root-imports-codemod.mjs';

const REPO = join(import.meta.dirname, '../../..');
const WORKSPACES = ['client', 'server', 'collector', 'shared'];
const paths = (file: string): Record<string, string[]> =>
  JSON.parse(readFileSync(join(REPO, file), 'utf8')).compilerOptions.paths;

describe('project aliases', () => {
  it('each workspace maps its alias to the same folder as the root tsconfig', () => {
    const root = paths('tsconfig.json');

    for (const ws of WORKSPACES) {
      const own = paths(`${ws}/tsconfig.json`)[`@${ws}/*`];

      expect(own, ws).toEqual(['./src/*']);
      expect(root[`@${ws}/*`], ws).toEqual([`./${ws}/src/*`]);
    }
  });
});

describe('the ../ codemod', () => {
  it('rewrites a ../ import to the alias of the same file, in every import form', () => {
    const text = [
      "import { a } from '../config/env.js';",
      "export * from '../config/env.js';",
      "const b = await import('../hub/x.js');",
      "const c = require('../hub/x.js');",
      "import './local.js';",
    ].join('\n');
    const { out, left } = convert({ importer: 'server/src/middleware/a.ts', text });

    expect(out).toBe(
      [
        "import { a } from '@server/config/env.js';",
        "export * from '@server/config/env.js';",
        "const b = await import('@server/hub/x.js');",
        "const c = require('@server/hub/x.js');",
        "import './local.js';",
      ].join('\n')
    );
    expect(left).toEqual([]);
  });

  it('gives root-level files the alias of the workspace or folder they reach', () => {
    expect(rewrite({ importer: 'scripts/gen-api.ts', spec: '../server/src/core/doors.js' })).toBe(
      '@server/core/doors.js'
    );
    expect(rewrite({ importer: 'e2e/shell/shell.spec.ts', spec: '../support/fleet' })).toBe(
      '@root/e2e/support/fleet'
    );
  });

  it('leaves a ../ that reaches into another workspace, where no alias applies', () => {
    expect(
      rewrite({ importer: 'client/src/app/a.ts', spec: '../../../server/src/x.js' })
    ).toBeNull();
  });
});
