import { afterEach, describe, expect, it } from 'vitest';
import { removeScratch, scanProbe } from './scratchWorkspace.js';
// @ts-expect-error plain .mjs gate with no type declarations
import * as coupling from '@root/lint/gates/coupling.mjs';
// @ts-expect-error plain .mjs gate with no type declarations
import { adoptable, foreignSections } from '@root/lint/gates/ratchet-gate.mjs';

const { couplingMessage, hubMessage, scanDirectory, stabilityMessage } = coupling;

type Found = {
  coupling: Record<string, number>;
  hubs: Record<string, number>;
  stability: Record<string, number>;
};

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

/** Five modules import `stable`; the leaves are what `volatile` imports, so it imports five and is imported once. */
const stabilityWorld = (stableImports: string): Record<string, string> => ({
  ...leaves(5),
  ...Object.fromEntries(
    names(5, 100).map((n) => [
      `${n}.ts`,
      `import { stable } from './stable.js';\nexport const ${n} = stable;\n`,
    ])
  ),
  'volatile.ts': importer(5),
  'steady.ts': 'export const steady = 1;\n',
  'stable.ts': `${stableImports}\nexport const stable = 1;\n`,
});

describe('which imports the stability rule flags', () => {
  it('flags a stable module that imports a volatile one', () => {
    const found = scan(stabilityWorld("import { all } from './volatile.js';\nvoid all;"));

    expect(found.stability).toEqual({ 'probe/src/stable.ts -> probe/src/volatile.ts': 1 });
  });

  it('passes a stable module that imports another stable one, and one that imports nothing', () => {
    const importsStable = scan(
      stabilityWorld("import { steady } from './steady.js';\nvoid steady;")
    );
    const importsNothing = scan(stabilityWorld(''));

    expect(importsStable.stability).toEqual({});
    expect(importsNothing.stability).toEqual({});
  });

  it('does not flag a volatile module for importing stable ones', () => {
    const found = scan(stabilityWorld("import { all } from './volatile.js';\nvoid all;"));

    expect(
      Object.keys(found.stability).some((pair) => pair.startsWith('probe/src/volatile.ts'))
    ).toBe(false);
  });
});

describe('what the gate tells the agent', () => {
  it('says what to do about coupling, with the limit', () => {
    const text = couplingMessage({ file: 'client/src/x.ts', now: 25, was: 0 });

    expect(text).toContain('client/src/x.ts');
    expect(text).toContain('limit 20');
    expect(text).toContain('move that work into a module of their own');
  });

  it('names both files and what to do about a stability finding', () => {
    const text = stabilityMessage({ file: 'client/src/a.ts -> client/src/b.ts', now: 1, was: 0 });

    expect(text).toContain('client/src/a.ts depends on client/src/b.ts');
    expect(text).toContain('a module both import');
  });

  it('says what to do about a hub', () => {
    expect(hubMessage({ file: 'client/src/hub.ts', now: 16, was: 0 })).toContain(
      'import what they use directly'
    );
  });
});

describe('a rule new to a gate is adopted once, by name', () => {
  const sections = { coupling: 1, hubs: 1, stability: 1 };

  it('adopts a named section the baseline does not hold yet', () => {
    const saved = { about: 'x', coupling: {}, hubs: {} };

    expect(adoptable({ saved, sections, argv: ['--update', '--adopt=stability'] })).toEqual([
      'stability',
    ]);
  });

  it('never adopts a section the baseline already holds, so it cannot grow', () => {
    const saved = { about: 'x', coupling: {}, hubs: {}, stability: {} };

    expect(adoptable({ saved, sections, argv: ['--adopt=stability', '--adopt=coupling'] })).toEqual(
      []
    );
  });

  it('adopts nothing unless it is asked for by name, or for a section the gate does not have', () => {
    const saved = { about: 'x' };

    expect(adoptable({ saved, sections, argv: ['--update'] })).toEqual([]);
    expect(adoptable({ saved, sections, argv: ['--adopt=cycles'] })).toEqual([]);
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
