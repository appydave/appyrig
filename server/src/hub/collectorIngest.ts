import type { Namespace, Server } from 'socket.io';
import {
  AUTH_ERRORS,
  FLEET_EVENTS,
  HUB_CAPS,
  MachineSnapshotSchema,
  SeatHistorySchema,
  HandoffBodiesSchema,
  RigFilesPushSchema,
  SchemaPushSchema,
  SeatLoadoutSchema,
  DbRowsPushSchema,
  DaemonDataPushSchema,
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
    // Tell the collector what this hub understands before its first push (the ack repeats it).
    socket.emit(FLEET_EVENTS.CAPS, [HUB_CAPS.V2_FIELDS, HUB_CAPS.DAEMONDATA]);
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
      // caps: what this hub understands beyond v1.5; an older hub sends none (see HUB_CAPS)
      reply({
        ok: true,
        receivedAt: entry.lastSeen,
        caps: [HUB_CAPS.V2_FIELDS, HUB_CAPS.DAEMONDATA],
      });
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

    // v1.4 · S4: queue message bodies, sent once each. Same checks as a history.
    socket.on(FLEET_EVENTS.HANDOFFS, (raw, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      const parsed = HandoffBodiesSchema.safeParse(raw);
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
          message: `socket authenticated as ${machineId}, queue bodies are for ${parsed.data.machineId}`,
        });
        return;
      }
      opts.store.putHandoffs(parsed.data);
      reply({ ok: true, receivedAt: new Date().toISOString() });
    });

    // v1.4 · S7: a chunk of one rig's files, and the OpenRig database shape. Same checks as the others.
    const guarded =
      (
        schema: {
          safeParse: (
            raw: unknown
          ) =>
            | { success: true; data: { machineId: string } }
            | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
        },
        what: string,
        store: (data: never) => void
      ) =>
      (raw: unknown, ack: unknown) => {
        const reply = typeof ack === 'function' ? (ack as (a: unknown) => void) : () => {};
        const parsed = schema.safeParse(raw);
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
            message: `socket authenticated as ${machineId}, ${what} is for ${parsed.data.machineId}`,
          });
          return;
        }
        store(parsed.data as never);
        reply({ ok: true, receivedAt: new Date().toISOString() });
      };
    socket.on(
      FLEET_EVENTS.RIGFILES,
      guarded(RigFilesPushSchema, 'rig files', (d) => opts.store.rigFiles.put(d))
    );
    socket.on(
      FLEET_EVENTS.SCHEMA,
      guarded(SchemaPushSchema, 'database schema', (d) => opts.store.schemas.put(d))
    );
    // v1.5 · L1: one seat's loadout (Debug view). Same checks as the others.
    socket.on(
      FLEET_EVENTS.LOADOUT,
      guarded(SeatLoadoutSchema, 'loadout', (d) => opts.store.loadouts.put(d))
    );
    // Batch 1 · B5: one table's newest rows (read-only). Same checks as the others.
    socket.on(
      FLEET_EVENTS.DBROWS,
      guarded(DbRowsPushSchema, 'database rows', (d) => opts.store.dbRows.put(d))
    );
    // v2 data channels: one kind of read-only OpenRig daemon data. Same checks as the others.
    socket.on(
      FLEET_EVENTS.DAEMONDATA,
      guarded(DaemonDataPushSchema, 'daemon data', (d) => opts.store.daemonData.put(d))
    );
  });
}
