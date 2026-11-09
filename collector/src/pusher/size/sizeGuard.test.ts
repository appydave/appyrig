import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { HUB_MAX_BUFFER, type CollectorAck, type MachineSnapshot } from '@appydave/shared';
import { buildSnapshot } from '@collector/builder.js';
import { fixtureSources } from '@collector/adapters/fixtureSources.js';
import { CHANNEL_PAYLOAD_MAX, startPusher, type Pusher } from '@collector/pusher.js';
import { pushHandoffs, pushHistories } from '@collector/pusher/ticks.js';

/**
 * A push over the hub's socket.io limit makes the hub drop the connection, the collector reconnects
 * and builds the same push again. These run against a real socket.io server at the hub's real limit.
 */

const cfg = { machine: { id: 'roamy', label: 'Roamy', hostname: null }, version: 't', pid: null };
const build = () => buildSnapshot(fixtureSources({ machine: 'roamy' }), cfg);
const ack: CollectorAck = { ok: true, receivedAt: '2026-11-09T00:00:00.000Z' };
const LIMIT_LINE = 'a payload over 800 KB was not sent';
const OVER_HUB_LIMIT = HUB_MAX_BUFFER + 1024;

/** Valid in shape and over the hub's limit in bytes: the size guard looks at bytes only. */
const oversize = (s: MachineSnapshot): MachineSnapshot => ({
  ...s,
  machine: { ...s.machine, label: 'x'.repeat(OVER_HUB_LIMIT) },
});

let pusher: Pusher | undefined;
let http: HttpServer | undefined;
let io: Server | undefined;

afterEach(async () => {
  await pusher?.stop();
  await io?.close();
  http?.close();
  pusher = undefined;
});

async function realHub() {
  http = createServer();
  io = new Server(http, { maxHttpBufferSize: HUB_MAX_BUFFER });

  const seen = { connections: 0, snapshots: 0 };

  io.of('/collector').on('connection', (socket) => {
    seen.connections++;
    socket.on('collector:snapshot', (_raw, reply: (a: CollectorAck) => void) => {
      seen.snapshots++;
      reply(ack);
    });
  });
  await new Promise<void>((r) => http!.listen(0, '127.0.0.1', r));

  return { url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`, seen };
}

describe('Feature: the size guard on every push', () => {
  it('Scenario: given a snapshot over the limit, when it is built, then it is refused in the log, not sent, and the connection stays', async () => {
    const hub = await realHub();
    const lines: string[] = [];
    let builds = 0;

    pusher = startPusher({
      hubUrl: hub.url,
      token: 't',
      machineId: 'roamy',
      intervalMs: 30,
      capsWaitMs: 0,
      log: (l) => lines.push(l),
      build: async () => {
        builds++;

        return builds <= 4 ? oversize(await build()) : build();
      },
    });

    await vi.waitFor(() => expect(hub.seen.snapshots).toBeGreaterThan(0), { timeout: 8000 });

    expect(hub.seen.connections).toBe(1);
    expect(lines.filter((l) => l.startsWith('disconnected'))).toEqual([]);
    expect(lines).toContain(`snapshot: ${LIMIT_LINE}`);
    // the line that follows says it recovered, so the log never ends on a state that has passed
    expect(lines.at(-1)).toContain('acked by hub');
  }, 12_000);

  it('Scenario: given a snapshot exactly at the limit, then it is sent', async () => {
    const hub = await realHub();
    const base = await build();
    const room = CHANNEL_PAYLOAD_MAX - Buffer.byteLength(JSON.stringify(base));
    const atLimit = { ...base, machine: { ...base.machine, label: 'x'.repeat(room + 5) } };

    pusher = startPusher({
      hubUrl: hub.url,
      token: 't',
      machineId: 'roamy',
      intervalMs: 30,
      capsWaitMs: 0,
      log: () => {},
      build: async () => atLimit,
    });

    await vi.waitFor(() => expect(hub.seen.snapshots).toBeGreaterThan(0), { timeout: 8000 });
    expect(Buffer.byteLength(JSON.stringify(atLimit))).toBe(CHANNEL_PAYLOAD_MAX);
  }, 12_000);

  it('Scenario: given one seat history over the limit, then it alone is held back and the next seat still goes', async () => {
    const push = vi.fn(async () => ack);
    const warned: string[] = [];
    const big = {
      markSent: vi.fn(),
      history: { seat: 'big@r', pad: 'x'.repeat(CHANNEL_PAYLOAD_MAX) },
    };
    const small = { markSent: vi.fn(), history: { seat: 'small@r' } };

    await pushHistories({
      histories: async () => [big, small] as never,
      push,
      log: { note: () => {}, warnSometimes: (_key, line) => warned.push(line) },
    });

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(small.history);
    expect(big.markSent).not.toHaveBeenCalled();
    expect(small.markSent).toHaveBeenCalledTimes(1);
    expect(warned).toEqual([`history of big@r: ${LIMIT_LINE}`]);
  });

  it('Scenario: given a queue-body batch over the limit, then it is not sent, not marked sent, and it says so', async () => {
    const push = vi.fn(async () => ack);
    const warned: string[] = [];
    const markSent = vi.fn();

    await pushHandoffs({
      handoffs: async () =>
        ({
          machineId: 'roamy',
          bodies: { pad: 'x'.repeat(CHANNEL_PAYLOAD_MAX) },
          markSent,
        }) as never,
      push,
      log: { note: () => {}, warnSometimes: (_k, line) => warned.push(line) },
    });

    expect(push).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
    expect(warned).toEqual([`queue bodies: ${LIMIT_LINE}`]);
  });
});
