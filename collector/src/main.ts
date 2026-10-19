import { readFileSync } from 'node:fs';
import { pid } from 'node:process';
import { HistoryReader } from './adapters/history.js';
import {
  createSources,
  HandoffReader,
  DbRowsReader,
  DaemonDataReader,
  LoadoutReader,
  RigFilesReader,
  MissionFilesReader,
  SchemaReader,
  seatConfigReader,
  withSeatCards,
  withSkillCounts,
  type LoadoutSeat,
  type SeatTarget,
} from './adapters/index.js';
import { buildSnapshot } from './builder.js';
import { loadSettings } from './config.js';
import { startPusher } from './pusher.js';

/** Entry point for launchd: `node dist/main.js`. Settings come from APPYRIG_* environment variables. */
const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

function main() {
  const settings = loadSettings();
  const sources = createSources(settings.sources);
  const config = { machine: settings.machine, version: VERSION, pid };
  // Seat histories are read only for seats the daemon reported in the latest snapshot.
  let knownSeats = new Set<string>();
  let openrigSeats: LoadoutSeat[] = [];
  let queueOrder: string[] = [];
  const history = new HistoryReader(settings.machine.id);
  const handoffs = new HandoffReader(settings.machine.id);
  const rigFiles = new RigFilesReader(settings.machine.id);
  const missionFiles = new MissionFilesReader(settings.machine.id);
  const schema = new SchemaReader(settings.machine.id, sources.exec!, {
    rigBin: settings.sources.rigBin,
  });
  const dbRows = new DbRowsReader(settings.machine.id);
  const loadouts = new LoadoutReader(settings.machine.id, { exec: sources.exec! });
  let daemonTargets: SeatTarget[] = [];
  const daemonData = new DaemonDataReader(settings.machine.id, sources.daemonGet!, {
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
  const seatConfig = seatConfigReader();
  const pusher = startPusher({
    hubUrl: settings.hubUrl,
    token: settings.token,
    machineId: settings.machine.id,
    build: async () => {
      const snap = await buildSnapshot(
        { ...sources, agentActivity: () => history.agentActivity() },
        config
      );
      const own = snap.seats.filter((s) => s.rig !== null);
      knownSeats = new Set(own.map((s) => s.id));
      openrigSeats = own.map((s) => ({ id: s.id, rig: s.rig, runtime: s.runtime, cwd: s.cwd }));
      queueOrder = snap.queue.map((q) => q.id);
      // v2 data channels: one node-detail read per OpenRig seat (rig name to rig id, from the snapshot).
      const rigIds = new Map(snap.rigs.map((r) => [r.name, r.id]));
      daemonData.forgetSeatsNotIn(new Set(own.map((s) => s.id)));
      daemonTargets = own.flatMap((s) => {
        const rigId = s.rig ? rigIds.get(s.rig) : undefined;
        return s.source === 'openrig' && s.logicalId && rigId
          ? [{ seat: s.id, rigId, logicalId: s.logicalId }]
          : [];
      });
      // v1.5 · L1: the skill-count pill, from the loadout reader's latest scan.
      // D09 W3: each seat's role (agent_ref) and key skills (allowlist ∩ its own listing).
      const seats = withSeatCards(withSkillCounts(snap.seats, loadouts.skillCounts()), {
        agentRefs: sources.agentRefs?.() ?? new Map(),
        names: loadouts.skillNames(),
        config: seatConfig(),
      });
      return { ...snap, seats };
    },
    onConnect: () => {
      handoffs.reset();
      rigFiles.reset();
      missionFiles.reset();
      schema.reset();
      loadouts.reset();
      dbRows.reset();
      daemonData.reset();
    },
    daemonData: () => daemonData.next(daemonTargets),
    rigFiles: async () => (sources.specs ? rigFiles.next(await sources.specs()) : null),
    missionFiles: async () => (sources.specs ? missionFiles.next(await sources.specs()) : null),
    schema: () => schema.next(),
    dbRows: () => dbRows.next(),
    loadouts: async () =>
      loadouts.next(
        openrigSeats,
        sources.specs ? await sources.specs() : new Map(),
        sources.agentDirs?.() ?? new Map()
      ),
    histories: () => history.changed(knownSeats),
    handoffs: async () =>
      sources.queueBodies ? handoffs.next(queueOrder, await sources.queueBodies()) : null,
  });
  console.log(
    `${new Date().toISOString()} appyrig collector ${VERSION} for ${settings.machine.id} -> ${settings.hubUrl}`
  );
  const shutdown = async () => {
    await pusher.stop();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

try {
  main();
} catch (e) {
  console.error(`${new Date().toISOString()} collector not started: ${(e as Error).message}`);
  process.exit(2);
}
