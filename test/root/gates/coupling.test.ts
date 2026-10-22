import { afterEach, describe, expect, it } from 'vitest';
import { removeScratch, scanProbe } from './scratchWorkspace.js';
// @ts-expect-error plain .mjs gate with no type declarations
import { couplingMessage, hubMessage, scanDirectory } from '@root/lint/gates/coupling.mjs';
// @ts-expect-error plain .mjs gate with no type declarations
import { foreignSections } from '@root/lint/gates/ratchet-gate.mjs';

type Found = { coupling: Record<string, number>; hubs: Record<string, number> };

const scan = (files: Record<string, string>): Found => scanProbe(scanDirectory, files);

afterEach(removeScratch);

const names = (count: number, from = 0) => Array.from({ length: count }, (_, i) => `m${i + from}`);

/** `count` leaf modules, each exporting one constant. */
const leaves = (count: number, ext = 'ts', from = 0): Record<string, string> =>
  Object.fromEntries(names(count, from).map((n) => [`${n}.${ext}`, `export const ${n} = 1;\n`]));

/** A module that imports `count` of the leaves (specifiers end in `.js`, as the repo's do). */
const importer = (count: number, from = 0) =>
  `${names(count, from)
    .map((n) => `import { ${n} } from './${n}.js';`)
    .join('\n')}\nexport const all = [${names(count, from).join(', ')}];\n`;

describe('which files the coupling gate flags', () => {
  it('flags a module that depends on more than the limit', () => {
    const found = scan({ ...leaves(21), 'wide.ts': importer(21) });

    expect(found.coupling).toEqual({ 'probe/src/wide.ts': 21 });
  });

  it('passes a module at the limit and a normally connected one', () => {
    const found = scan({ ...leaves(20), 'wide.ts': importer(20), 'small.ts': importer(3) });

    expect(found.coupling).toEqual({});
  });

  it('counts imports of React files, which archlint cannot follow from a .js specifier', () => {
    const found = scan({ ...leaves(21, 'tsx'), 'wide.ts': importer(21) });

    expect(found.coupling).toEqual({ 'probe/src/wide.ts': 21 });
  });

  it('flags a pass-through hub: eight importers, eight imports, no logic', () => {
    const importers = Object.fromEntries(
      names(8, 100).map((n) => [
        `${n}.ts`,
        `import { all } from './hub.js';\nexport const ${n} = all;\n`,
      ])
    );
    const found = scan({ ...leaves(8), 'hub.ts': importer(8), ...importers });

    expect(found.hubs).toEqual({ 'probe/src/hub.ts': 16 });
    expect(found.coupling).toEqual({});
  });

  it('does not flag a module with many importers but few imports, or the reverse', () => {
    const importers = Object.fromEntries(
      names(8, 100).map((n) => [
        `${n}.ts`,
        `import { m0 } from './m0.js';\nexport const ${n} = m0;\n`,
      ])
    );
    const found = scan({ ...leaves(8), 'wide.ts': importer(8), ...importers });

    expect(found.hubs).toEqual({});
  });

  it('leaves out a types.ts, tests and vendored code', () => {
    const found = scan({
      ...leaves(21),
      'types.ts': importer(21),
      'wide.test.ts': importer(21),
      'test/wide.ts': importer(21),
      'core/vendor/wide.ts': importer(21),
    });

    expect(found.coupling).toEqual({});
  });

  it('fails the run, instead of reporting clean, when there is nothing to scan', () => {
    expect(() => scan({ 'notes.md': 'nothing' })).toThrow('no TypeScript files');
  });
});

describe('what the gate tells the agent', () => {
  it('says what to do about coupling, with the limit', () => {
    const text = couplingMessage({ file: 'client/src/x.ts', now: 25, was: 0 });

    expect(text).toContain('client/src/x.ts');
    expect(text).toContain('limit 20');
    expect(text).toContain('move that work into a module of their own');
  });

  it('says what to do about a hub', () => {
    expect(hubMessage({ file: 'client/src/hub.ts', now: 16, was: 0 })).toContain(
      'import what they use directly'
    );
  });
});

describe('a baseline holds only the gate’s own rules', () => {
  it('finds a section the gate does not own', () => {
    const saved = { about: 'x', coupling: {}, hubs: {}, cycles: { 'a.ts': 1 } };

    expect(foreignSections({ saved, sections: { coupling: 1, hubs: 1 } })).toEqual(['cycles']);
  });

  it('accepts a baseline with only its own sections and its about line', () => {
    const saved = { about: 'x', coupling: {}, hubs: {} };

    expect(foreignSections({ saved, sections: { coupling: 1, hubs: 1 } })).toEqual([]);
  });
});
