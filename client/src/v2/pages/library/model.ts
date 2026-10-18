import type { FleetMachine } from '@appydave/shared';
import type { LibraryItem } from '../../data/index.js';
import { realNames } from '../../kit/index.js';

export type LibKind = 'workflow' | 'agent' | 'rig' | 'skill' | 'context pack';
export type LibFilter = 'all' | LibKind;

export const LIB_FILTERS: { key: LibFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'agent', label: 'Agent' },
  { key: 'rig', label: 'Rig' },
  { key: 'context pack', label: 'Context pack' },
  { key: 'skill', label: 'Skill' },
];

/** The word the page uses for an item: a spec's own kind (workflow, agent, rig), else skill or context pack. */
export function kindOf(i: LibraryItem): LibKind | 'spec' {
  if (i.group === 'skill') return 'skill';
  if (i.group === 'context-pack') return 'context pack';
  const k = (i.kind ?? '').toLowerCase();
  return k === 'workflow' || k === 'agent' || k === 'rig' ? k : 'spec';
}

/** Items matching the kind chip and the search box (name, id, summary, machine). */
export function filterLibrary(
  items: LibraryItem[],
  filter: LibFilter,
  text: string
): LibraryItem[] {
  const q = text.trim().toLowerCase();
  return items.filter(
    (i) =>
      (filter === 'all' || kindOf(i) === filter) &&
      (!q || [i.name, i.id, i.summary ?? '', i.machine].some((s) => s.toLowerCase().includes(q)))
  );
}

export function countByKind(items: LibraryItem[]): Record<LibFilter, number> {
  const c: Record<LibFilter, number> = {
    all: items.length,
    workflow: 0,
    agent: 0,
    rig: 0,
    'context pack': 0,
    skill: 0,
  };
  for (const i of items) {
    const k = kindOf(i);
    if (k !== 'spec') c[k] += 1;
  }
  return c;
}

export const itemKey = (i: LibraryItem) => `${i.machine}:${i.group}:${i.id}`;

/** Made-up library rows with real rig, role and skill names, for when the library verb has no data. */
export function sampleLibrary(machines: FleetMachine[]): LibraryItem[] {
  const names = realNames(machines);
  const machine = machines[0]?.machine.id ?? 'm4';
  const rigs = [...new Set(names.rigs.map((r) => r.name))].slice(0, 3);
  const roles = [
    ...new Set(names.seats.map((s) => s.id.split('@')[0]!).filter((n) => n && n.length < 30)),
  ].slice(0, 4);
  const base = (over: Partial<LibraryItem> & Pick<LibraryItem, 'group' | 'id' | 'name'>) =>
    ({
      machine,
      kind: null,
      version: '1',
      sourceType: 'builtin',
      summary: null,
      path: null,
      updatedAt: null,
      facts: {},
      ...over,
    }) as LibraryItem;
  const items: LibraryItem[] = [
    ...['basic-loop', 'conveyor', 'gated-release', 'linear-build'].map((n, i) =>
      base({
        group: 'spec',
        kind: 'workflow',
        id: `workflow:${n}:1`,
        name: n,
        summary: `A built-in workflow: ${['a build, check and fix loop', 'a belt of steps handed along', 'a build that waits for a human gate', 'steps in a straight line'][i]}.`,
        path: `~/.openrig/specs/workflows/${n}.yaml`,
        facts: { rolesCount: 3 + (i % 2), stepsCount: 4 + i, targetRig: rigs[0] ?? null },
      })
    ),
    ...roles.map((r) =>
      base({
        group: 'spec',
        kind: 'agent',
        id: `agent:${r}:1`,
        name: r,
        summary: `The agent spec the ${r} seat starts from.`,
        path: `~/.openrig/specs/agents/${r}/agent.yaml`,
        facts: { model: 'opus', skills: 12 },
      })
    ),
    ...rigs.map((r) =>
      base({
        group: 'spec',
        kind: 'rig',
        id: `rig:${r}:1`,
        name: r,
        sourceType: 'user',
        summary: `The rig spec for ${r}: its pods, seats and edges.`,
        path: `~/dev/ad/brains/openrig/rigs/${r}/rig.yaml`,
        facts: { podCount: 2, seatCount: 4 },
      })
    ),
    ...['agent-browser', 'claude-code-reference', 'queue-handoff'].map((n) =>
      base({
        group: 'skill',
        id: `openrig-managed:process/${n}`,
        name: n,
        sourceType: 'openrig-managed',
        summary: `A skill OpenRig installs into seats (${n}).`,
        path: `~/.openrig/skills/process/${n}`,
        facts: { fileCount: 3, totalBytes: 9200 },
      })
    ),
    ...['appyrig-orientation', 'queue-etiquette'].map((n) =>
      base({
        group: 'context-pack',
        id: `context-pack:${n}:1`,
        name: n,
        summary: `A context pack seats read at start: ${n.replace(/-/g, ' ')}.`,
        path: `~/.openrig/context-packs/${n}`,
        facts: { taxonomy: 'orientation', manifestEstimatedTokens: 1800 },
      })
    ),
  ];
  return items;
}

export const sampleFiles = (i: LibraryItem) =>
  i.group === 'skill'
    ? [
        { name: 'SKILL.md', size: 4100 },
        { name: 'reference.md', size: 3900 },
        { name: 'examples.md', size: 1200 },
      ]
    : [];
