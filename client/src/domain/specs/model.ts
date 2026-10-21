import {
  OpenRig,
  commandNamesRig,
  type FleetMachine,
  type RigCommandsOutput,
  type RigSpecsOutput,
  type SpecAgent,
} from '@appydave/shared';

/**
 * N10: the Rig specs page's model. Every rig spec found on every machine, from the `rig.specs` verb
 * (the collector's spec scan, launched or not). A machine whose collector does not send that yet
 * still shows its LAUNCHED rigs, from the spec fields already in its snapshot (pods, edges, rig-level
 * fields), with less detail (no profiles, no AgentSpecs). Nothing here is made up.
 */

export type SpecState = 'draft' | 'running' | 'launched';

export interface ShownSeat {
  id: string;
  /** The session name OpenRig gives the seat (`orch-lead@spaghetti`). */
  session: string;
  /** The AgentSpec profile the member uses; null when this machine's collector did not say. */
  profile: string | null;
  agentRef: string | null;
  runtime: string | null;
  model: string | null;
}

export interface ShownEdge {
  kind: string;
  from: string;
  to: string;
}

export interface ShownPod {
  id: string;
  label: string;
  summary: string | null;
  seats: ShownSeat[];
  /** Pod-local edges, between bare member ids. */
  edges: ShownEdge[];
}

export interface ShownSpec {
  /** `machine:name`, the same key every other rig view uses. */
  key: string;
  machine: string;
  name: string;
  summary: string | null;
  specPath: string | null;
  specValid: boolean;
  state: SpecState;
  rigStatus: string | null;
  /**
   * The machine whose OpenRig runs (or knows) this rig: the spec's own machine when launched there,
   * else another one (a spec in a synced folder may be launched elsewhere). null for a draft.
   */
  liveMachine: string | null;
  pods: ShownPod[] | null;
  /** Cross-pod edges, `pod.member` → `pod.member`. */
  edges: ShownEdge[] | null;
  culture: string | null;
  docs: string[];
  /** null: this machine's collector does not send AgentSpecs yet. */
  agents: SpecAgent[] | null;
  /** Where the row came from: the spec scan, or the launched rig's own record (less detail). */
  source: 'spec-scan' | 'live-record';
}

const stateOf = (launched: boolean, rigStatus: string | null): SpecState =>
  !launched ? 'draft' : rigStatus === 'running' ? 'running' : 'launched';

/** Where the rig lives: its own machine if launched there, else the machine running it (else any that knows it). */
function liveOf(s: RigSpecsOutput['specs'][number]): {
  state: SpecState;
  rigStatus: string | null;
  liveMachine: string | null;
} {
  if (s.launched) {
    return { state: stateOf(true, s.rigStatus), rigStatus: s.rigStatus, liveMachine: s.machine };
  }
  // `launchedOn` is absent from an older hub's answer: then it is the spec's own machine or nothing.
  const on = s.launchedOn ?? [];
  const at = on.find((x) => x.status === 'running') ?? on[0];

  return at
    ? { state: stateOf(true, at.status), rigStatus: at.status, liveMachine: at.machine }
    : { state: 'draft', rigStatus: null, liveMachine: null };
}

