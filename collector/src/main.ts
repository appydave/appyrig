import { readFileSync } from 'node:fs';
import { pid } from 'node:process';
import { createSources } from './adapters/index.js';
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
  const pusher = startPusher({
    hubUrl: settings.hubUrl,
    token: settings.token,
    machineId: settings.machine.id,
    build: () => buildSnapshot(sources, config),
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
