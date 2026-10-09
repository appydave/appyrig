/**
 * AppyRig collector entry point (P0b stub; the collector lane builds it in P1–P2).
 *
 * One process per machine, run by launchd. Every PUSH_INTERVAL_MS it:
 *   1. reads its own machine through collector/src/adapters/ (the ONLY place that knows OpenRig,
 *      tmux and terminal-viewer shapes, routes and commands — AC 12);
 *   2. builds a MachineSnapshot (shared contract), redacted (AC 19) and tail-bounded (AC 7);
 *   3. pushes it to the hub on the `/collector` namespace with CollectorAuth.
 * Read-only toward everything it reads: no send-keys, no `rig send`, no queue writes, never the
 * transcript routes (AC 4, AC 9).
 */
import { PUSH_INTERVAL_MS, SNAPSHOT_SCHEMA_VERSION } from '@appydave/shared';

export const COLLECTOR_CONTRACT = {
  schemaVersion: SNAPSHOT_SCHEMA_VERSION,
  pushIntervalMs: PUSH_INTERVAL_MS,
} as const;
