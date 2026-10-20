import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SPEC_FOLDERS, RigSpecsPushSchema } from '@appydave/shared';
import { scanSpecs } from './specs.js';
import { RigSpecsReader, specEntryOf } from './rigspecs.js';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'appyrig-rigspecs-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const write = (file: string, text: string) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
};

/** A rig shaped like /Users/davidcruwys/dev/appyrigs/rigs/spaghetti: rigs/<name>/rig.yaml + agents/<name>/agent.yaml. */
const RIG = [
  'version: "0.2"',
  'name: spaghetti',
  'summary: >',
  '  Takes an app from spaghetti',
  '  to clean architecture.',
  'culture_file: CULTURE.md',
  'docs:',
  '  - path: README.md',
  'pods:',
  '  - id: orch',
  '    label: Orchestration',
  '    summary: Hands each gate to its desk.',
  '    members:',
  '      - { id: lead, agent_ref: "local:agents/spaghetti", profile: lead, runtime: claude-code, model: claude-opus-5-5, cwd: "." }',
  '  - id: gates',
  '    label: Gate desks',
  '    members:',
  '      - { id: shape, agent_ref: "local:agents/spaghetti", profile: shape, runtime: claude-code, cwd: "." }',
  '      - { id: odd, agent_ref: "local:../outside", profile: x, runtime: claude-code, cwd: "." }',
  '      - { id: term, agent_ref: "builtin:terminal", profile: none, runtime: terminal, cwd: "." }',
  '    edges:',
  '      - { kind: collaborates_with, from: shape, to: odd }',
  'edges:',
  '  - { kind: delegates_to, from: orch.lead, to: gates.shape }',
  '',
].join('\n');
const AGENT = [
  'name: spaghetti',
  'version: "1.0"',
  'description: >',
  '  A seat on the spaghetti rig.',
  'profiles:',
  '  lead:',
  '    summary: Hands each gate slice to its desk.',
  '    preferences: { runtime: claude-code, model: claude-opus-5-5 }',
  '  shape:',
  '    summary: "Desk, tier 2: spacing, size limits."',
  '',
].join('\n');

function rigFolder() {
  const root = tmp();
  const rigs = join(root, 'appyrigs', 'rigs');
  write(join(rigs, 'spaghetti', 'rig.yaml'), RIG);
  write(join(rigs, 'spaghetti', 'agents', 'spaghetti', 'agent.yaml'), AGENT);
  return { root, rigs };
}

describe('N9: rigs written outside the brains', () => {
  it('the default spec folders include /Users/davidcruwys/dev/appyrigs/rigs', () => {
    expect(DEFAULT_SPEC_FOLDERS).toContain('/Users/davidcruwys/dev/appyrigs/rigs');
  });

  it('rigs/<name>/rig.yaml under a rigs folder is found, and its agents/ folder is not mistaken for a rig', async () => {
    const { rigs } = rigFolder();
    write(join(rigs, 'visuals', 'notes.md'), '# not a rig yet\n');
    const found = await scanSpecs([rigs]);
    expect([...found.keys()]).toEqual(['spaghetti']);
    expect(found.get('spaghetti')).toMatchObject({
      path: join(rigs, 'spaghetti', 'rig.yaml'),
      root: rigs,
    });
    expect(found.get('spaghetti')!.spec).not.toBeNull();
  });
});

