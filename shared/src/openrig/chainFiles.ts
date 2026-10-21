import { z } from 'zod';

/**
 * OpenRig's two chain-file trees: one file NAME, the same at every level, read from the leaf toward
 * the root. Chain files sit on nodes (instance, rig, pod, seat; project, mission, slice), never on
 * the containing shelves (`rigs/`, `pods/`, `seats/`, `missions/`, `slices/`).
 *
 * Mirrors: OpenRig `docs/reference/chain-file-convention.md` (the single source of truth for chain
 * files), `packages/daemon/src/domain/topology-defaults-installer.ts` (the topology paths) and
 * `packages/daemon/src/domain/context-packs/seat-recap-store.ts` (RECAP.md is seat-homed).
 */

// ── the topology tree: how work is done here ────────────────────────────────────────────────────

/** instance → rig → pod → seat. */
export const TOPOLOGY_ALTITUDES = ['instance', 'rig', 'pod', 'seat'] as const;
export const TopologyAltitudeSchema = z.enum(TOPOLOGY_ALTITUDES);
export type TopologyAltitude = z.infer<typeof TopologyAltitudeSchema>;

/**
 * Established names on the topology tree. RECAP.md is seat-only (older ones under
 * `recap-superseded/`). CULTURE.md here is NOT what startup delivers: startup delivers the rig.yaml
 * `culture_file`, a path beside rig.yaml.
 */
export const TOPOLOGY_CHAIN_FILES = [
  'LEARNED.md',
  'CRAFT.md',
  'ORCHESTRATION-CRAFT.md',
  'CULTURE.md',
  'RECAP.md',
] as const;
export type TopologyChainFile = (typeof TOPOLOGY_CHAIN_FILES)[number];

/** Where a topology node is, relative to `topology.root` (default `$OPENRIG_HOME/topology`). */
export const TopologyNodeSchema = z.discriminatedUnion('altitude', [
  z.object({ altitude: z.literal('instance') }),
  z.object({ altitude: z.literal('rig'), rig: z.string().min(1) }),
  z.object({ altitude: z.literal('pod'), rig: z.string().min(1), pod: z.string().min(1) }),
  /**
   * `seat` is the session name's member leg, everything before the first `@` (`dev-build` for
   * `dev-build@d09-crew`): OpenRig's own seat-recap-store.ts / rebuild-priming-chain.ts build the
   * seat folder from `parseSessionName(seatRef).member`.
   */
  z.object({ altitude: z.literal('seat'), rig: z.string().min(1), seat: z.string().min(1) }),
]);
export type TopologyNode = z.infer<typeof TopologyNodeSchema>;

/**
 * The folder of a topology node, relative to `topology.root`:
 * `` (instance) · `rigs/<rig>` · `rigs/<rig>/pods/<pod>` · `rigs/<rig>/seats/<seat>`.
 * Note seats are NOT under their pod.
 */
export function topologyDir(n: TopologyNode): string {
  switch (n.altitude) {
    case 'instance':
      return '';
    case 'rig':
      return `rigs/${n.rig}`;
    case 'pod':
      return `rigs/${n.rig}/pods/${n.pod}`;
    case 'seat':
      return `rigs/${n.rig}/seats/${n.seat}`;
  }
}

/** The leaf-to-root walk for one seat in one pod, root first (what `rig context trace` prints). */
export function topologyTrace(
  rig: string,
  pod: string | null,
  seat: string | null
): TopologyNode[] {
  const out: TopologyNode[] = [{ altitude: 'instance' }, { altitude: 'rig', rig }];
  if (pod) {
    out.push({ altitude: 'pod', rig, pod });
  }
  if (seat) {
    out.push({ altitude: 'seat', rig, seat });
  }

  return out;
}

/** Pre-convention location, still read with an advisory: `~/.openrig/shared-docs/rigs/` (rig and seat). */
export const LEGACY_TOPOLOGY_ROOT = '~/.openrig/shared-docs/rigs';
