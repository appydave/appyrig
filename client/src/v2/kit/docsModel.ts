import type { LoadoutLayer, LoadoutSkill, RigFileMeta } from '@appydave/shared';

/**
 * The documents drawer, pure part: which files exist for one agent, grouped Agent · Rig · Mission,
 * one line each, no repeats. Nothing here reads a disk; it arranges what the read-only verbs
 * (`seat.loadout`, `rig.files`, `seat.detail`, `mission.file`) already sent.
 */
export type DocGroup = 'agent' | 'rig' | 'mission';
export const DOC_GROUPS: { id: DocGroup; label: string; about: string }[] = [
  { id: 'agent', label: 'Agent', about: 'what this agent is told' },
  { id: 'rig', label: 'Rig', about: "the team's own folder" },
  { id: 'mission', label: 'Mission', about: 'the mission folder' },
];

export type DocSource =
  | { kind: 'text'; text: string; truncated: boolean }
  | { kind: 'rig'; fileId: string }
  | { kind: 'mission'; path: string }
  /** Listed, but the hub does not send its text. */
  | { kind: 'unsent'; why: string }
  /** Looked for and not there. */
  | { kind: 'absent' };

export interface DocItem {
  key: string;
  group: DocGroup;
  name: string;
  /** One short line: size, or why it can't be read. */
  sub: string;
  present: boolean;
  source: DocSource;
}

export const LAYER_ORDER: LoadoutLayer['id'][] = [
  'role',
  'claude-md',
  'claude-local',
  'culture',
  'recap',
  'learned',
];

export const kb = (n: number | null): string =>
  n === null
    ? ''
    : n >= 10_240
      ? `${Math.round(n / 1024)} KB`
      : n >= 1024
        ? `${(n / 1024).toFixed(1)} KB`
        : `${n} B`;

export interface StartupRef {
  path: string;
  required: boolean | null;
}

export interface BuildDocsInput {
  layers: LoadoutLayer[];
  startup: StartupRef[];
  rigFiles: RigFileMeta[];
  /** Absolute or rig-relative paths served by `mission.file` (a job's spec, qa/…, shots/…). */
  missionPaths: string[];
}

const lc = (s: string) => s.toLowerCase();
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Agent first, then Rig, then Mission. A name that an earlier group already shows is not repeated. */
export function buildDocItems(i: BuildDocsInput): DocItem[] {
  const seen = new Set<string>();
  const out: DocItem[] = [];
  const add = (it: DocItem) => {
    const n = lc(it.name);
    if (seen.has(n)) return;
    seen.add(n);
    out.push(it);
  };
  const layers = [...i.layers].sort(
    (a, b) => LAYER_ORDER.indexOf(a.id) - LAYER_ORDER.indexOf(b.id)
  );
  for (const l of layers) {
    const there = l.present && l.content !== null;
    add({
      key: `agent:${l.id}`,
      group: 'agent',
      name: l.name,
      sub: there ? `${kb(l.bytes)}${l.truncated ? ' · cut' : ''}` : 'not present',
      present: there,
      source: there
        ? { kind: 'text', text: l.content ?? '', truncated: l.truncated }
        : { kind: 'absent' },
    });
  }
  for (const f of i.startup) {
    add({
      key: `agent:startup:${f.path}`,
      group: 'agent',
      name: base(f.path),
      sub: `startup · text not sent`,
      present: true,
      source: {
        kind: 'unsent',
        why: 'The hub lists this startup file but does not send its text.',
      },
    });
  }
  for (const f of i.rigFiles) {
    add({
      key: `rig:${f.id}`,
      group: f.scope === 'spec' ? 'rig' : 'mission',
      name: f.name,
      sub: `${kb(f.bytes)}${f.truncated ? ' · cut' : ''}`,
      present: true,
      source: { kind: 'rig', fileId: f.id },
    });
  }
  for (const p of i.missionPaths) {
    add({
      key: `mission:${p}`,
      group: 'mission',
      name: base(p),
      sub: p.startsWith('/') ? p : 'mission folder',
      present: true,
      source: { kind: 'mission', path: p },
    });
  }
  return out;
}

/** What to open first: the agent's role, else the mission, else the first readable file. */
export function firstDoc(items: DocItem[]): DocItem | null {
  return (
    items.find((x) => x.group === 'agent' && x.present && x.source.kind === 'text') ??
    items.find((x) => /^mission\.md$/i.test(x.name) && x.present) ??
    items.find((x) => x.present && x.source.kind !== 'unsent') ??
    items.find((x) => x.present) ??
    null
  );
}

export type DocKind = 'markdown' | 'yaml' | 'html' | 'image' | 'text';
export function docKind(name: string): DocKind {
  if (/\.ya?ml$/i.test(name)) return 'yaml';
  if (/\.html?$/i.test(name)) return 'html';
  if (/\.(png|jpe?g)$/i.test(name)) return 'image';
  if (/\.md$/i.test(name) || !/\.[a-z0-9]+$/i.test(name)) return 'markdown';
  return 'text';
}

// ---------------------------------------------------------------- skills

export interface SkillGroup {
  id: string;
  label: string;
  skills: LoadoutSkill[];
}

const SOURCE_LABEL: Record<LoadoutSkill['source'], string> = {
  role: "This team's own",
  repo: 'This repo',
  personal: 'Personal',
  plugin: 'Plugin',
  builtin: 'Built in',
  unplaced: 'Unplaced',
};

/** Plugin skills group by plugin; the rest group by where they live. Biggest group first, own skills on top. */
export function groupSkills(skills: LoadoutSkill[], query: string): SkillGroup[] {
  const q = lc(query.trim());
  const map = new Map<string, SkillGroup>();
  for (const s of skills) {
    if (q && !lc(s.name).includes(q) && !lc(s.plugin ?? '').includes(q)) continue;
    const id = s.source === 'plugin' ? `plugin:${s.plugin ?? '?'}` : s.source;
    const g = map.get(id) ?? {
      id,
      label: s.source === 'plugin' ? (s.plugin ?? 'plugin') : SOURCE_LABEL[s.source],
      skills: [],
    };
    g.skills.push(s);
    map.set(id, g);
  }
  const top = (g: SkillGroup) => (g.id === 'role' ? 0 : g.id === 'repo' ? 1 : 2);
  return [...map.values()]
    .map((g) => ({ ...g, skills: [...g.skills].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort(
      (a, b) =>
        top(a) - top(b) || b.skills.length - a.skills.length || a.label.localeCompare(b.label)
    );
}
