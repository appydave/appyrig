import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import {
  HUB_CAPS,
  MachineSnapshotSchema,
  SPEC_RIG_KEYS,
  V2_QUEUE_KEYS,
  V2_SEAT_KEYS,
  type CollectorAck,
  type MachineSnapshot,
} from '@appydave/shared';
import { buildSnapshot } from './builder.js';
import { fixtureSources } from './adapters/fixtureSources.js';
import { loadSettings } from './config.js';
import { CHANNEL_PAYLOAD_MAX, startPusher, type Pusher } from './pusher.js';

const TOKEN = 'test-token-0123456789';
const cfg = { machine: { id: 'roamy', label: 'Roamy', hostname: null }, version: 't', pid: null };

interface Hub {
  url: string;
  received: MachineSnapshot[];
  /** Payloads of the v1.4 channels, when the fake hub listens for them (`modern`). */
  extra: { event: string; payload: unknown }[];
  close(): Promise<void>;
}

interface HubOpts {
  /** What the fake hub advertises in each snapshot ack (an old hub: nothing). */
  caps?: string[];
  /** Refuse any snapshot carrying a v2-only key, like a strict v1.5 hub ("Unrecognized key"). */
  strictV15?: boolean;
  /** Refuse any snapshot carrying a spec-only rig key, like today's hub (before spec-fields). */
  strictPreSpec?: boolean;
  /** Do not announce caps on connection (only in the ack), like the first v2 hub build. */
  ackOnly?: boolean;
}

