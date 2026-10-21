import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import { parse } from 'yaml';
import {
  OpenRig,
  MEMBER_ENV_NAMES_MAX,
  POD_MEMBERS_MAX,
  RIG_EDGES_MAX,
  RIG_PODS_MAX,
  RIG_SPECS_MAX,
  RIG_SPEC_AGENTS_MAX,
  RIG_SUMMARY_MAX,
  type RigSpecEntry,
  type RigSpecsPush,
  type SpecAgent,
  type SpecPod,
  type SpecSeat,
} from '@appydave/shared';
import { redactDeep, redactString } from '../redact.js';
import type { SpecInfo } from './specs.js';
import { podOf, rigSpecOf } from './specView.js';

/**
 * N10: every rig spec found in the configured spec folders, launched or not, as the Rig specs page
 * shows it: the rig, its pods with their members in full, the edges, and the AgentSpecs the members
 * point at. Read-only. An AgentSpec is read only when its agent.yaml's REAL path stays inside the
 * rig's folder (`local:`) or the configured spec folder (`path:`); anything else is `refused`, never
 * read.
 */

const isUnder = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/** Where an agent_ref's agent.yaml would be, and the folder it must stay inside. */
function agentPlace(ref: string, spec: SpecInfo): { file: string; within: string } | null {
  if (ref.startsWith('local:')) {
    const rel = ref.slice('local:'.length).trim();

    if (!rel || isAbsolute(rel) || normalize(rel).split(sep).includes('..')) {
      return null;
    }

    const rigRoot = dirname(spec.path);

    return { file: join(rigRoot, rel, 'agent.yaml'), within: rigRoot };
  }

  if (ref.startsWith('path:')) {
    const abs = ref.slice('path:'.length).trim();

    if (!isAbsolute(abs)) {
      return null;
    }

    return { file: join(abs, 'agent.yaml'), within: spec.root };
  }

  return null;
}

/** Most bytes of an agent.yaml read. */
const AGENT_YAML_MAX = 256 * 1024;

export async function readSpecAgent(
  ref: string,
  spec: SpecInfo,
  usedBy: string[]
): Promise<SpecAgent> {
  const base = { ref: redactString(ref).slice(0, 500), usedBy: usedBy.slice(0, 200) };

  if (ref === 'builtin:terminal') {
    return { ...base, status: 'builtin', spec: null };
  }

  const place = agentPlace(ref, spec);

  if (!place) {
    return { ...base, status: 'refused', spec: null };
  }

  let real: string;
  let within: string;

  try {
    within = await realpath(place.within);
  } catch {
    return { ...base, status: 'missing', spec: null };
  }

  try {
    real = await realpath(place.file);
  } catch {
    // Not there. Say "missing" only when the place itself was allowed.
    return {
      ...base,
      status: isUnder(place.file, place.within) ? 'missing' : 'refused',
      spec: null,
    };
  }

  if (!isUnder(real, within)) {
    return { ...base, status: 'refused', spec: null };
  }

  try {
    const st = await lstat(real);

    if (!st.isFile() || st.size > AGENT_YAML_MAX) {
      return { ...base, status: 'invalid', spec: null };
    }

    const parsed = OpenRig.AgentSpecSchema.safeParse(parse(await readFile(real, 'utf8')));

    if (!parsed.success) {
      return { ...base, status: 'invalid', spec: null };
    }

    const { name, version, description, summary, defaults, profiles } = parsed.data;
    const view: NonNullable<SpecAgent['spec']> = { name, version, profiles: profiles ?? {} };

    if (description !== undefined) {
      view.description = description.replace(/\s+/g, ' ').trim();
    }

    if (summary !== undefined) {
      view.summary = summary.replace(/\s+/g, ' ').trim();
    }

    if (defaults !== undefined) {
      view.defaults = defaults;
    }

    return { ...base, status: 'ok', spec: redactDeep(view) };
  } catch {
    return { ...base, status: 'invalid', spec: null };
  }
}

function seatOf(rig: string, pod: OpenRig.PodSpec, m: OpenRig.MemberSpec): SpecSeat {
  const { env, ...rest } = m;
  const out: SpecSeat = {
    ...redactDeep(rest),
    pod: pod.id,
    session: OpenRig.sessionName(rig, pod.id, m.id),
  };

  if (env) {
    out.envNames = Object.keys(env).slice(0, MEMBER_ENV_NAMES_MAX);
  }

  return out;
}

/** One spec as the Rig specs page shows it. */
export async function specEntryOf(name: string, spec: SpecInfo): Promise<RigSpecEntry> {
  const entry: RigSpecEntry = {
    name,
    specPath: spec.path,
    summary: spec.summary ? spec.summary.slice(0, RIG_SUMMARY_MAX) : null,
    specValid: spec.spec !== null,
  };
  const s = spec.spec;

  if (!s) {
    return entry;
  }

  entry.pods = s.pods.slice(0, RIG_PODS_MAX).map((p): SpecPod => ({
    ...podOf(p),
    seats: p.members.slice(0, POD_MEMBERS_MAX).map((m) => seatOf(name, p, m)),
  }));
  entry.specEdges = (s.edges ?? []).slice(0, RIG_EDGES_MAX);
  entry.rigSpec = rigSpecOf(s);

  // Each agent_ref once, in the order members first use it.
  const refs = new Map<string, string[]>();

  for (const p of s.pods) {
    for (const m of p.members) {
      const users = refs.get(m.agent_ref) ?? [];

      users.push(OpenRig.logicalId(p.id, m.id));
      refs.set(m.agent_ref, users);
    }
  }

  entry.agents = [];
  for (const [ref, users] of [...refs].slice(0, RIG_SPEC_AGENTS_MAX)) {
    entry.agents.push(await readSpecAgent(ref, spec, users));
  }

  return entry;
}

export interface PendingRigSpecs {
  push: RigSpecsPush;
  markSent(): void;
}

/**
 * Sends the machine's rig specs when they changed since the hub last accepted them. The scan itself
 * is the spec index's (cached), so a call is a few small file reads.
 */
export class RigSpecsReader {
  private sent: string | null = null;

  constructor(
    private readonly machineId: string,
    private readonly now: () => Date = () => new Date()
  ) {}

  reset(): void {
    this.sent = null;
  }

  async next(specs: Map<string, SpecInfo>): Promise<PendingRigSpecs | null> {
    const entries: RigSpecEntry[] = [];

    for (const [name, spec] of [...specs].slice(0, RIG_SPECS_MAX)) {
      entries.push(await specEntryOf(name, spec));
    }

    const sig = JSON.stringify(entries);

    if (sig === this.sent) {
      return null;
    }

    return {
      push: { machineId: this.machineId, collectedAt: this.now().toISOString(), specs: entries },
      markSent: () => {
        this.sent = sig;
      },
    };
  }
}
