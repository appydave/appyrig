import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { OpenRig } from '../../shared/src/index.js';

/**
 * The shared OpenRig schemas against OpenRig's own files: every rig.yaml and agent.yaml shipped in
 * @openrig/cli 0.6.11 (`daemon/specs/`, Apache-2.0, copied into fixtures/openrig-0.6.11/specs) and
 * d09-crew's rig.yaml. A schema that refuses a real OpenRig file is wrong, not the file.
 */

const FX = new URL('./fixtures/openrig-0.6.11/', import.meta.url).pathname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(FX);
const rigFiles = files.filter((f) => /\/rig[^/]*\.yaml$/.test(f));
const agentFiles = files.filter((f) => f.endsWith('/agent.yaml'));
const load = (f: string) => parse(readFileSync(f, 'utf8')) as unknown;
const why = (r: { success: boolean; error?: { issues: unknown } }) =>
  r.success ? '' : JSON.stringify(r.error?.issues).slice(0, 400);

describe('OpenRig RigSpec (rig.yaml)', () => {
  it('has the shipped rigs and d09-crew to check against', () => {
    expect(rigFiles.length).toBeGreaterThanOrEqual(10);
  });

  it.each(rigFiles.map((f) => [f.slice(FX.length), f]))('accepts %s', (_name, f) => {
    const r = OpenRig.RigSpecSchema.safeParse(load(f));
    expect(r.success, why(r)).toBe(true);
  });

  it('reads d09-crew as two pods, three seats, culture and managed blocks', () => {
    const rig = OpenRig.RigSpecSchema.parse(load(join(FX, 'd09-crew/rig.yaml')));
    expect(rig.name).toBe('d09-crew');
    expect(rig.culture_file).toBe('CULTURE.md');
    expect(rig.managed_blocks?.['claude-code']).toBe('CLAUDE.local.md');
    expect(rig.pods.map((p) => [p.id, p.label, p.members.map((m) => m.id)])).toEqual([
      ['dev', 'Development', ['build', 'qa']],
      ['review', 'Review', ['r1']],
    ]);
    expect(rig.pods[0]!.members[0]!.startup?.files?.[0]?.path).toBe('guidance/build-first-move.md');
    expect(rig.edges?.map((e) => `${e.from} ${e.kind} ${e.to}`)).toEqual([
      'dev.build delegates_to review.r1',
      'review.r1 can_observe dev.build',
    ]);
    expect(OpenRig.sessionName(rig.name, 'dev', 'build')).toBe('dev-build@d09-crew');
    expect(OpenRig.logicalId('dev', 'build')).toBe('dev.build');
  });

  it('refuses an unknown key at rig, pod and member level, as OpenRig does', () => {
    const base = load(join(FX, 'd09-crew/rig.yaml')) as Record<string, unknown> & {
      pods: Record<string, unknown>[];
    };
    expect(OpenRig.RigSpecSchema.safeParse({ ...base, mission: 'MISSION.md' }).success).toBe(false);
    const pod = { ...base.pods[0]!, jobs: [] };
    expect(OpenRig.RigSpecSchema.safeParse({ ...base, pods: [pod] }).success).toBe(false);
    const members = (base.pods[0]!.members as Record<string, unknown>[]).map((m) => ({
      ...m,
      shots: 'shots/',
    }));
    expect(
      OpenRig.RigSpecSchema.safeParse({ ...base, pods: [{ ...base.pods[0]!, members }] }).success
    ).toBe(false);
  });

  it('refuses an unknown edge kind and a qualified id inside a pod', () => {
    expect(OpenRig.PodEdgeSchema.safeParse({ kind: 'reviews', from: 'a', to: 'b' }).success).toBe(
      false
    );
    expect(
      OpenRig.CrossPodEdgeSchema.safeParse({ kind: 'delegates_to', from: 'a', to: 'b' }).success
    ).toBe(false);
  });
});

describe('OpenRig AgentSpec (agent.yaml)', () => {
  it.each(agentFiles.map((f) => [f.slice(FX.length), f]))('accepts %s', (_name, f) => {
    const r = OpenRig.AgentSpecSchema.safeParse(load(f));
    expect(r.success, why(r)).toBe(true);
  });

  it('the implementer gets its role from guidance/role.md, delivered as send_text', () => {
    const a = OpenRig.AgentSpecSchema.parse(
      load(join(FX, 'specs/agents/development/implementer/agent.yaml'))
    );
    expect(a.startup?.files?.[0]).toMatchObject({
      path: 'guidance/role.md',
      delivery_hint: 'send_text',
    });
    expect(a.profiles?.default?.uses?.skills).toContain('development-team');
  });
});

describe('the chain-file trees', () => {
  it('places rig, pod and seat nodes under topology.root, seats beside pods', () => {
    expect(OpenRig.topologyTrace('d09-crew', 'dev', 'build').map(OpenRig.topologyDir)).toEqual([
      '',
      'rigs/d09-crew',
      'rigs/d09-crew/pods/dev',
      'rigs/d09-crew/seats/build',
    ]);
    expect(OpenRig.topologyTrace('d09-crew', null, null)).toHaveLength(2);
  });

  it('keeps OpenRig startup layers and built-in files in their order', () => {
    expect(OpenRig.STARTUP_LAYERS[0]).toBe('agent');
    expect(OpenRig.STARTUP_LAYERS.at(-1)).toBe('operator');
    expect(OpenRig.BUILTIN_STARTUP_FILES).toContain('openrig-start.md');
  });

  it('reads a slice SPEC frontmatter and mission.yaml waves loosely', () => {
    const fm = OpenRig.SliceSpecFrontmatterSchema.parse({
      id: 'CUS.1',
      status: 'active',
      depends_on: [],
      owner: 'anyone',
    });
    expect(fm.depends_on).toEqual([]);
    const m = OpenRig.MissionYamlSchema.parse({
      arrangement: { waves: [{ id: 'w1', slices: ['a', 'b'] }] },
    });
    expect(m.arrangement?.waves?.[0]?.slices).toEqual(['a', 'b']);
  });
});
