import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs gate with no type declarations
import { cycleMessage, parentCycles } from '@root/lint/gates/parent-cycles.mjs';
// @ts-expect-error plain .mjs gate with no type declarations
import { compare } from '@root/lint/gates/ratchet-gate.mjs';

type Dependency = { resolved: string; dynamic?: boolean };

const baseline: Record<string, number> = JSON.parse(
  readFileSync(new URL('../../../../parent-cycles-baseline.json', import.meta.url), 'utf8')
).cycles;

/** depcruise modules: one file in each folder of each `a -> b` edge, importing a file in the other. */
function modules(edges: string[], dynamic = false) {
  return edges.map((edge) => {
    const [from, to] = edge.split(' -> ');
    const dependencies: Dependency[] = [{ resolved: `${to}/x.ts`, dynamic }];

    return { source: `${from}/a.ts`, dependencies };
  });
}

/** Both import edges of each baselined pair: today's five cycles, as depcruise would report them. */
const todaysEdges = Object.keys(baseline).flatMap((pair) => {
  const [parent, child] = pair.split(' <-> ');

  return [`${parent} -> ${child}`, `${child} -> ${parent}`];
});

describe('parent/child folder cycles', () => {
  it('holds the five cycles found on main when the gate was added', () => {
    expect(Object.keys(baseline)).toHaveLength(5);
  });

  it('passes the baselined five', () => {
    expect(compare(parentCycles(modules(todaysEdges)), baseline)).toEqual({
      grown: [],
      shrunk: [],
    });
  });

  it('fails a new child that imports its parent', () => {
    const edges = [...todaysEdges, 'server/src -> server/src/hub', 'server/src/hub -> server/src'];
    const { grown } = compare(parentCycles(modules(edges)), baseline);

    expect(grown).toEqual([{ file: 'server/src <-> server/src/hub', now: 1, was: 0 }]);
    expect(cycleMessage(grown[0])).toContain(
      'server/src and its subfolder server/src/hub import each other'
    );
  });

  it('counts a grandchild, and ignores one-way, sibling, dynamic and out-of-src imports', () => {
    expect(
      parentCycles(
        modules(['client/src/a -> client/src/a/b/c', 'client/src/a/b/c -> client/src/a'])
      )
    ).toEqual({ 'client/src/a <-> client/src/a/b/c': 1 });
    expect(parentCycles(modules(['client/src/a -> client/src/a/b']))).toEqual({});
    expect(
      parentCycles(modules(['client/src/a -> client/src/b', 'client/src/b -> client/src/a']))
    ).toEqual({});
    expect(
      parentCycles(
        modules(['client/src/a -> client/src/a/b', 'client/src/a/b -> client/src/a'], true)
      )
    ).toEqual({});
    expect(
      parentCycles(modules(['client/src -> node_modules/x', 'node_modules/x -> client/src']))
    ).toEqual({});
  });

  it('passes on the real repo: today it finds exactly the baselined cycles', () => {
    const run = spawnSync('node', ['lint/gates/parent-cycles.mjs'], { encoding: 'utf8' });

    expect(run.stderr).toBe('');
    expect(run.stdout).toContain('parent-cycles: ok (5 cycles at their baseline)');
    expect(run.status).toBe(0);
  });
});
