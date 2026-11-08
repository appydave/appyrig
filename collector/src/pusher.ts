import { io as connect, type Socket } from 'socket.io-client';
import {
  FLEET_EVENTS,
  HUB_CAPS,
  namesV2Key,
  stripSpecFields,
  stripV2Fields,
  PUSH_INTERVAL_MS,
  SOCKET_NAMESPACES,
  type CollectorAuth,
  type MachineSnapshot,
  type SeatHistory,
} from '@appydave/shared';
import type { PendingHistory } from './adapters/history.js';
import type { PendingHandoffs } from './adapters/handoffs.js';
import { errorMessage } from '@collector/adapters/narrow/errors.js';
import { emitAcked } from '@collector/pusher/emitAcked.js';
import { startChannel, type ChannelDeps } from '@collector/pusher/channel.js';
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
  // What the connected hub advertised in its last snapshot ack (HUB_CAPS). Nothing until the first
  // ack, and forgotten on every (re)connect: a restarted hub may be an older build. With no
  // V2_FIELDS cap the snapshot goes out in exactly the v1.5 shape.
  let hubCaps = new Set<string>();
  // Belt and braces: a hub that refused a snapshot naming a v2 key is treated as v1.5 until reconnect.
  let forceV15 = false;
  // The hub says what it understands as soon as we connect (`hub:caps`); the first push waits briefly
  // for it so v2 fields do not vanish for one push after every reconnect. An older hub never says,
  // so the wait ends after capsWaitMs and its first snapshot goes out as v1.5.
  let capsSeen = false;
  let capsWaiter: (() => void) | undefined;
  const capsWaitMs = opts.capsWaitMs ?? 1000;

  socket.on(FLEET_EVENTS.CAPS, (caps: unknown) => {
    if (Array.isArray(caps)) {
      hubCaps = new Set(caps.filter((c): c is string => typeof c === 'string'));
    }

    capsSeen = true;
    capsWaiter?.();
  });

  const waitForCaps = () =>
    capsSeen || capsWaitMs <= 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const t = setTimeout(resolve, capsWaitMs);

          capsWaiter = () => {
            clearTimeout(t);
            resolve();
          };
        }).then(() => {
          capsSeen = true; // waited once for this connection
          capsWaiter = undefined;
        });
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
    hubCaps = new Set();
    forceV15 = false;
    capsSeen = false;
    opts.onConnect?.();
    note(`connected to ${opts.hubUrl} as ${opts.machineId}`);
  });
  socket.on('disconnect', (reason) => note(`disconnected: ${reason}`));
  socket.on('connect_error', (err) => note(`hub refused or unreachable: ${err.message}`));

  // A missing ack is a timeout, not a refusal: kept apart from the hub's own failure modes.
  const push = (snapshot: MachineSnapshot) =>
    emitAcked(socket.timeout(ackTimeout), FLEET_EVENTS.SNAPSHOT, snapshot);

  const tick = async () => {
    if (stopped) {
      return;
    }

    try {
      if (socket.connected) {
        await waitForCaps();

        const built = await opts.build();
        const sendV2 = hubCaps.has(HUB_CAPS.V2_FIELDS) && !forceV15;
        const sendSpec = hubCaps.has(HUB_CAPS.SPEC_FIELDS) && !forceV15;
        const v2 = sendV2 ? built : stripV2Fields(built);
        const ack = await push(sendSpec ? v2 : stripSpecFields(v2));

        if (!('timeout' in ack) && ack.ok) {
          hubCaps = new Set(ack.caps ?? []);
        }

        if (!('timeout' in ack) && !ack.ok && (sendV2 || sendSpec) && namesV2Key(ack.message)) {
          forceV15 = true;
          hubCaps = new Set();
          log('hub refused a v2 snapshot field: sending the v1.5 shape until it reconnects');
        }

        note(
          'timeout' in ack
            ? `no ack from hub within ${ackTimeout}ms`
            : ack.ok
              ? `pushing every ${intervalMs}ms: acked by hub`
              : `snapshot refused: ${ack.failureMode}: ${ack.message}`
        );
      }
    } catch (e) {
      note(`tick failed: ${errorMessage(e)}`);
    }

    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
    }
  };

  void tick();

  // Seat histories: one emit per changed seat, marked sent only when the hub accepts it.
  let historyTimer: NodeJS.Timeout | undefined;
  const historyInterval = opts.historyIntervalMs ?? HISTORY_INTERVAL_MS;
  const pushHistory = (h: SeatHistory) =>
    emitAcked(socket.timeout(ackTimeout * 2), FLEET_EVENTS.HISTORY, h);
  const historyTick = async () => {
    if (stopped || !opts.histories) {
      return;
    }

    try {
      if (socket.connected) {
        for (const p of await opts.histories()) {
          const ack = await pushHistory(p.history);

          if ('timeout' in ack) {
            note(`no ack for history of ${p.history.seat}`);
          } else if (ack.ok) {
            p.markSent();
          } else {
            note(`history refused for ${p.history.seat}: ${ack.failureMode}: ${ack.message}`);
          }
        }
      }
    } catch (e) {
      note(`history tick failed: ${errorMessage(e)}`);
    }

    if (!stopped) {
      historyTimer = setTimeout(historyTick, historyInterval);
    }
  };

  // First history round shortly after the first snapshot, so known seats exist.
  if (opts.histories) {
    historyTimer = setTimeout(historyTick, Math.min(historyInterval, 5_000));
  }

  // Queue bodies: one batch per tick, marked sent only when the hub accepts it. An older hub has
  // no listener for this event, so no ack comes back: noted as a timeout, retried next tick.
  let handoffTimer: NodeJS.Timeout | undefined;
  const handoffInterval = opts.handoffIntervalMs ?? HANDOFF_INTERVAL_MS;
  const handoffTick = async () => {
    if (stopped || !opts.handoffs) {
      return;
    }

    try {
      if (socket.connected) {
        const pending = await opts.handoffs();

        if (pending) {
          const ack = await emitAcked(
            socket.timeout(ackTimeout * 2),
            FLEET_EVENTS.HANDOFFS,
            pending.bodies
          );

          if ('timeout' in ack) {
            warnSometimes('handoffs', 'no ack for queue bodies (is the hub older than v1.4?)');
          } else if (ack.ok) {
            pending.markSent();
          } else {
            note(`queue bodies refused: ${ack.failureMode}: ${ack.message}`);
          }
        }
      }
    } catch (e) {
      note(`handoff tick failed: ${errorMessage(e)}`);
    }

    if (!stopped) {
      handoffTimer = setTimeout(handoffTick, handoffInterval);
    }
  };

  if (opts.handoffs) {
    handoffTimer = setTimeout(handoffTick, Math.min(handoffInterval, 3_000));
  }

  // v1.4 · S7: rig files (chunked, so no message nears socket.io's 1 MB limit) and the database
  // shape. Same rules as queue bodies: marked sent only when the hub accepts, retried otherwise,
  // and an older hub (no listener, no ack) is warned about at most every 10 minutes.
  const sendAcked = (event: string, payload: unknown) =>
    emitAcked(socket.timeout(ackTimeout * 2), event, payload);
  const timers: NodeJS.Timeout[] = [];
  const deps: ChannelDeps = {
    isStopped: () => stopped,
    connected: () => socket.connected,
    hubCaps: () => hubCaps,
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

      if (handoffTimer) {
        clearTimeout(handoffTimer);
      }

      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }

      if (historyTimer) {
        clearTimeout(historyTimer);
      }

      socket.close();
    },
  };
}
