import { readFileSync } from 'node:fs';
import { pid } from 'node:process';
import { HistoryReader } from './adapters/history.js';
import { createSources, HandoffReader, RigFilesReader, SchemaReader } from './adapters/index.js';
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
  let queueOrder: string[] = [];
  const history = new HistoryReader(settings.machine.id);
  const handoffs = new HandoffReader(settings.machine.id);
  const rigFiles = new RigFilesReader(settings.machine.id);
  const schema = new SchemaReader(settings.machine.id, sources.exec!, {
    rigBin: settings.sources.rigBin,
  });
  const pusher = startPusher({
    hubUrl: settings.hubUrl,
    token: settings.token,
    machineId: settings.machine.id,
    build: async () => {
      const snap = await buildSnapshot(sources, config);
      knownSeats = new Set(snap.seats.filter((s) => s.rig !== null).map((s) => s.id));
      queueOrder = snap.queue.map((q) => q.id);
      return snap;
    },
    onConnect: () => {
      handoffs.reset();
      rigFiles.reset();
      schema.reset();
    },
    rigFiles: async () => (sources.specs ? rigFiles.next(await sources.specs()) : null),
    schema: () => schema.next(),
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
