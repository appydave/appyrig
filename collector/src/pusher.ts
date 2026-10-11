import { io as connect, type Socket } from 'socket.io-client';
import {
  FLEET_EVENTS,
  PUSH_INTERVAL_MS,
  SOCKET_NAMESPACES,
  type CollectorAck,
  type CollectorAuth,
  type MachineSnapshot,
  type SeatHistory,
} from '@appydave/shared';
import type { PendingHistory } from './adapters/history.js';
import type { PendingHandoffs } from './adapters/handoffs.js';

/**
 * Pushes one whole-machine snapshot to the hub every PUSH_INTERVAL_MS over the `/collector`
 * namespace. Never overlaps ticks, skips building while disconnected (socket.io-client reconnects
 * by itself), and logs only changes of state so the launchd log stays small.
 */
export interface PusherOptions {
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
  /** Called on every (re)connect to the hub, e.g. to make queue bodies go out again. */
  onConnect?: () => void;
}

/** Seat history changes slowly and is large next to a snapshot, so it is checked once a minute. */
export const HISTORY_INTERVAL_MS = 60_000;

/** New queue bodies are small and wanted promptly, so this loop runs faster than history's. */
export const HANDOFF_INTERVAL_MS = 10_000;

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
  let timer: NodeJS.Timeout | undefined;
  let lastNote = '';
  const note = (line: string) => {
    if (line !== lastNote) {
      lastNote = line;
      log(line);
    }
  };

  // A warning that repeats for as long as its cause lasts (an older hub with no listener for queue
  // bodies) is logged once per WARN_EVERY_MS, however much other news arrives in between.
  const WARN_EVERY_MS = 10 * 60_000;
  const lastWarn = new Map<string, number>();
  const warnSometimes = (key: string, line: string) => {
    const t = Date.now();
    if (t - (lastWarn.get(key) ?? 0) >= WARN_EVERY_MS) {
      lastWarn.set(key, t);
      log(line);
    }
  };

  socket.on('connect', () => {
    opts.onConnect?.();
    note(`connected to ${opts.hubUrl} as ${opts.machineId}`);
  });
  socket.on('disconnect', (reason) => note(`disconnected: ${reason}`));
  socket.on('connect_error', (err) => note(`hub refused or unreachable: ${err.message}`));

  // A missing ack is a timeout, not a refusal: kept apart from the hub's own failure modes.
  const push = (snapshot: MachineSnapshot) =>
    new Promise<CollectorAck | { ok: false; timeout: true }>((resolve) => {
      socket
        .timeout(ackTimeout)
        .emit(FLEET_EVENTS.SNAPSHOT, snapshot, (err: unknown, ack?: CollectorAck) => {
          resolve(err || !ack ? { ok: false, timeout: true } : ack);
        });
    });

  const tick = async () => {
    if (stopped) return;
    try {
      if (socket.connected) {
        const ack = await push(await opts.build());
        note(
          'timeout' in ack
            ? `no ack from hub within ${ackTimeout}ms`
            : ack.ok
              ? `pushing every ${intervalMs}ms: acked by hub`
              : `snapshot refused: ${ack.failureMode}: ${ack.message}`
        );
      }
    } catch (e) {
      note(`tick failed: ${(e as Error).message}`);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  void tick();

  // Seat histories: one emit per changed seat, marked sent only when the hub accepts it.
  let historyTimer: NodeJS.Timeout | undefined;
  const historyInterval = opts.historyIntervalMs ?? HISTORY_INTERVAL_MS;
  const pushHistory = (h: SeatHistory) =>
    new Promise<CollectorAck | { ok: false; timeout: true }>((resolve) => {
      socket
        .timeout(ackTimeout * 2)
        .emit(FLEET_EVENTS.HISTORY, h, (err: unknown, ack?: CollectorAck) => {
          resolve(err || !ack ? { ok: false, timeout: true } : ack);
        });
    });
  const historyTick = async () => {
    if (stopped || !opts.histories) return;
    try {
      if (socket.connected) {
        for (const p of await opts.histories()) {
          const ack = await pushHistory(p.history);
          if ('timeout' in ack) note(`no ack for history of ${p.history.seat}`);
          else if (ack.ok) p.markSent();
          else note(`history refused for ${p.history.seat}: ${ack.failureMode}: ${ack.message}`);
        }
      }
    } catch (e) {
      note(`history tick failed: ${(e as Error).message}`);
    }
    if (!stopped) historyTimer = setTimeout(historyTick, historyInterval);
  };
  // First history round shortly after the first snapshot, so known seats exist.
  if (opts.histories) historyTimer = setTimeout(historyTick, Math.min(historyInterval, 5_000));

  // Queue bodies: one batch per tick, marked sent only when the hub accepts it. An older hub has
  // no listener for this event, so no ack comes back: noted as a timeout, retried next tick.
  let handoffTimer: NodeJS.Timeout | undefined;
  const handoffInterval = opts.handoffIntervalMs ?? HANDOFF_INTERVAL_MS;
  const handoffTick = async () => {
    if (stopped || !opts.handoffs) return;
    try {
      if (socket.connected) {
        const pending = await opts.handoffs();
        if (pending) {
          const ack = await new Promise<CollectorAck | { ok: false; timeout: true }>((resolve) => {
            socket
              .timeout(ackTimeout * 2)
              .emit(FLEET_EVENTS.HANDOFFS, pending.bodies, (err: unknown, a?: CollectorAck) => {
                resolve(err || !a ? { ok: false, timeout: true } : a);
              });
          });
          if ('timeout' in ack)
            warnSometimes('handoffs', 'no ack for queue bodies (is the hub older than v1.4?)');
          else if (ack.ok) pending.markSent();
          else note(`queue bodies refused: ${ack.failureMode}: ${ack.message}`);
        }
      }
    } catch (e) {
      note(`handoff tick failed: ${(e as Error).message}`);
    }
    if (!stopped) handoffTimer = setTimeout(handoffTick, handoffInterval);
  };
  if (opts.handoffs) handoffTimer = setTimeout(handoffTick, Math.min(handoffInterval, 3_000));

  return {
    socket,
    async stop() {
      if (handoffTimer) clearTimeout(handoffTimer);
      stopped = true;
      if (timer) clearTimeout(timer);
      if (historyTimer) clearTimeout(historyTimer);
      socket.close();
    },
  };
}
