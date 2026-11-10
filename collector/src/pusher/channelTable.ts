import { FLEET_EVENTS, HUB_CAPS, PUSH_INTERVAL_MS, stripSeatSpec } from '@appydave/shared';
import type { PendingRigFiles } from '@collector/adapters/rig/rigfiles.js';
import type { PendingSchema } from '@collector/adapters/dbschema.js';
import type { PendingLoadouts } from '@collector/adapters/loadout.js';
import type { PendingDbRows } from '@collector/adapters/dbrows.js';
import type { PendingDaemonData } from '@collector/adapters/daemondata/reader.js';
import type { PendingMissionFiles } from '@collector/adapters/missionfiles.js';
import type { PendingRigSpecs } from '@collector/adapters/rig/rigspecs.js';
import type { PendingRigCommands } from '@collector/adapters/rig/rigcommands.js';
import type { ChannelSpec } from '@collector/pusher/channel.js';

/** The side channels a pusher can be given, each with the interval it runs at. */
export interface ChannelOptions {
  /** v1.4 · S7: rig files whose content changed since the hub accepted them; null = nothing to send. */
  /** Given the caps the hub advertised, so it can send scope `rig` files only to a hub that takes them. */
  rigFiles?: (caps: ReadonlySet<string>) => Promise<PendingRigFiles | null>;
  rigFilesIntervalMs?: number;
  /** v1.4 · S7: the OpenRig database shape, when it changed; null = nothing to send. */
  schema?: () => Promise<PendingSchema | null>;
  schemaIntervalMs?: number;
  /** v1.5 · L1: seat loadouts that changed since the hub accepted them; null = nothing to send. */
  loadouts?: () => Promise<PendingLoadouts | null>;
  loadoutIntervalMs?: number;
  /** Batch 1 · B5: OpenRig database rows (one push per changed table); null = nothing to send. */
  dbRows?: () => Promise<PendingDbRows | null>;
  dbRowsIntervalMs?: number;
  /** v2 data channels: OpenRig daemon reads (seat detail, library, …) that changed; null = nothing to send. */
  daemonData?: () => Promise<PendingDaemonData | null>;
  daemonDataIntervalMs?: number;
  /** Run board lane 1: a rig's list of servable mission files and the files; null = nothing to send. Sent only to a hub that advertised `missionfiles`. */
  missionFiles?: () => Promise<PendingMissionFiles | null>;
  missionFilesIntervalMs?: number;
  /** N10: every rig spec found (launched or not), when it changed; sent only to a hub that advertised `rig-specs`. */
  rigSpecs?: () => Promise<PendingRigSpecs | null>;
  rigSpecsIntervalMs?: number;
  /** N10b: the machine's `rig` command log, when it changed; sent only to a hub that advertised `rig-commands`. */
  rigCommands?: () => Promise<PendingRigCommands | null>;
  rigCommandsIntervalMs?: number;
}

const EVERY_10S = 10_000;
const EVERY_15S = 15_000;
const EVERY_30S = 30_000;

/** One row per channel: how to switch it on from the options, and what it is called to the hub. */
interface ChannelRow extends Omit<ChannelSpec, 'every' | 'take'> {
  every(o: ChannelOptions): number;
  /** Its read, or undefined when the options do not switch the channel on. */
  read(o: ChannelOptions): ChannelSpec['take'] | undefined;
}

/** Registered in this order: it is the order of their first ticks. */
export const CHANNELS: ChannelRow[] = [
  {
    key: 'rig files',
    event: FLEET_EVENTS.RIGFILES,
    since: 'v1.4',
    every: (o) => o.rigFilesIntervalMs ?? EVERY_15S,
    read: ({ rigFiles }) =>
      rigFiles &&
      (async (caps) => {
        const p = await rigFiles(caps());

        return p && { payloads: p.pushes, markSent: p.markSent };
      }),
  },
  {
    key: 'loadout',
    event: FLEET_EVENTS.LOADOUT,
    since: 'v1.5',
    every: (o) => o.loadoutIntervalMs ?? EVERY_15S,
    read: ({ loadouts }) =>
      loadouts &&
      (async (caps) => {
        const p = await loadouts();
        // A hub without seat-spec refuses the member / AgentSpec / topology keys (strict schema).
        const full = caps().has(HUB_CAPS.SEAT_SPEC);

        return (
          p && { payloads: full ? p.loadouts : p.loadouts.map(stripSeatSpec), markSent: p.markSent }
        );
      }),
  },
  {
    key: 'database rows',
    event: FLEET_EVENTS.DBROWS,
    since: 'v1.5',
    every: (o) => o.dbRowsIntervalMs ?? EVERY_30S,
    read: ({ dbRows }) =>
      dbRows &&
      (async () => {
        const p = await dbRows();

        return p && { payloads: p.pushes, markSent: p.markSent };
      }),
  },
  {
    key: 'daemon data',
    event: FLEET_EVENTS.DAEMONDATA,
    since: 'v2',
    needs: HUB_CAPS.DAEMONDATA,
    every: (o) => o.daemonDataIntervalMs ?? EVERY_10S,
    read: ({ daemonData }) =>
      daemonData &&
      (async () => {
        const p = await daemonData();

        return (
          p && {
            payloads: p.pushes,
            markSent: p.markSent,
            markSkipped: p.markSkipped,
          }
        );
      }),
  },
  {
    key: 'mission files',
    event: FLEET_EVENTS.MISSIONFILES,
    since: 'run board',
    needs: HUB_CAPS.MISSIONFILES,
    every: (o) => o.missionFilesIntervalMs ?? EVERY_30S,
    read: ({ missionFiles }) =>
      missionFiles &&
      (async () => {
        const p = await missionFiles();

        return p && { payloads: p.pushes, markSent: p.markSent };
      }),
  },
  {
    key: 'rig specs',
    event: FLEET_EVENTS.RIGSPECS,
    since: 'N10',
    needs: HUB_CAPS.RIG_SPECS,
    every: (o) => o.rigSpecsIntervalMs ?? EVERY_15S,
    read: ({ rigSpecs }) =>
      rigSpecs &&
      (async () => {
        const p = await rigSpecs();

        return p && { payloads: [p.push], markSent: p.markSent };
      }),
  },
  {
    key: 'rig commands',
    event: FLEET_EVENTS.RIGCOMMANDS,
    since: 'N10',
    needs: HUB_CAPS.RIG_COMMANDS,
    // The snapshot's cadence: a new command shows on the page within a push or two.
    every: (o) => o.rigCommandsIntervalMs ?? PUSH_INTERVAL_MS,
    read: ({ rigCommands }) =>
      rigCommands &&
      (async () => {
        const p = await rigCommands();

        return p && { payloads: [p.push], markSent: p.markSent };
      }),
  },
  {
    key: 'database schema',
    event: FLEET_EVENTS.SCHEMA,
    since: 'v1.4',
    every: (o) => o.schemaIntervalMs ?? EVERY_30S,
    read: ({ schema }) =>
      schema &&
      (async () => {
        const p = await schema();

        return p && { payloads: [p.push], markSent: p.markSent };
      }),
  },
];
