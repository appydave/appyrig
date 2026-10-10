import type { Namespace, Server } from 'socket.io';
import {
  AUTH_ERRORS,
  FLEET_EVENTS,
  MachineSnapshotSchema,
  SeatHistorySchema,
  SOCKET_NAMESPACES,
  type CollectorAck,
  type CollectorAuth,
  type CollectorClientToServerEvents,
  type CollectorServerToClientEvents,
  type FleetMachine,
} from '@appydave/shared';
import { sameSecret } from './browserAuth.js';
import type { FleetStore } from './fleetStore.js';

/**
 * The hub's collector seam: the `/collector` namespace. Token check at connect, Zod validation
 * of every snapshot, a machine-id check against the handshake, then the store. Refusals are acks
 * with a failureMode, never throws. The hub has no adapters: it only ingests validated snapshots.
 */

export interface CollectorIngestOptions {
  /** Hub token. When undefined, every collector is refused (no open default). */
  hubToken: string | undefined;
  store: FleetStore;
  /** Called with the stored entry after every accepted snapshot. */
  onSnapshot: (machine: FleetMachine) => void;
}

export function attachCollectorIngest(io: Server, opts: CollectorIngestOptions): void {
  const nsp = io.of(SOCKET_NAMESPACES.COLLECTOR) as unknown as Namespace<
    CollectorClientToServerEvents,
    CollectorServerToClientEvents
  >;

  nsp.use((socket, next) => {
    const auth = socket.handshake.auth as Partial<CollectorAuth>;
    if (!opts.hubToken || !sameSecret(auth.token, opts.hubToken)) {
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
      const entry = opts.store.put(parsed.data);
      opts.onSnapshot(entry);
      reply({ ok: true, receivedAt: entry.lastSeen });
    });

    // v1.2: one seat's history (replay consoles). Same checks as a snapshot.
    socket.on(FLEET_EVENTS.HISTORY, (raw, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const parsed = SeatHistorySchema.safeParse(raw);
      if (!parsed.success) {
        reply({
          ok: false,
          failureMode: 'invalid_snapshot',
          message: parsed.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        });
        return;
      }
      if (parsed.data.machineId !== machineId) {
        reply({
          ok: false,
          failureMode: 'machine_mismatch',
          message: `socket authenticated as ${machineId}, history is for ${parsed.data.machineId}`,
        });
        return;
      }
      opts.store.putHistory(parsed.data);
      reply({ ok: true, receivedAt: new Date().toISOString() });
    });
  });
}
