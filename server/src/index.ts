import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createHub } from './hub/createHub.js';
import { parseHosts } from './hub/listen.js';
import { SOCKET_EVENTS } from '@appydave/shared';

const __dirname = dirname(fileURLToPath(import.meta.url));

// process.cwd() is server/ under nodemon and `npm run start`, so `..` is the monorepo root.
const dataDir = env.DATA_DIR ?? resolve(process.cwd(), '..', 'data');

const hub = createHub({
  hubToken: env.HUB_TOKEN,
  clientUrl: env.CLIENT_URL,
  // Tests never touch the disk through index.ts; they build their own hubs.
  dataDir: env.isTest ? undefined : dataDir,
  clientDist: env.isProduction ? join(__dirname, '../../client/dist') : undefined,
  onDiskError: (message, err) => logger.error({ err }, message),
  onFault: (verb, err) => logger.error({ err, verb }, 'verb fault'),
  liveHosts: parseHosts(env.HUB_BIND_HOSTS),
});

const { app, httpServer, io } = hub;

if (!env.HUB_TOKEN) {
  logger.warn('HUB_TOKEN is not set: every collector and every browser will be refused');
}

// Scaffold ping/pong on the browser namespace (behind the session check, like everything there).
io.on('connection', (socket) => {
  logger.info({ socketId: socket.id }, 'Client connected');
  socket.on(SOCKET_EVENTS.CLIENT_PING, () => {
    socket.emit(SOCKET_EVENTS.SERVER_PONG, {
      message: 'pong',
      timestamp: new Date().toISOString(),
    });
  });
  socket.on('disconnect', () => {
    logger.info({ socketId: socket.id }, 'Client disconnected');
  });
});

// Start server — skip in test environment to prevent EADDRINUSE when multiple
// test files import this module. Tests use supertest with app directly.
if (!env.isTest) {
  // Never kill whatever holds the port: lanes and QA copies share this machine (MISSION ports).
  const start = async () => {
    const loaded = await hub.load();
    logger.info(
      { dataDir, machines: loaded.map((m) => `${m.machine.id}:${m.liveness}`) },
      'Loaded last-known fleet'
    );
    const hosts = parseHosts(env.HUB_BIND_HOSTS);
    const bound = await hub.listen(env.PORT, hosts);
    hub.start();
    logger.info(`Hub listening on ${bound.hosts.map((h) => `${h}:${bound.port}`).join(', ')}`);
    logger.info(`Client URL: ${env.CLIENT_URL}`);
  };
  start().catch((err: NodeJS.ErrnoException) => {
    logger.fatal(
      { err },
      `Cannot start the hub on ${env.HUB_BIND_HOSTS} port ${env.PORT}` +
        (err.code === 'EADDRINUSE' ? ' (port in use — check .env PORT)' : '') +
        (err.code === 'EADDRNOTAVAIL'
          ? ' (address not on this machine — check HUB_BIND_HOSTS)'
          : '')
    );
    process.exit(1);
  });
}

// Graceful shutdown
const shutdown = () => {
  logger.info('Shutting down gracefully...');
  hub.close().then(
    () => {
      logger.info('Server closed');
      process.exit(0);
    },
    (err) => {
      logger.error({ err }, 'Error while closing');
      process.exit(1);
    }
  );
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, httpServer, hub };
