import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { FLEET_EVENTS, HUB_CAPS, PUSH_INTERVAL_MS, type CollectorAck } from '@appydave/shared';
import { buildSnapshot } from '@collector/builder.js';
import { fixtureSources } from '@collector/adapters/fixtureSources.js';
import {
  CHANNEL_PAYLOAD_MAX,
  startPusher,
  type Pusher,
  type PusherOptions,
} from '@collector/pusher.js';

/**
 * G04 · channel(): the eight side channels the pusher registers (rig files, loadout, database
 * rows, daemon data, mission files, rig specs, rig commands, database schema). For each one: its
 * event, key, "since" hint, cap it needs, the option that sets its interval, and its default.
 */

const NOW = '2026-11-08T00:00:00.000Z';
const ALL_CAPS = Object.values(HUB_CAPS);
const REFUSED: CollectorAck = { ok: false, failureMode: 'invalid_snapshot', message: 'nope' };

interface Probe {
  takes: number;
  marks: number;
}

interface Channel {
  key: string;
  event: string;
  since: string;
  needs?: string;
  every: number;
  sent: object[];
  /** The options that switch the channel on; it hands out its payloads until one batch is marked sent. */
  on(p: Probe, ms?: number): Partial<PusherOptions>;
}

const fresh = (p: Probe) => {
  p.takes++;

  return p.marks === 0;
};

const mark = (p: Probe) => ({
  markSent: () => {
    p.marks++;
  },
});

const RF = { machineId: 'roamy', collectedAt: NOW, rig: 'r', replace: true, files: [] };
const RF2 = { ...RF, replace: false };
const DB = {
  machineId: 'roamy',
  collectedAt: NOW,
  table: 't',
  columns: ['a'],
  total: 1,
  rows: [[1]],
  truncated: false,
  order: null,
  hiddenColumns: [],
};
const DD = {
  kind: 'settings' as const,
  machineId: 'roamy',
  collectedAt: NOW,
  status: 'ok' as const,
  reason: null,
  key: '',
  data: { settings: {}, withheld: 0, pathsHidden: 0 },
};
const MF = {
  kind: 'manifest' as const,
  machineId: 'roamy',
  collectedAt: NOW,
  rig: 'r',
  paths: ['/a'],
};
const RS = { machineId: 'roamy', collectedAt: NOW, specs: [] };
const RC = { machineId: 'roamy', collectedAt: NOW, fileFound: false, entries: [] };
const SC = {
  machineId: 'roamy',
  collectedAt: NOW,
  status: 'ok' as const,
  reason: null,
  openrigVersion: null,
  tables: [],
};
const LO: NonNullable<
  Awaited<ReturnType<NonNullable<PusherOptions['loadouts']>>>
>['loadouts'][number] = {
  machineId: 'roamy',
  seat: 's@r',
  collectedAt: NOW,
  runtime: 'claude-code',
  cwd: null,
  status: 'no-listing',
  listing: null,
  cwdIsGitRepo: null,
  cwdExists: null,
  skills: [],
  layers: [],
  topologyRoot: '/o',
  topologyDocs: [],
  member: null,
  agentSpec: null,
};

const CHANNELS: Channel[] = [
  {
    key: 'rig files',
    event: FLEET_EVENTS.RIGFILES,
    since: 'v1.4',
    every: 15_000,
    sent: [RF, RF2],
    on: (p, ms) => ({
      rigFilesIntervalMs: ms,
      rigFiles: async () => (fresh(p) ? { pushes: [RF, RF2], ...mark(p) } : null),
    }),
  },
  {
    key: 'loadout',
    event: FLEET_EVENTS.LOADOUT,
    since: 'v1.5',
    every: 15_000,
    sent: [LO],
    on: (p, ms) => ({
      loadoutIntervalMs: ms,
      loadouts: async () => (fresh(p) ? { loadouts: [LO], ...mark(p) } : null),
    }),
  },
  {
    key: 'database rows',
    event: FLEET_EVENTS.DBROWS,
    since: 'v1.5',
    every: 30_000,
    sent: [DB],
    on: (p, ms) => ({
      dbRowsIntervalMs: ms,
      dbRows: async () => (fresh(p) ? { pushes: [DB], ...mark(p) } : null),
    }),
  },
  {
    key: 'daemon data',
    event: FLEET_EVENTS.DAEMONDATA,
    since: 'v2',
    needs: HUB_CAPS.DAEMONDATA,
    every: 10_000,
    sent: [DD],
    on: (p, ms) => ({
      daemonDataIntervalMs: ms,
      daemonData: async () => (fresh(p) ? { pushes: [DD], ...mark(p) } : null),
    }),
  },
  {
    key: 'mission files',
    event: FLEET_EVENTS.MISSIONFILES,
    since: 'run board',
    needs: HUB_CAPS.MISSIONFILES,
    every: 30_000,
    sent: [MF],
    on: (p, ms) => ({
      missionFilesIntervalMs: ms,
      missionFiles: async () => (fresh(p) ? { pushes: [MF], ...mark(p) } : null),
    }),
  },
  {
    key: 'rig specs',
    event: FLEET_EVENTS.RIGSPECS,
    since: 'N10',
    needs: HUB_CAPS.RIG_SPECS,
    every: 15_000,
    sent: [RS],
    on: (p, ms) => ({
      rigSpecsIntervalMs: ms,
      rigSpecs: async () => (fresh(p) ? { push: RS, ...mark(p) } : null),
    }),
  },
  {
    key: 'rig commands',
    event: FLEET_EVENTS.RIGCOMMANDS,
    since: 'N10',
    needs: HUB_CAPS.RIG_COMMANDS,
    every: PUSH_INTERVAL_MS,
    sent: [RC],
    on: (p, ms) => ({
      rigCommandsIntervalMs: ms,
      rigCommands: async () => (fresh(p) ? { push: RC, ...mark(p) } : null),
    }),
  },
  {
    key: 'database schema',
    event: FLEET_EVENTS.SCHEMA,
    since: 'v1.4',
    every: 30_000,
    sent: [SC],
    on: (p, ms) => ({
      schemaIntervalMs: ms,
      schema: async () => (fresh(p) ? { push: SC, ...mark(p) } : null),
    }),
  },
];

