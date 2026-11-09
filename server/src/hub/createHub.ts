import express, { type Express } from 'express';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import {
  FLEET_EVENTS,
  HUB_MAX_BUFFER,
  SOCKET_NAMESPACES,
  UI_PRINCIPAL,
  type CallAnswer,
  type CoreCallRequest,
  type FleetMachine,
  type FleetUpdate,
} from '@appydave/shared';
import { createCore, type Core } from '@server/core/core.js';
import { apiRouter, rpcParseError } from '@server/core/doors.js';
import { readIdentity, type AppIdentity } from '@server/core/identity.js';
import { requestLogger } from '@server/middleware/requestLogger.js';
import { errorHandler } from '@server/middleware/errorHandler.js';
import { apiLimiter } from '@server/middleware/rateLimiter.js';
import healthRouter from '@server/routes/health.js';
import infoRouter from '@server/routes/info.js';
import { accountViews, applyAccountDerived } from './accounts.js';
import { applyRigLabels, defaultConfigPath, watchConfig } from './appConfig.js';
import { browserAuth, browserSocketRefusal } from './ingress/browserAuth.js';
import { attachCollectorIngest } from './ingress/collectorIngest.js';
import { FleetStore, type LivenessChange } from './stores/fleetStore.js';
import { listenOnHosts, type Listening } from './ingress/listen.js';
import { v1ArchiveRouter } from './ingress/v1ArchiveRouter.js';

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
  /** AppyRig's own config file (rig displayName/owner). Default ~/.config/appyrig/config.json. */
  configPath?: string;
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
  /** Every liveness change (first push, live → asleep, asleep → live), e.g. for the hub log. */
  onLiveness?: (change: LivenessChange) => void;
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

/**
 * A browser's call frame, unchecked. Never String(verb): Socket.IO runs the listener with no
 * try/catch, and { verb: { toString: 1 } } makes String() throw, which would end the hub process.
 */
function readCall(request: CoreCallRequest) {
  const r: Partial<CoreCallRequest> =
    typeof request === 'object' && request !== null ? request : {};

  return { verb: typeof r.verb === 'string' ? r.verb : '', input: r.input, dryRun: r.dryRun };
}

/**
 * Also closes the HTTP server. Run alongside the extra listeners' close, never after it: an extra
 * listener's close only finishes once its connections end, and this is what ends them.
 */
const closeSockets = (io: Server) => new Promise<void>((r) => io.close(() => r()));

export function createHub(opts: HubOptions): Hub {
  const now = opts.now ?? (() => new Date());
  const viewsOf = new WeakMap<FleetMachine[], ReturnType<typeof accountViews>>();
  const config = watchConfig(opts.configPath ?? defaultConfigPath(), opts.onDiskError);
  const store = new FleetStore({
    decorate: (m, all) => {
      const cfg = config.current();
      // One computation (and one `asOf`) per fleet read, shared by every machine in it.
      let views = viewsOf.get(all);

      if (!views) {
        views = accountViews(all, cfg, now(), (id) => store.emailChangedAt(id));
        viewsOf.set(all, views);
      }

      return applyAccountDerived(applyRigLabels(m, cfg), views);
    },
    dataDir: opts.dataDir,
    now,
    asleepAfterMs: opts.asleepAfterMs,
    onDiskError: opts.onDiskError,
    onLiveness: opts.onLiveness,
  });

  const identity = opts.identity ?? readIdentity();
  const core = createCore({
    store,
    identity,
    now,
    asleepAfterMs: opts.asleepAfterMs,
    onFault: opts.onFault,
    config: () => config.current(),
  });

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: opts.clientUrl, methods: ['GET', 'POST'], credentials: true },
    // Fleet pushes are ~300 KB of mostly ANSI terminal text, resent every second or so. Uncompressed,
    // a seat.get ack queues behind them on a slow link and the UI's 5 s timeout fires. socket.io
    // leaves per-message deflate off by default; a full push measured 5.2x smaller (486 KB to 93 KB).
    perMessageDeflate: { threshold: 1024 },
    // Explicit (it is socket.io's default): a collector skips any payload over 800 KB
    // (CHANNEL_PAYLOAD_MAX) so one message always fits under this; the snapshot is ~300 KB.
    maxHttpBufferSize: HUB_MAX_BUFFER,
  });

  // The hub is served over plain http on the tailnet (http://<tailscale-ip>:7191).
  // helmet's defaults (CSP upgrade-insecure-requests + HSTS) make browsers fetch
  // /assets/* over https, which fails and leaves a blank page.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          upgradeInsecureRequests: null,
        },
      },
      strictTransportSecurity: false,
    })
  );
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
  app.use(v1ArchiveRouter(opts.dataDir));
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
    const refused = browserSocketRefusal(socket.handshake.headers, opts.hubToken, opts.clientUrl);

    next(refused ? new Error(refused) : undefined);
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
      if (typeof ack !== 'function') {
        return;
      }

      const r = readCall(request);

      ack(core.call(UI_PRINCIPAL, r.verb, r.input, { dryRun: r.dryRun }));
    });
  });

  const emitChanged = (machines: FleetMachine[]) => {
    if (machines.length === 0) {
      return;
    }

    const update: FleetUpdate = { generatedAt: now().toISOString(), full: false, machines };

    browsers.emit(FLEET_EVENTS.UPDATE, update);
  };

  attachCollectorIngest(io, {
    hubToken: opts.hubToken,
    store,
    onSnapshot: (entry) => emitChanged([entry]),
    onFault: opts.onFault,
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
    load: async () => {
      const loaded = await store.load();

      await store.loadHistories();
      await store.loadHandoffs();
      await store.schemas.load();

      return loaded;
    },
    sweep,
    start: () => {
      if (timer) {
        return;
      }

      timer = setInterval(sweep, opts.livenessIntervalMs ?? 1_000);
      timer.unref();
    },
    listen: async (port, hosts) => {
      listening = await listenOnHosts(httpServer, port, hosts);

      return listening;
    },
    close: async () => {
      if (timer) {
        clearInterval(timer);
      }

      timer = undefined;
      await Promise.all([listening?.close(), closeSockets(io)]);
      await store.flush();
    },
  };
}