async function startHub(port = 0, modern = false, hopts: HubOpts = {}): Promise<Hub> {
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
      if (hopts.caps && !hopts.ackOnly) socket.emit('hub:caps', hopts.caps);
      if (modern)
        for (const event of [
          'collector:rigfiles',
          'collector:schema',
          'collector:daemondata',
          'collector:missionfiles',
        ])
          socket.on(event, (payload, ack: (a: CollectorAck) => void) => {
            extra.push({ event, payload });
            ack({ ok: true, receivedAt: new Date().toISOString() });
          });
      socket.on('collector:snapshot', (raw, ack: (a: CollectorAck) => void) => {
        if (hopts.strictV15) {
          const bad = [...V2_SEAT_KEYS, ...V2_QUEUE_KEYS].find((k) =>
            JSON.stringify(raw).includes(`"${k}"`)
          );
          if (bad) {
            ack({
              ok: false,
              failureMode: 'invalid_snapshot',
              message: `seats.0: Unrecognized key: "${bad}"`,
            });
            return;
          }
        }
        if (hopts.strictPreSpec) {
          const bad = SPEC_RIG_KEYS.find((k) => JSON.stringify(raw).includes(`"${k}"`));
          if (bad) {
            ack({
              ok: false,
              failureMode: 'invalid_snapshot',
              message: `rigs.0: Unrecognized key: "${bad}"`,
            });
            return;
          }
        }
        const r = MachineSnapshotSchema.safeParse(raw);
        if (r.success) received.push(r.data);
        ack(
          r.success
            ? {
                ok: true,
                receivedAt: new Date().toISOString(),
                ...(hopts.caps ? { caps: hopts.caps } : {}),
              }
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

  // The live daemon always sends the attach line and closure fields, so omit-when-unknown never
  // protects an older strict hub: the pusher sends v2 keys only to a hub that advertised them.
  const withV2 = async (): Promise<MachineSnapshot> => {
    const snap = await build();
    return {
      ...snap,
      seats: snap.seats.map((x) => ({ ...x, tmuxAttachCommand: 'tmux attach -t x' })),
      queue: snap.queue.map((q) => ({ ...q, closureReason: 'no-follow-on', tier: 'fast' })),
    };
  };
  const hasV2 = (s: MachineSnapshot) =>
    s.seats.some((x) => 'tmuxAttachCommand' in x) || s.queue.some((q) => 'closureReason' in q);

  it('H1: a new collector with v2 fields present is accepted by an OLD strict hub (no caps), and sends them bare', async () => {
    hub = await startHub(0, false, { strictV15: true });
    const lines: string[] = [];
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build: withV2,
      intervalMs: 30,
      log: (l) => lines.push(l),
    });
    await until(() => hub!.received.length >= 4);
    expect(hub.received.some(hasV2)).toBe(false);
    expect(lines.filter((l) => l.includes('refused'))).toEqual([]);
  });

  it('H1: caps learned only from the ack: the first snapshot is bare, v2 fields follow', async () => {
    hub = await startHub(0, false, {
      ackOnly: true,
      caps: [HUB_CAPS.V2_FIELDS, HUB_CAPS.DAEMONDATA],
    });
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build: withV2,
      intervalMs: 30,
      log: () => {},
    });
    await until(() => hub!.received.length >= 4);
    // the first snapshot goes out before the hub has said what it understands: the safe shape
    expect(hasV2(hub.received[0]!)).toBe(false);
    expect(hub.received.slice(1).every(hasV2)).toBe(true);
  });

  it('flicker: a hub that announces its caps on connection gets v2 fields from the very first push, on every reconnect', async () => {
    hub = await startHub(0, false, {
      caps: [HUB_CAPS.V2_FIELDS, HUB_CAPS.DAEMONDATA],
    });
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build: withV2,
      intervalMs: 30,
      log: () => {},
    });
    await until(() => hub!.received.length >= 2);
    expect(hub.received.every(hasV2)).toBe(true);
    // a reconnect: the caps are forgotten and announced again before the first push
    pusher.socket.disconnect().connect();
    const before = hub.received.length;
    await until(() => hub!.received.length >= before + 3);
    expect(hub.received.every(hasV2)).toBe(true);
  });

  it('flicker: an older hub never announces, so the first push waits only capsWaitMs and goes out as v1.5', async () => {
    hub = await startHub(0, false, { strictV15: true });
    const t0 = Date.now();
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build: withV2,
      intervalMs: 30,
      capsWaitMs: 250,
      log: () => {},
    });
    await until(() => hub!.received.length >= 1);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(240);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(hub.received.some(hasV2)).toBe(false);
  });

  it('H1: a hub that refuses a snapshot naming a v2 key is treated as v1.5 until it reconnects, logged once', async () => {
    // advertises the cap but its schema does not know the key (a mis-advertising or mid-upgrade hub)
    hub = await startHub(0, false, { strictV15: true, caps: [HUB_CAPS.V2_FIELDS] });
    const lines: string[] = [];
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build: withV2,
      intervalMs: 30,
      log: (l) => lines.push(l),
    });
    await until(() => hub!.received.length >= 5);
    expect(hub.received.some(hasV2)).toBe(false);
    expect(lines.filter((l) => l.includes('sending the v1.5 shape'))).toHaveLength(1);
  });

  // Spec fields (pods, spec edges, from rig.yaml) ride the same rule: only to a hub that said so.
  const withSpec = async (): Promise<MachineSnapshot> => {
    const snap = await withV2();
    return {
      ...snap,
      rigs: snap.rigs.map((r) => ({
        ...r,
        specValid: true,
        pods: [{ id: 'dev', label: 'Development', members: ['build'] }],
        specEdges: [],
      })),
    };
  };
  const hasSpec = (s: MachineSnapshot) => s.rigs.some((r) => 'pods' in r || 'specValid' in r);

  it("spec fields: today's hub (v2 caps, no spec-fields) gets none of them and refuses nothing", async () => {
    hub = await startHub(0, false, { strictPreSpec: true, caps: [HUB_CAPS.V2_FIELDS] });
    const lines: string[] = [];
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build: withSpec,
      intervalMs: 30,
      log: (l) => lines.push(l),
    });
    await until(() => hub!.received.length >= 4);
    expect(hub.received.some(hasSpec)).toBe(false);
    // v2 fields still flow: the spec gate is its own
    expect(hub.received.every(hasV2)).toBe(true);
    expect(lines.filter((l) => l.includes('refused'))).toEqual([]);
  });

  it('spec fields: a hub that advertises spec-fields gets pods and spec edges', async () => {
    hub = await startHub(0, false, { caps: [HUB_CAPS.V2_FIELDS, HUB_CAPS.SPEC_FIELDS] });
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build: withSpec,
      intervalMs: 30,
      log: () => {},
    });
    await until(() => hub!.received.length >= 2);
    expect(hub.received.every(hasSpec)).toBe(true);
    expect(hub.received[0]!.rigs[0]!.pods).toEqual([
      { id: 'dev', label: 'Development', members: ['build'] },
    ]);
  });

  it('spec files: the rig-files channel is told which caps the hub advertised', async () => {
    hub = await startHub(0, true, { caps: [HUB_CAPS.V2_FIELDS, HUB_CAPS.SPEC_FILES] });
    const seen: boolean[] = [];
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build,
      intervalMs: 30,
      rigFilesIntervalMs: 30,
      log: () => {},
      rigFiles: async (caps) => {
        seen.push(caps.has(HUB_CAPS.SPEC_FILES));
        return null;
      },
    });
    await until(() => seen.length >= 2);
    expect(seen.every(Boolean)).toBe(true);
  });

  it('the daemon-data channel is not even read until the hub advertised it', async () => {
    hub = await startHub(0, true); // listens, but advertises nothing
    let takes = 0;
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build,
      intervalMs: 30,
      log: () => {},
      daemonDataIntervalMs: 20,
      daemonData: async () => {
        takes++;
        return null;
      },
    });
    await until(() => hub!.received.length >= 5);
    await new Promise((r) => setTimeout(r, 150));
    expect(takes).toBe(0);
  });

  it('mission files: not read for a hub without the cap (old hub), sent to one with it, and a throwing read leaves snapshots flowing', async () => {
    // an old hub (advertises only daemondata): the channel is never even read, nothing is sent
    hub = await startHub(0, true, { caps: [HUB_CAPS.V2_FIELDS, HUB_CAPS.DAEMONDATA] });
    let takes = 0;
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build,
      intervalMs: 30,
      log: () => {},
      missionFilesIntervalMs: 20,
      missionFiles: async () => {
        takes++;
        return null;
      },
    });
    await until(() => hub!.received.length >= 5);
    await new Promise((r) => setTimeout(r, 150));
    expect(takes).toBe(0);
    await pusher.stop();
    await hub.close();

    // a hub with the cap: sent, marked sent, and a read that throws never stops the snapshot push
    hub = await startHub(0, true, { caps: [HUB_CAPS.V2_FIELDS, HUB_CAPS.MISSIONFILES] });
    let n = 0;
    let marked = 0;
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build,
      intervalMs: 30,
      log: () => {},
      missionFilesIntervalMs: 20,
      missionFiles: async () => {
        n++;
        if (n % 2 === 1) throw new Error('mission files exploded');
        return {
          pushes: [
            {
              kind: 'manifest' as const,
              machineId: 'roamy',
              collectedAt: new Date().toISOString(),
              rig: 'r',
              paths: ['/a/x.md'],
            },
          ],
          markSent: () => void marked++,
        };
      },
    });
    await until(() => n >= 4 && hub!.received.length >= 6 && marked >= 1, 10_000);
    const sent = hub.extra.filter((e) => e.event === 'collector:missionfiles');
    expect(sent.length).toBeGreaterThan(0);
  }, 20_000);

  const pushOf = (n: number) => ({
    kind: 'settings' as const,
    machineId: 'roamy',
    collectedAt: new Date().toISOString(),
    status: 'ok' as const,
    reason: null,
    key: '',
    data: { settings: {}, withheld: n, pathsHidden: 0 },
  });

  it('a read that throws never stops the snapshot push, and an oversize payload is skipped and logged once', async () => {
    hub = await startHub(0, true, { caps: [HUB_CAPS.V2_FIELDS, HUB_CAPS.DAEMONDATA] });
    const lines: string[] = [];
    let takes = 0;
    let marked = 0;
    const skipped: string[] = [];
    const huge = {
      ...pushOf(0),
      kind: 'workflows' as const,
      data: {
        specs: Array.from({ length: 200 }, (_, i) => ({
          name: `w${i}`,
          version: null,
          purpose: 'x'.repeat(400),
          targetRig: null,
          terminalTurnRule: null,
          isBuiltIn: null,
        })),
        instances: null,
      },
    };
    // pad past the guard without breaking its own schema: the guard looks at bytes, not shape
    (huge.data.specs[0] as { purpose: string }).purpose = 'y'.repeat(CHANNEL_PAYLOAD_MAX);
    pusher = startPusher({
      hubUrl: hub.url,
      token: TOKEN,
      machineId: 'roamy',
      build,
      intervalMs: 30,
      log: (l) => lines.push(l),
      daemonDataIntervalMs: 20,
      daemonData: async () => {
        takes++;
        if (takes % 2 === 1) throw new Error('daemon exploded');
        return {
          pushes: [huge, pushOf(1)],
          markSent: () => void marked++,
          markSkipped: (x: { kind: string }) => void skipped.push(x.kind),
        };
      },
    });
    await until(() => takes >= 6 && hub!.received.length >= 8 && marked >= 1, 10_000);
    const sent = hub.extra.filter((e) => e.event === 'collector:daemondata');
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((e) => (e.payload as { kind: string }).kind === 'settings')).toBe(true);
    expect(lines.filter((l) => l.includes('was not sent'))).toHaveLength(1);
    // the oversize payload is reported as skipped (so it is not recorded as sent), the other is sent
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.every((k) => k === 'workflows')).toBe(true);
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