type Answer = 'ok' | 'refuse' | 'silent';
interface Hub {
  url: string;
  got: { event: string; payload: unknown }[];
  close(): Promise<void>;
}

/** A hub that advertises `caps` and answers `event` the given way, every other event with a plain ack. */
async function startHub(caps: string[], event?: string, how: Answer = 'ok'): Promise<Hub> {
  const http = createServer();
  const io = new Server(http);
  const got: Hub['got'] = [];

  io.of('/collector').on('connection', (s) => {
    s.emit('hub:caps', caps);
    s.onAny((e: string, payload: object, ack?: (a: CollectorAck) => void) => {
      got.push({ event: e, payload });
      if (how === 'silent' && e === event) {
        return;
      }

      ack?.(how === 'refuse' && e === event ? REFUSED : { ok: true, receivedAt: NOW });
    });
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));

  return {
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    got,
    close: () =>
      new Promise<void>((r) => {
        void io.close(() => r());
      }),
  };
}

let hub: Hub | undefined;
let pusher: Pusher | undefined;

afterEach(async () => {
  await pusher?.stop();
  await hub?.close();
  vi.useRealTimers();
  pusher = hub = undefined;
});

const build = () =>
  buildSnapshot(fixtureSources({ machine: 'roamy' }), {
    machine: { id: 'roamy', label: 'Roamy', hostname: null },
    version: 't',
    pid: null,
  });

/** Resolves once the pusher is connected and has heard the hub's caps. Call straight after run(). */
async function ready() {
  const socket = pusher!.socket;
  const capsIn = new Promise<void>((resolve) => {
    socket.once(FLEET_EVENTS.CAPS, () => resolve());
  });

  if (!socket.connected) {
    await new Promise<void>((resolve) => {
      socket.once('connect', () => resolve());
    });
  }

  await capsIn;
}

function run(h: Hub, extra: Partial<PusherOptions>, lines: string[] = []) {
  pusher = startPusher({
    hubUrl: h.url,
    token: 'test-token-0123456789',
    machineId: 'roamy',
    build,
    intervalMs: 2_000_000_000,
    ackTimeoutMs: 60,
    log: (l) => lines.push(l),
    ...extra,
  });

  return lines;
}

const sentOn = (h: Hub, c: Channel) =>
  h.got.filter((g) => g.event === c.event).map((g) => g.payload);
const has = (lines: string[], text: string) => lines.some((l) => l.includes(text));

