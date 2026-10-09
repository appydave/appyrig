import { timingSafeEqual } from 'node:crypto';
import type { Namespace, Server } from 'socket.io';
import {
  AUTH_ERRORS,
  FLEET_EVENTS,
  MachineSnapshotSchema,
  SOCKET_NAMESPACES,
  type CollectorAck,
  type CollectorAuth,
  type CollectorClientToServerEvents,
  type CollectorServerToClientEvents,
  type FleetMachine,
} from '@appydave/shared';

/**
 * P0b skeleton of the hub's collector seam: token check, Zod validation, last snapshot per
 * machine in memory, and a `fleet:update` broadcast to browsers. The hub lane (P3) owns the real
 * version: disk store, liveness timer, browser auth. Keep this signature or replace it whole.
 */

function tokensMatch(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || given.length === 0) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface CollectorIngestOptions {
  /** Hub token. When undefined, every collector is refused (no open default). */
  hubToken: string | undefined;
  now?: () => Date;
  onSnapshot?: (machine: FleetMachine) => void;
}

export function attachCollectorIngest(io: Server, opts: CollectorIngestOptions) {
  const now = opts.now ?? (() => new Date());
  const machines = new Map<string, FleetMachine>();
  const nsp = io.of(SOCKET_NAMESPACES.COLLECTOR) as unknown as Namespace<
    CollectorClientToServerEvents,
    CollectorServerToClientEvents
  >;

  // Every browser gets the whole fleet on connect; after that, only changed machines.
  io.of(SOCKET_NAMESPACES.BROWSER).on('connection', (socket) => {
    socket.emit(FLEET_EVENTS.UPDATE, {
      generatedAt: now().toISOString(),
      full: true,
      machines: [...machines.values()],
    });
  });

  nsp.use((socket, next) => {
    const auth = socket.handshake.auth as Partial<CollectorAuth>;
    if (!opts.hubToken || !tokensMatch(auth.token, opts.hubToken)) {
      next(new Error(AUTH_ERRORS.collectorToken));
      return;
    }
    next();
  });

  nsp.on('connection', (socket) => {
    const machineId = (socket.handshake.auth as CollectorAuth).machineId;
    socket.on(FLEET_EVENTS.SNAPSHOT, (raw, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const parsed = MachineSnapshotSchema.safeParse(raw);
      if (!parsed.success) {
        const result: CollectorAck = {
          ok: false,
          failureMode: 'invalid_snapshot',
          message: parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        };
        reply(result);
        return;
      }
      if (parsed.data.machine.id !== machineId) {
        reply({
          ok: false,
          failureMode: 'machine_mismatch',
          message: `socket authenticated as ${machineId}, snapshot is for ${parsed.data.machine.id}`,
        });
        return;
      }
      const receivedAt = now().toISOString();
      const entry: FleetMachine = {
        machine: parsed.data.machine,
        liveness: 'live',
        lastSeen: receivedAt,
        snapshot: parsed.data,
      };
      machines.set(entry.machine.id, entry);
      io.of(SOCKET_NAMESPACES.BROWSER).emit(FLEET_EVENTS.UPDATE, {
        generatedAt: receivedAt,
        full: false,
        machines: [entry],
      });
      opts.onSnapshot?.(entry);
      reply({ ok: true, receivedAt });
    });
  });

  return {
    machines: () => [...machines.values()],
  };
}