describe('N10: a rig spec as the Rig specs page shows it', () => {
  it('carries pods with every member (session name, profile), pod and rig edges, rig-level fields', async () => {
    const { rigs } = rigFolder();
    const spec = (await scanSpecs([rigs])).get('spaghetti')!;
    const e = await specEntryOf('spaghetti', spec);
    expect(e).toMatchObject({
      name: 'spaghetti',
      specValid: true,
      summary: 'Takes an app from spaghetti to clean architecture.',
    });
    expect(e.pods!.map((p) => [p.id, p.label, p.members])).toEqual([
      ['orch', 'Orchestration', ['lead']],
      ['gates', 'Gate desks', ['shape', 'odd', 'term']],
    ]);
    expect(e.pods![0]!.seats[0]).toMatchObject({
      id: 'lead',
      pod: 'orch',
      session: 'orch-lead@spaghetti',
      profile: 'lead',
      agent_ref: 'local:agents/spaghetti',
      model: 'claude-opus-5-5',
    });
    expect(e.pods![1]!.edges).toEqual([{ kind: 'collaborates_with', from: 'shape', to: 'odd' }]);
    expect(e.specEdges).toEqual([{ kind: 'delegates_to', from: 'orch.lead', to: 'gates.shape' }]);
    expect(e.rigSpec).toMatchObject({ culture_file: 'CULTURE.md', docs: [{ path: 'README.md' }] });
    expect(
      RigSpecsPushSchema.safeParse({
        machineId: 'm4',
        collectedAt: new Date().toISOString(),
        specs: [e],
      }).success
    ).toBe(true);
  });

  it('reads each AgentSpec once, with its profiles; a ref that leaves the rig folder is refused, never read', async () => {
    const { rigs, root } = rigFolder();
    // a real agent.yaml just outside the rig folder: `local:../outside` must not read it
    write(join(rigs, 'outside', 'agent.yaml'), AGENT);
    const spec = (await scanSpecs([rigs])).get('spaghetti')!;
    const e = await specEntryOf('spaghetti', spec);
    const byRef = Object.fromEntries(e.agents!.map((a) => [a.ref, a]));
    expect(byRef['local:agents/spaghetti']).toMatchObject({
      status: 'ok',
      usedBy: ['orch.lead', 'gates.shape'],
      spec: { name: 'spaghetti', version: '1.0', description: 'A seat on the spaghetti rig.' },
    });
    expect(Object.keys(byRef['local:agents/spaghetti']!.spec!.profiles)).toEqual(['lead', 'shape']);
    expect(byRef['local:../outside']).toMatchObject({ status: 'refused', spec: null });
    expect(byRef['builtin:terminal']).toMatchObject({ status: 'builtin', spec: null });

    // a symlinked agents folder that leads out of the rig folder: refused
    const away = join(root, 'elsewhere');
    write(join(away, 'agent.yaml'), AGENT);
    rmSync(join(rigs, 'spaghetti', 'agents', 'spaghetti'), { recursive: true });
    symlinkSync(away, join(rigs, 'spaghetti', 'agents', 'spaghetti'));
    const e2 = await specEntryOf('spaghetti', spec);
    expect(e2.agents!.find((a) => a.ref === 'local:agents/spaghetti')).toMatchObject({
      status: 'refused',
      spec: null,
    });
    // and gone altogether: missing
    unlinkSync(join(rigs, 'spaghetti', 'agents', 'spaghetti'));
    const e3 = await specEntryOf('spaghetti', spec);
    expect(e3.agents!.find((a) => a.ref === 'local:agents/spaghetti')!.status).toBe('missing');
  });

  it('a rig.yaml OpenRig would refuse is listed, flagged, and carries no pods', async () => {
    const d = tmp();
    write(join(d, 'bad', 'rig.yaml'), 'version: "0.2"\nname: bad\nsummary: half written\n');
    const e = await specEntryOf('bad', (await scanSpecs([d])).get('bad')!);
    expect(e).toEqual({
      name: 'bad',
      specPath: join(d, 'bad', 'rig.yaml'),
      summary: 'half written',
      specValid: false,
    });
  });

  it('the reader sends when something changed, and not again until it does', async () => {
    const { rigs } = rigFolder();
    const reader = new RigSpecsReader('m4', () => new Date('2026-10-20T00:00:00Z'));
    const first = await reader.next(await scanSpecs([rigs]));
    expect(first!.push.specs.map((s) => s.name)).toEqual(['spaghetti']);
    first!.markSent();
    expect(await reader.next(await scanSpecs([rigs]))).toBeNull();
    write(join(rigs, 'visuals', 'rig.yaml'), RIG.replace('name: spaghetti', 'name: visuals'));
    const second = await reader.next(await scanSpecs([rigs]));
    expect(second!.push.specs.map((s) => s.name).sort()).toEqual(['spaghetti', 'visuals']);
    reader.reset();
    second!.markSent();
    reader.reset();
    expect(await reader.next(await scanSpecs([rigs]))).not.toBeNull();
  });
});
