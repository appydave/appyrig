import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { MachineSnapshotSchema, type CollectorAck, type MachineSnapshot } from '@appydave/shared';
import { buildSnapshot } from './builder.js';
import { fixtureSources } from './adapters/fixtureSources.js';
import { loadSettings } from './config.js';
import { startPusher, type Pusher } from './pusher.js';

const TOKEN = 'test-token-0123456789';
const cfg = { machine: { id: 'roamy', label: 'Roamy', hostname: null }, version: 't', pid: null };

interface Hub {
  url: string;
  received: MachineSnapshot[];
  /** Payloads of the v1.4 channels, when the fake hub listens for them (`modern`). */
  extra: { event: string; payload: unknown }[];
  close(): Promise<void>;
}

async function startHub(port = 0, modern = false): Promise<Hub> {
  const http: HttpServer = createServer();
  const io = new Server(http);
  const received: MachineSnapshot[] = [];
  const extra: { event: string; payload: unknown }[] = [];
  io.of('/collector')
    .use((s, next) =>
      s.handshake.auth.token === TOKEN
        ? next()
        : next(new Error('collector token missing or invalid'))
    )
    .on('connection', (socket) => {
      if (modern)
        for (const event of ['collector:rigfiles', 'collector:schema'])
          socket.on(event, (payload, ack: (a: CollectorAck) => void) => {
            extra.push({ event, payload });
            ack({ ok: true, receivedAt: new Date().toISOString() });
          });
      socket.on('collector:snapshot', (raw, ack: (a: CollectorAck) => void) => {
        const r = MachineSnapshotSchema.safeParse(raw);
        if (r.success) received.push(r.data);
        ack(
          r.success
            ? { ok: true, receivedAt: new Date().toISOString() }
            : { ok: false, failureMode: 'invalid_snapshot', message: 'bad' }
        );
      });
    });
  await new Promise<void>((r) => http.listen(port, '127.0.0.1', r));
  const actual = (http.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${actual}`,
    received,
    extra,
    close: () =>
      new Promise<void>((r) => {
        void io.close(() => r());
      }),
  };
}

const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

let hub: Hub | undefined;
let pusher: Pusher | undefined;
afterEach(async () => {
  await pusher?.stop();
  await hub?.close();
  pusher = hub = undefined;
});

const build = () => buildSnapshot(fixtureSources({ machine: 'roamy' }), cfg);

describe('pusher', () => {
  it('pushes valid snapshots to the hub repeatedly', async () => {
    hub = await startHub();
    const log: string[] = [];
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build,
      intervalMs: 50,
      log: (l) => log.push(l),
    });
    await until(() => hub!.received.length >= 3);
    expect(hub.received.every((s) => s.machine.id === 'roamy' && s.seats.length === 7)).toBe(true);
    expect(log.filter((l) => l.startsWith('connected'))).toHaveLength(1);
    // state-change logging: not one line per push
    expect(log.length).toBeLessThan(4);
  });

  it('a wrong token is refused and nothing is pushed', async () => {
    hub = await startHub();
    const log: string[] = [];
    pusher = startPusher({
      hubUrl: hub.url,
      token: 'wrong',
      machineId: 'roamy',
      build,
      intervalMs: 50,
      log: (l) => log.push(l),
    });
    await until(() => log.some((l) => /refused or unreachable.*token/.test(l)));
    await new Promise((r) => setTimeout(r, 200));
    expect(hub.received).toHaveLength(0);
  });

  it('a hub that never acks is logged as a timeout, not a refusal', async () => {
    const http = createServer();
    const io = new Server(http);
    io.of('/collector').on('connection', (socket) => socket.on('collector:snapshot', () => {}));
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const log: string[] = [];
    pusher = startPusher({
      hubUrl: url,
      token: TOKEN,
      machineId: 'roamy',
      build,
      intervalMs: 50,
      ackTimeoutMs: 100,
      log: (l) => log.push(l),
    });
    try {
      await until(() => log.some((l) => /no ack from hub within 100ms/.test(l)));
      expect(log.join('\n')).not.toMatch(/refused: invalid_snapshot/);
    } finally {
      await pusher.stop();
      pusher = undefined;
      await new Promise<void>((r) => {
        void io.close(() => r());
      });
    }
  });

  it('reconnects after the hub restarts and keeps pushing', async () => {
    hub = await startHub();
    const port = Number(new URL(hub.url).port);
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build,
      intervalMs: 50,
      log: () => {},
    });
    await until(() => hub!.received.length >= 1);
    await hub.close();
    hub = await startHub(port);
    await until(() => hub!.received.length >= 1, 15_000);
  }, 20_000);

  it('calls onConnect on every (re)connect, so queue bodies can go out again after a hub restart', async () => {
    hub = await startHub();
    const port = Number(new URL(hub.url).port);
    let connects = 0;
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build,
      intervalMs: 50,
      log: () => {},
      onConnect: () => {
        connects += 1;
      },
    });
    await until(() => connects === 1);
    await hub.close();
    hub = await startHub(port);
    await until(() => connects === 2, 15_000);
  }, 20_000);

  it('logs the missing queue-body ack once, not every tick, against a hub that has no listener for it', async () => {
    hub = await startHub(); // this fake hub only answers snapshots: like a pre-1.4 hub
    const lines: string[] = [];
    let batches = 0;
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build,
      intervalMs: 30,
      ackTimeoutMs: 20,
      handoffIntervalMs: 30,
      log: (l) => lines.push(l),
      handoffs: async () => {
        batches++;
        return {
          bodies: { machineId: 'roamy', collectedAt: new Date().toISOString(), items: [] },
          markSent: () => {},
        };
      },
    });
    await until(() => batches >= 4, 10_000);
    expect(lines.filter((l) => l.includes('no ack for queue bodies'))).toHaveLength(1);
  }, 15_000);

  it('sends rig files and the database shape on their own channels, once each, after the hub accepts them', async () => {
    hub = await startHub(0, true);
    let fileTakes = 0;
    let marked = 0;
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build,
      intervalMs: 50,
      log: () => {},
      rigFilesIntervalMs: 40,
      schemaIntervalMs: 40,
      rigFiles: async () => {
        fileTakes++;
        return marked === 0
          ? {
              pushes: [
                {
                  machineId: 'roamy',
                  collectedAt: new Date().toISOString(),
                  rig: 'r',
                  replace: true,
                  files: [],
                },
                {
                  machineId: 'roamy',
                  collectedAt: new Date().toISOString(),
                  rig: 'r',
                  replace: false,
                  files: [],
                },
              ],
              markSent: () => {
                marked++;
              },
            }
          : null;
      },
      schema: async () => null,
    });
    await until(() => marked === 1);
    expect(hub.extra.filter((e) => e.event === 'collector:rigfiles')).toHaveLength(2); // both chunks, in order
    await new Promise((r) => setTimeout(r, 200));
    expect(marked).toBe(1);
    expect(fileTakes).toBeGreaterThan(1); // it kept asking, and got nothing new
  }, 15_000);

  it('against a hub with no listener for them, nothing is marked sent and the warning is logged once', async () => {
    hub = await startHub(); // like a pre-1.4 hub
    const lines: string[] = [];
    let marked = 0;
    let takes = 0;
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build,
      intervalMs: 30,
      ackTimeoutMs: 20,
      log: (l) => lines.push(l),
      rigFilesIntervalMs: 30,
      rigFiles: async () => {
        takes++;
        return {
          pushes: [
            {
              machineId: 'roamy',
              collectedAt: new Date().toISOString(),
              rig: 'r',
              replace: true,
              files: [],
            },
          ],
          markSent: () => {
            marked++;
          },
        };
      },
    });
    await until(() => takes >= 3, 10_000);
    expect(marked).toBe(0);
    expect(lines.filter((l) => l.includes('no ack for rig files'))).toHaveLength(1);
  }, 15_000);

  it('does not overlap ticks when a build is slow', async () => {
    hub = await startHub();
    let running = 0;
    let max = 0;
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      intervalMs: 10,
      log: () => {},
      build: async () => {
        running++;
        max = Math.max(max, running);
        await new Promise((r) => setTimeout(r, 60));
        running--;
        return build();
      },
    });
    await until(() => hub!.received.length >= 3);
    expect(max).toBe(1);
  });
});

describe('settings', () => {
  const env = {
    APPYRIG_HUB_URL: 'http://100.126.70.25:7191/',
    APPYRIG_MACHINE_ID: 'm2',
    APPYRIG_TOKEN_FILE: '/t',
  };
  it('reads the token file and normalises the hub url', () => {
    const s = loadSettings(env, () => `${TOKEN}\n`);
    expect(s).toMatchObject({ hubUrl: 'http://100.126.70.25:7191', token: TOKEN });
    expect(s.machine).toMatchObject({ id: 'm2', label: 'M2' });
  });
  it('names the missing setting', () => {
    expect(() => loadSettings({ ...env, APPYRIG_HUB_URL: '' }, () => 'x')).toThrow(
      /APPYRIG_HUB_URL/
    );
    expect(() => loadSettings(env, () => '  \n')).toThrow(/token/);
    expect(() => loadSettings({ ...env, APPYRIG_MACHINE_ID: 'M 2' }, () => 'x')).toThrow(/slug/);
  });
});
