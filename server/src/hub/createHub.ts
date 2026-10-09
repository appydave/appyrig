import express, { type Express } from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import {
  AUTH_ERRORS,
  FLEET_EVENTS,
  SOCKET_NAMESPACES,
  UI_PRINCIPAL,
  type CallAnswer,
  type CoreCallRequest,
  type FleetMachine,
  type FleetUpdate,
} from '@appydave/shared';
import { createCore, type Core } from '../core/core.js';
import { apiRouter, rpcParseError } from '../core/doors.js';
import { readIdentity, type AppIdentity } from '../core/identity.js';
import { requestLogger } from '../middleware/requestLogger.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import healthRouter from '../routes/health.js';
import infoRouter from '../routes/info.js';
import { browserAuth, isAuthorised } from './browserAuth.js';
import { attachCollectorIngest } from './collectorIngest.js';
import { FleetStore } from './fleetStore.js';
import { listenOnHosts, type Listening } from './listen.js';

/**
 * Builds the whole hub (HTTP app, Socket.IO, fleet store, collector ingest, liveness timer)
 * without listening, so tests can run real instances side by side with their own clock,
 * data folder and token. index.ts builds one from env and listens.
 */

export interface HubOptions {
  hubToken: string | undefined;
  clientUrl: string;
  /** Holds `snapshots/`. Undefined = memory only. */
  dataDir?: string;
  /** Serve the built client from here (production). */
  clientDist?: string;
  now?: () => Date;
  asleepAfterMs?: number;
  /** How often the liveness sweep runs once start() is called. */
  livenessIntervalMs?: number;
  onDiskError?: (message: string, err: unknown) => void;
  /** Addresses the hub is reachable on; the API pages count them as live copies (B10). */
  liveHosts?: string[];
  identity?: AppIdentity;
  onFault?: (verb: string, err: unknown) => void;
}

export interface Hub {
  app: Express;
  httpServer: HttpServer;
  io: Server;
  store: FleetStore;
  core: Core;
  /** Load last-known state from disk. Call before listen() so the first browser sees it. */
  load: () => Promise<FleetMachine[]>;
  /** Run one liveness sweep now; emits and returns the machines that fell asleep. */
  sweep: () => FleetMachine[];
  /** Start the liveness timer. */
  start: () => void;
  listen: (port: number, hosts: string[]) => Promise<Listening>;
  close: () => Promise<void>;
}

export function createHub(opts: HubOptions): Hub {
  const now = opts.now ?? (() => new Date());
  const store = new FleetStore({
    dataDir: opts.dataDir,
    now,
    asleepAfterMs: opts.asleepAfterMs,
    onDiskError: opts.onDiskError,
  });

  const identity = opts.identity ?? readIdentity();
  const core = createCore({
    store,
    identity,
    now,
    asleepAfterMs: opts.asleepAfterMs,
    onFault: opts.onFault,
  });

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: opts.clientUrl, methods: ['GET', 'POST'], credentials: true },
  });

  app.use(helmet());
  app.use(compression());
  app.use(cors({ origin: opts.clientUrl, credentials: true }));
  app.use(express.json());
  app.use(requestLogger);
  app.use(apiLimiter);
  // Auth before every route: only the open API doors pass without a session (AC 18).
  app.use(
    browserAuth({
      hubToken: opts.hubToken,
      afterLogin: opts.clientDist ? '/' : new URL('/', opts.clientUrl).toString(),
    })
  );
  app.use(healthRouter);
  app.use(infoRouter);
  app.use(apiRouter(core, identity, opts.liveHosts ?? []));

  if (opts.clientDist) {
    const dist = opts.clientDist;
    app.use(express.static(dist));
    app.get('*splat', (_req, res) => res.sendFile('index.html', { root: dist }));
  }

  app.use((_req, res) => {
    res.status(404).json({ status: 'error', error: 'Not found', timestamp: now().toISOString() });
  });
  app.use(rpcParseError);
  app.use(errorHandler);

  // Browsers: session cookie at connect, then the whole fleet, then changed machines (D3).
  const browsers = io.of(SOCKET_NAMESPACES.BROWSER);
  browsers.use((socket, next) => {
    if (isAuthorised(socket.handshake.headers, opts.hubToken)) next();
    else next(new Error(AUTH_ERRORS.browserSession));
  });
  browsers.on('connection', (socket) => {
    const update: FleetUpdate = {
      generatedAt: now().toISOString(),
      full: true,
      machines: store.list(),
    };
    socket.emit(FLEET_EVENTS.UPDATE, update);
    // The UI's door onto the core (B1, B13): same seam, fixed principal.
    socket.on(FLEET_EVENTS.CALL, (request: CoreCallRequest, ack: (a: CallAnswer) => void) => {
      if (typeof ack !== 'function') return;
      const r: Partial<CoreCallRequest> =
        typeof request === 'object' && request !== null ? request : {};
      ack(core.call(UI_PRINCIPAL, String(r.verb ?? ''), r.input, { dryRun: r.dryRun }));
    });
  });

  const emitChanged = (machines: FleetMachine[]) => {
    if (machines.length === 0) return;
    const update: FleetUpdate = { generatedAt: now().toISOString(), full: false, machines };
    browsers.emit(FLEET_EVENTS.UPDATE, update);
  };

  attachCollectorIngest(io, {
    hubToken: opts.hubToken,
    store,
    onSnapshot: (entry) => emitChanged([entry]),
  });

  const sweep = () => {
    const changed = store.sweep();
    emitChanged(changed);
    return changed;
  };

  let timer: NodeJS.Timeout | undefined;
  let listening: Listening | undefined;

  return {
    app,
    httpServer,
    io,
    store,
    core,
    load: () => store.load(),
    sweep,
    start: () => {
      if (timer) return;
      timer = setInterval(sweep, opts.livenessIntervalMs ?? 1_000);
      timer.unref();
    },
    listen: async (port, hosts) => {
      listening = await listenOnHosts(httpServer, port, hosts);
      return listening;
    },
    close: async () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      await listening?.close();
      await new Promise<void>((r) => io.close(() => r())); // also closes httpServer
      await store.flush();
    },
  };
}
