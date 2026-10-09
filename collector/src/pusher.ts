import { io as connect, type Socket } from 'socket.io-client';
import {
  FLEET_EVENTS,
  PUSH_INTERVAL_MS,
  SOCKET_NAMESPACES,
  type CollectorAck,
  type CollectorAuth,
  type MachineSnapshot,
} from '@appydave/shared';

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
}

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

  socket.on('connect', () => note(`connected to ${opts.hubUrl} as ${opts.machineId}`));
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

  return {
    socket,
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      socket.close();
    },
  };
}
