import { io as connect, type Socket } from 'socket.io-client';
import {
  FLEET_EVENTS,
  PUSH_INTERVAL_MS,
  SOCKET_NAMESPACES,
  type CollectorAuth,
  type MachineSnapshot,
} from '@appydave/shared';
import type { PendingHistory } from './adapters/history.js';
import type { PendingHandoffs } from './adapters/handoffs.js';
import { emitAcked } from '@collector/pusher/emitAcked.js';
import { startChannel, type ChannelDeps } from '@collector/pusher/channel.js';
import {
  loop,
  pushHandoffs,
  pushHistories,
  pushSnapshot,
  type Loop,
  type LoopDeps,
} from '@collector/pusher/ticks.js';
import { quietLog } from '@collector/pusher/quietLog.js';
import { trackHubCaps } from '@collector/pusher/hubCaps.js';
import { CHANNELS, type ChannelOptions } from '@collector/pusher/channelTable.js';

/**
 * Pushes one whole-machine snapshot to the hub every PUSH_INTERVAL_MS over the `/collector`
 * namespace. Never overlaps ticks, skips building while disconnected (socket.io-client reconnects
 * by itself), and logs only changes of state so the launchd log stays small.
 */
export interface PusherOptions extends ChannelOptions {
  hubUrl: string;
  token: string;
  machineId: string;
  build: () => Promise<MachineSnapshot>;
  intervalMs?: number;
  ackTimeoutMs?: number;
  log?: (line: string) => void;
  /** v1.2: seat histories whose transcripts changed, pushed on a slower loop than snapshots. */
  histories?: () => Promise<PendingHistory[]>;
  historyIntervalMs?: number;
  /** v1.4: queue message bodies not yet accepted by the hub, one batch per call; null = nothing to send. */
  handoffs?: () => Promise<PendingHandoffs | null>;
  handoffIntervalMs?: number;
  /** How long the first push waits for the hub's `hub:caps` (default 1000 ms; an older hub never sends it). */
  capsWaitMs?: number;
  /** Called on every (re)connect to the hub, e.g. to make queue bodies go out again. */
  onConnect?: () => void;
}

/**
 * Largest serialized payload a side channel will send (bytes). The hub's socket.io limit is
 * HUB_MAX_BUFFER (1 MiB); anything over this is skipped and logged, never sent, and never touches
 * the snapshot push.
 */
export const CHANNEL_PAYLOAD_MAX = 800 * 1024;

/** Seat history changes slowly and is large next to a snapshot, so it is checked once a minute. */
const HISTORY_INTERVAL_MS = 60_000;

/** New queue bodies are small and wanted promptly, so this loop runs faster than history's. */
const HANDOFF_INTERVAL_MS = 10_000;

export interface Pusher {
  stop(): Promise<void>;
  readonly socket: Socket;
}

export function startPusher(opts: PusherOptions): Pusher {
  const intervalMs = opts.intervalMs ?? PUSH_INTERVAL_MS;
  const ackTimeout = opts.ackTimeoutMs ?? 5000;
  const log = opts.log ?? ((l) => console.log(`${new Date().toISOString()} ${l}`));
  const auth: CollectorAuth = { token: opts.token, machineId: opts.machineId };
  const socket = connect(`${opts.hubUrl}${SOCKET_NAMESPACES.COLLECTOR}`, {
    auth,
    transports: ['websocket'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  let stopped = false;
  const caps = trackHubCaps(socket, opts.capsWaitMs ?? 1000);
  const quiet = quietLog(log);
  const { note, warnSometimes } = quiet;

  socket.on('connect', () => {
    caps.reset();
    opts.onConnect?.();
    note(`connected to ${opts.hubUrl} as ${opts.machineId}`);
  });
  socket.on('disconnect', (reason) => note(`disconnected: ${reason}`));
  socket.on('connect_error', (err) => note(`hub refused or unreachable: ${err.message}`));

  const loopDeps: LoopDeps = { isStopped: () => stopped, connected: () => socket.connected, note };
  // A missing ack is a timeout, not a refusal: kept apart from the hub's own failure modes.
  const snapshots = loop({
    name: 'tick',
    step: () =>
      pushSnapshot({
        caps,
        build: opts.build,
        push: (s) => emitAcked(socket.timeout(ackTimeout), FLEET_EVENTS.SNAPSHOT, s),
        note,
        log,
        intervalMs,
        ackTimeoutMs: ackTimeout,
      }),
    everyMs: intervalMs,
    deps: loopDeps,
  });

  snapshots.now();

  // Seat histories: first round shortly after the first snapshot, so known seats exist. Queue
  // bodies are small and wanted promptly, so that loop is faster and starts sooner.
  const optional: Loop[] = [];
  const historyInterval = opts.historyIntervalMs ?? HISTORY_INTERVAL_MS;
  const handoffInterval = opts.handoffIntervalMs ?? HANDOFF_INTERVAL_MS;
  const { histories, handoffs } = opts;

  if (histories) {
    const history = loop({
      name: 'history tick',
      step: () =>
        pushHistories({
          histories,
          push: (h) => emitAcked(socket.timeout(ackTimeout * 2), FLEET_EVENTS.HISTORY, h),
          note,
        }),
      everyMs: historyInterval,
      deps: loopDeps,
    });

    history.after(Math.min(historyInterval, 5_000));
    optional.push(history);
  }

  if (handoffs) {
    const handoff = loop({
      name: 'handoff tick',
      step: () =>
        pushHandoffs({
          handoffs,
          push: (b) => emitAcked(socket.timeout(ackTimeout * 2), FLEET_EVENTS.HANDOFFS, b),
          log: quiet,
        }),
      everyMs: handoffInterval,
      deps: loopDeps,
    });

    handoff.after(Math.min(handoffInterval, 3_000));
    optional.push(handoff);
  }

  // v1.4 · S7: rig files (chunked, so no message nears socket.io's 1 MB limit) and the database
  // shape. Same rules as queue bodies: marked sent only when the hub accepts, retried otherwise,
  // and an older hub (no listener, no ack) is warned about at most every 10 minutes.
  const sendAcked = (event: string, payload: unknown) =>
    emitAcked(socket.timeout(ackTimeout * 2), event, payload);
  const timers = new Set<NodeJS.Timeout>();
  const deps: ChannelDeps = {
    isStopped: () => stopped,
    connected: () => socket.connected,
    hubCaps: caps.current,
    maxPayloadBytes: CHANNEL_PAYLOAD_MAX,
    note,
    warnSometimes,
    sendAcked,
    timers,
  };

  for (const row of CHANNELS) {
    const take = row.read(opts);

    if (take) {
      startChannel({ ...row, every: row.every(opts), take }, deps);
    }
  }

  return {
    socket,
    async stop() {
      for (const t of timers) {
        clearTimeout(t);
      }

      stopped = true;
      snapshots.stop();
      for (const l of optional) {
        l.stop();
      }

      socket.close();
    },
  };
}
