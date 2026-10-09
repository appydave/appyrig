import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Server } from 'socket.io';
import { io as ioc, type Socket } from 'socket.io-client';
import {
  AUTH_ERRORS,
  FLEET_EVENTS,
  MachineSnapshotSchema,
  TAIL_MAX_LINES,
  type CollectorAck,
  type FleetUpdate,
  type MachineSnapshot,
} from '@appydave/shared';
import { attachCollectorIngest } from './collectorIngest.js';

const SNAPSHOTS = resolve(process.cwd(), '..', 'test/fixtures/snapshots');
const TOKEN = 'test-hub-token-0123456789';
const load = (name: string): MachineSnapshot =>
  JSON.parse(readFileSync(resolve(SNAPSHOTS, `${name}.json`), 'utf8'));

describe('snapshot fixtures satisfy the shared contract', () => {
  for (const file of readdirSync(SNAPSHOTS).filter((f) => f.endsWith('.json'))) {
    it(`${file} parses with MachineSnapshotSchema`, () => {
      const result = MachineSnapshotSchema.safeParse(
        JSON.parse(readFileSync(resolve(SNAPSHOTS, file), 'utf8'))
      );
      expect(result.success, JSON.stringify(result.error?.issues.slice(0, 3))).toBe(true);
    });
  }

  it('rejects a tail longer than TAIL_MAX_LINES', () => {
    const snap = load('roamy');
    const seat = snap.seats.find((s) => s.tail)!;
    seat.tail!.lines = Array.from({ length: TAIL_MAX_LINES + 1 }, () => 'x');
    expect(MachineSnapshotSchema.safeParse(snap).success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    const snap = { ...load('m2'), extra: true };
    expect(MachineSnapshotSchema.safeParse(snap).success).toBe(false);
  });

  it('accepts a stopped seat with no activity key', () => {
    const seat = load('m2').seats[0];
    expect(seat.status).toBe('stopped');
    expect('activity' in seat).toBe(false);
  });
});

describe('collector ingest (P0b skeleton)', () => {
  let http: HttpServer;
  let url: string;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    http = createServer();
    const io = new Server(http);
    attachCollectorIngest(io, { hubToken: TOKEN });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    sockets.splice(0).forEach((s) => s.close());
    await new Promise<void>((r) => http.close(() => r()));
  });

  const connect = (path: string, auth?: object) => {
    const s = ioc(`${url}${path}`, { auth, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    return s;
  };

  it('refuses a collector without the token', async () => {
    const s = connect('/collector', { machineId: 'roamy' });
    const err = await new Promise<Error>((r) => s.on('connect_error', r));
    expect(err.message).toBe(AUTH_ERRORS.collectorToken);
  });

  it('accepts a valid snapshot and broadcasts fleet:update to browsers', async () => {
    const browser = connect('/');
    const first = await new Promise<FleetUpdate>((r) => browser.once(FLEET_EVENTS.UPDATE, r));
    expect(first).toMatchObject({ full: true, machines: [] });

    const update = new Promise<FleetUpdate>((r) => browser.once(FLEET_EVENTS.UPDATE, r));
    const collector = connect('/collector', { token: TOKEN, machineId: 'roamy' });
    const ack = await new Promise<CollectorAck>((r) =>
      collector.emit(FLEET_EVENTS.SNAPSHOT, load('roamy'), r)
    );
    expect(ack.ok).toBe(true);
    const got = await update;
    expect(got.full).toBe(false);
    expect(got.machines[0]).toMatchObject({ machine: { id: 'roamy' }, liveness: 'live' });
  });

  it('refuses an invalid snapshot as data, and a machine mismatch', async () => {
    const collector = connect('/collector', { token: TOKEN, machineId: 'roamy' });
    const bad = await new Promise<CollectorAck>((r) =>
      collector.emit(FLEET_EVENTS.SNAPSHOT, { schemaVersion: 1 }, r)
    );
    expect(bad).toMatchObject({ ok: false, failureMode: 'invalid_snapshot' });
    const mismatch = await new Promise<CollectorAck>((r) =>
      collector.emit(FLEET_EVENTS.SNAPSHOT, load('m2'), r)
    );
    expect(mismatch).toMatchObject({ ok: false, failureMode: 'machine_mismatch' });
  });
});