describe.each(CHANNELS)('Feature: the $key channel', (c) => {
  let p: Probe = { takes: 0, marks: 0 };

  beforeEach(() => {
    p = { takes: 0, marks: 0 };
  });

  it('Scenario: its payloads go out on its own event, in order, and are marked sent once', async () => {
    hub = await startHub(ALL_CAPS);
    run(hub, c.on(p, 30));
    await vi.waitFor(() => expect(p.marks).toBe(1), { timeout: 8000, interval: 20 });

    expect(sentOn(hub, c)).toEqual(c.sent);
  });

  it('Scenario: a refusal is logged under its key and nothing is marked sent', async () => {
    const lines: string[] = [];

    hub = await startHub(ALL_CAPS, c.event, 'refuse');
    run(hub, c.on(p, 30), lines);
    await vi.waitFor(
      () => expect(has(lines, `${c.key} refused: invalid_snapshot: nope`)).toBe(true),
      { timeout: 8000, interval: 20 }
    );

    expect(p.marks).toBe(0);
  });

  it('Scenario: a missing ack is a warning that names its key and the hub version it needs', async () => {
    const lines: string[] = [];

    hub = await startHub(ALL_CAPS, c.event, 'silent');
    run(hub, c.on(p, 30), lines);
    await vi.waitFor(
      () =>
        expect(has(lines, `no ack for ${c.key} (is the hub older than ${c.since}?)`)).toBe(true),
      { timeout: 8000, interval: 20 }
    );

    expect(p.marks).toBe(0);
  });

  it('Scenario: it is read only from a hub that advertised the cap it needs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hub = await startHub(c.needs ? ALL_CAPS.filter((x) => x !== c.needs) : []);
    run(hub, c.on(p, 20));
    await ready();
    await vi.advanceTimersByTimeAsync(300); // fifteen ticks of the channel's 20 ms loop
    expect(p.takes > 0).toBe(!c.needs);

    if (c.needs) {
      await pusher?.stop();
      await hub.close();
      vi.useRealTimers();
      hub = await startHub([c.needs]);
      run(hub, c.on(p, 20));
      await vi.waitFor(() => expect(p.takes).toBeGreaterThan(0), { timeout: 8000, interval: 20 });
    }
  });

  it.each([
    ['its default interval', undefined, c.every],
    ['the interval given for it', 7777, 7777],
  ])('Scenario: %s sets when it first runs and how often it repeats', async (_name, ms, every) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const quiet: Probe = { takes: 0, marks: 1 }; // nothing to send: only the timing is read

    hub = await startHub(ALL_CAPS);
    run(hub, c.on(quiet, ms));
    await ready();

    const first = Math.min(every, 4000);

    await vi.advanceTimersByTimeAsync(first - 1);
    expect(quiet.takes).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(quiet.takes).toBe(1);
    await vi.advanceTimersByTimeAsync(every - 1);
    expect(quiet.takes).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(quiet.takes).toBe(2);
  });
});

describe('Feature: what a channel does when things go wrong', () => {
  const lines: string[] = [];
  const small = { ...RF, rig: 'small' };
  const huge = { ...RF, rig: 'x'.repeat(CHANNEL_PAYLOAD_MAX) };

  it('Scenario: a payload over the size guard is skipped and logged, and the ones after it are still sent', async () => {
    const p: Probe = { takes: 0, marks: 0 };

    hub = await startHub(ALL_CAPS);
    run(
      hub,
      {
        rigFilesIntervalMs: 30,
        rigFiles: async () => (fresh(p) ? { pushes: [huge, small], ...mark(p) } : null),
      },
      lines
    );
    await vi.waitFor(() => expect(p.marks).toBe(1), { timeout: 8000, interval: 20 });

    expect(sentOn(hub, CHANNELS[0]!)).toEqual([small]);
    expect(has(lines, 'rig files: a payload over 800 KB was not sent')).toBe(true);
  });

  it('Scenario: a read that throws is logged under its key, and the channel carries on', async () => {
    let n = 0;
    const out: string[] = [];

    hub = await startHub(ALL_CAPS);
    run(
      hub,
      {
        rigFilesIntervalMs: 30,
        rigFiles: async () => {
          n++;
          throw new Error('boom');
        },
      },
      out
    );
    await vi.waitFor(() => expect(n).toBeGreaterThan(1), { timeout: 8000, interval: 20 });

    expect(has(out, 'rig files tick failed: boom')).toBe(true);
  });

  it('Scenario: a channel is not read while the hub is unreachable', async () => {
    let n = 0;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hub = await startHub(ALL_CAPS);

    const gone = hub.url;

    await hub.close();
    hub = undefined;
    run(
      { url: gone, got: [], close: async () => {} },
      {
        rigFilesIntervalMs: 20,
        rigFiles: async () => {
          n++;

          return null;
        },
      }
    );
    await new Promise<void>((resolve) => {
      pusher!.socket.once('connect_error', () => resolve());
    });
    await vi.advanceTimersByTimeAsync(400); // twenty ticks while the hub is gone

    expect(n).toBe(0);
  });

  it('Scenario: a hub without seat-spec gets loadouts without the member, AgentSpec and topology keys', async () => {
    const p: Probe = { takes: 0, marks: 0 };

    hub = await startHub([]);
    run(hub, CHANNELS[1]!.on(p, 30));
    await vi.waitFor(() => expect(p.marks).toBe(1), { timeout: 8000, interval: 20 });

    const [sent] = sentOn(hub, CHANNELS[1]!);

    expect(sent).not.toHaveProperty('topologyRoot');
    expect(sent).not.toHaveProperty('member');
    expect(sent).toHaveProperty('seat', LO.seat);
  });
});