/** Every rig spec to list: the spec scan where a machine sends it, else its launched rigs' records. */
export function shownSpecs(value: RigSpecsOutput | null, machines: FleetMachine[]): ShownSpec[] {
  const scanned = new Set(
    (value?.machines ?? []).filter((m) => m.status === 'ok').map((m) => m.machine)
  );
  const out: ShownSpec[] = [];
  for (const s of value?.specs ?? []) {
    if (!scanned.has(s.machine)) {
      continue;
    }
    out.push({
      key: `${s.machine}:${s.name}`,
      machine: s.machine,
      name: s.name,
      summary: s.summary,
      specPath: s.specPath,
      specValid: s.specValid,
      ...liveOf(s),
      pods:
        s.pods?.map((p) => ({
          id: p.id,
          label: p.label,
          summary: p.summary ?? null,
          edges: p.edges ?? [],
          seats: p.seats.map((m) => ({
            id: m.id,
            session: m.session,
            profile: m.profile,
            agentRef: m.agent_ref,
            runtime: m.runtime,
            model: m.model ?? null,
          })),
        })) ?? null,
      edges: s.specEdges ?? null,
      culture: s.rigSpec?.culture_file ?? null,
      docs: (s.rigSpec?.docs ?? []).map((d) => d.path),
      agents: s.agents ?? null,
      source: 'spec-scan',
    });
  }
  for (const fm of machines) {
    if (scanned.has(fm.machine.id)) {
      continue;
    }
    for (const rig of fm.snapshot.rigs) {
      if (rig.specStatus !== 'found') {
        continue;
      }
      const seats = fm.snapshot.seats.filter((s) => s.rig === rig.name);
      out.push({
        key: `${fm.machine.id}:${rig.name}`,
        machine: fm.machine.id,
        name: rig.name,
        summary: rig.summary ?? null,
        specPath: rig.specPath ?? null,
        specValid: rig.specValid ?? false,
        state: stateOf(true, rig.status),
        rigStatus: rig.status,
        liveMachine: fm.machine.id,
        pods:
          rig.pods?.map((p) => ({
            id: p.id,
            label: p.label,
            summary: p.summary ?? null,
            edges: p.edges ?? [],
            seats: p.members.map((id) => {
              const live = seats.find((s) => s.logicalId === OpenRig.logicalId(p.id, id));

              return {
                id,
                session: OpenRig.sessionName(rig.name, p.id, id),
                profile: null,
                agentRef: null,
                runtime: live?.runtime ?? null,
                model: live?.model ?? null,
              };
            }),
          })) ?? null,
        edges: rig.specEdges ?? null,
        culture: rig.rigSpec?.culture_file ?? null,
        docs: (rig.rigSpec?.docs ?? []).map((d) => d.path),
        agents: null,
        source: 'live-record',
      });
    }
  }
  // Drafts first (the ones being written now), then running, then the rest; by name inside each.
  const rank: Record<SpecState, number> = { draft: 0, running: 1, launched: 2 };

  return out.sort(
    (a, b) =>
      rank[a.state] - rank[b.state] || a.name.localeCompare(b.name) || a.key.localeCompare(b.key)
  );
}

export const STATE_WORD: Record<SpecState, string> = {
  draft: 'draft (not launched)',
  running: 'running',
  launched: 'launched, not running',
};

/** The profile's one-line summary, from the AgentSpec the seat points at. */
export function profileSummary(
  agents: SpecAgent[] | null,
  agentRef: string | null,
  profile: string | null
): string | null {
  if (!agents || !agentRef || !profile) {
    return null;
  }
  const p = agents.find((a) => a.ref === agentRef)?.spec?.profiles[profile];

  return p?.summary ?? p?.description ?? null;
}

/** The model a seat runs: the member's own, else its profile's preference, else the AgentSpec default. */
export function seatModel(agents: SpecAgent[] | null, seat: ShownSeat): string | null {
  if (seat.model) {
    return seat.model;
  }
  const a = agents?.find((x) => x.ref === seat.agentRef)?.spec;

  return (
    (seat.profile && a?.profiles[seat.profile]?.preferences?.model) || a?.defaults?.model || null
  );
}

export const AGENT_STATUS_WORD: Record<SpecAgent['status'], string> = {
  ok: 'read',
  invalid: 'OpenRig would refuse this agent.yaml',
  missing: 'no agent.yaml where the ref points',
  refused: 'outside the rig folder, so not read',
  builtin: 'built in (a plain terminal)',
};

export type RigCommandRow = RigCommandsOutput['commands'][number];

/** The commands the panel shows: the selected rig's, or every rig's. Newest first, as the verb sends them. */
export function shownCommands(
  commands: RigCommandRow[],
  rig: string | null,
  allRigs: boolean
): RigCommandRow[] {
  if (allRigs || !rig) {
    return commands;
  }

  return commands.filter((c) => commandNamesRig(c, rig));
}

/** `ran · exit 0`, `failed · exit 1`, `attempted`, `denied`. */
export function outcomeOf(c: RigCommandRow): string {
  const parts = [c.phase ?? 'unknown'];
  if (c.exitCode !== null) {
    parts.push(`exit ${c.exitCode}`);
  }
  if (c.interrupted) {
    parts.push('interrupted');
  }

  return parts.join(' · ');
}

/** The first line or two of the output, short enough for a row. */
export function shortOutput(c: RigCommandRow, max = 160): string | null {
  const text = [c.stderrHead, c.stdoutHead].filter(Boolean).join('\n').trim();
  if (!text) {
    return null;
  }
  const firstLines = text.split('\n').slice(0, 2).join(' ⏎ ');

  return firstLines.length > max ? `${firstLines.slice(0, max - 1)}…` : firstLines;
}

/** `14:02:07` (local time) for a command's timestamp. */
export function clockOf(iso: string): string {
  const d = new Date(iso);

  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
}
