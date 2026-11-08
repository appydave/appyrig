import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { FLEET_EVENTS, type CollectorAck } from '@appydave/shared';
import { buildSnapshot } from '@collector/builder.js';
import { fixtureSources } from '@collector/adapters/fixtureSources.js';
import { startPusher, type Pusher } from '@collector/pusher.js';

/**
 * G04 · emitAcked: the four places the pusher emits and waits for an ack (the snapshot push, a
 * seat history, the queue bodies, and a side channel). At each one a hub that acks, refuses,
 * stays silent, acks with nothing, or acks late must be told apart the same way.
 */

type Ack = (a?: CollectorAck) => void;
type Mode = 'ok' | 'refuse' | 'silent' | 'empty' | 'late' | 'later';

const SHORT_MS = 60;
const SLOW_MS = 300;
const LATE_MS = 450; // between SLOW_MS and 2 * SLOW_MS: late for a 1x timeout, in time for a 2x one
const LATER_MS = 750; // between 2 * SLOW_MS and 3 * SLOW_MS: late even for a 2x timeout
const OK: CollectorAck = { ok: true, receivedAt: '2026-11-08T00:00:00.000Z' };

const ANSWERS: Record<Mode, (ack: Ack) => void> = {
  ok: (ack) => ack(OK),
  refuse: (ack) => ack({ ok: false, failureMode: 'invalid_snapshot', message: 'nope' }),
  silent: () => {},
  empty: (ack) => ack(),
  late: (ack) => {
    setTimeout(() => ack(OK), LATE_MS);
  },
  later: (ack) => {
    setTimeout(() => ack(OK), LATER_MS);
  },
};

interface Hub {
  url: string;
  received: { event: string; payload: unknown }[];
  close(): Promise<void>;
}

/** A hub that answers `event` the given way and every other channel with a plain ack. */
async function startHub(event: string, mode: Mode): Promise<Hub> {
  const http = createServer();
  const io = new Server(http);
  const received: Hub['received'] = [];

  io.of('/collector').on('connection', (socket) => {
    for (const e of [
      FLEET_EVENTS.SNAPSHOT,
      FLEET_EVENTS.HISTORY,
      FLEET_EVENTS.HANDOFFS,
      FLEET_EVENTS.RIGFILES,
    ]) {
      socket.on(e, (payload: object, ack: Ack) => {
        received.push({ event: e, payload });
        ANSWERS[e === event ? mode : 'ok'](ack);
      });
    }
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));

  return {
    url: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
    received,
    close: () =>
      new Promise<void>((r) => {
        void io.close(() => r());
      }),
  };
}

const NOW = '2026-11-08T00:00:00.000Z';
const HISTORY = {
  machineId: 'roamy',
  seat: 'seat1@r',
  collectedAt: NOW,
  events: [],
  truncated: false,
};
const BODIES = { machineId: 'roamy', collectedAt: NOW, items: [] };
const FILES = { machineId: 'roamy', collectedAt: NOW, rig: 'r', replace: true, files: [] };

type Opts = Parameters<typeof startPusher>[0];

interface Site {
  name: string;
  event: string;
  /** How many ack timeouts this site waits. */
  waits: 1 | 2;
  payload: unknown;
  /** The options that switch this site on; `mark` is its markSent. */
  on: (mark: () => void) => Partial<Opts>;
  /** What the pusher logs for a refusal and for no ack. */
  refused: RegExp;
  silent: (ms: number) => RegExp;
  /** An accepted ack is seen in the log (the snapshot push) or as markSent (the others). */
  accepted: RegExp | null;
}

const SITES: Site[] = [
  {
    name: 'push (snapshot)',
    event: FLEET_EVENTS.SNAPSHOT,
    waits: 1,
    payload: { machine: { id: 'roamy' } },
    on: () => ({}),
    refused: /snapshot refused: invalid_snapshot: nope/,
    silent: (ms) => new RegExp(`no ack from hub within ${ms}ms`),
    accepted: /acked by hub/,
  },
  {
    name: 'pushHistory',
    event: FLEET_EVENTS.HISTORY,
    waits: 2,
    payload: HISTORY,
    on: (mark) => ({
      historyIntervalMs: 30,
      histories: async () => [{ history: HISTORY, markSent: mark }],
    }),
    refused: /history refused for seat1@r: invalid_snapshot: nope/,
    silent: () => /no ack for history of seat1@r/,
    accepted: null,
  },
  {
    name: 'handoffTick',
    event: FLEET_EVENTS.HANDOFFS,
    waits: 2,
    payload: BODIES,
    on: (mark) => ({
      handoffIntervalMs: 30,
      handoffs: async () => ({ bodies: BODIES, markSent: mark }),
    }),
    refused: /queue bodies refused: invalid_snapshot: nope/,
    silent: () => /no ack for queue bodies \(is the hub older than v1\.4\?\)/,
    accepted: null,
  },
  {
    name: 'sendAcked (a side channel)',
    event: FLEET_EVENTS.RIGFILES,
    waits: 2,
    payload: FILES,
    on: (mark) => ({
      rigFilesIntervalMs: 30,
      rigFiles: async () => ({ pushes: [FILES], markSent: mark }),
    }),
    refused: /rig files refused: invalid_snapshot: nope/,
    silent: () => /no ack for rig files \(is the hub older than v1\.4\?\)/,
    accepted: null,
  },
];

let hub: Hub | undefined;
let pusher: Pusher | undefined;

afterEach(async () => {
  await pusher?.stop();
  await hub?.close();
  pusher = hub = undefined;
});

/** Runs the pusher against a hub answering `site` this way; resolves to what it logged and marked. */
async function run(site: Site, mode: Mode, wait: { ackMs: number; until: (r: Seen) => boolean }) {
  hub = await startHub(site.event, mode);

  const seen: Seen = { lines: [], marked: 0 };

  pusher = startPusher({
    hubUrl: hub.url,
    token: 'test-token-0123456789',
    machineId: 'roamy',
    build: () =>
      buildSnapshot(fixtureSources({ machine: 'roamy' }), {
        machine: { id: 'roamy', label: 'Roamy', hostname: null },
        version: 't',
        pid: null,
      }),
    intervalMs: 40,
    ackTimeoutMs: wait.ackMs,
    log: (l) => seen.lines.push(l),
    ...site.on(() => {
      seen.marked++;
    }),
  });
  await vi.waitFor(() => expect(wait.until(seen)).toBe(true), { timeout: 8000, interval: 20 });

  return seen;
}

interface Seen {
  lines: string[];
  marked: number;
}

const logged = (s: Seen, re: RegExp) => s.lines.some((l) => re.test(l));
const accepted = (site: Site) => (s: Seen) =>
  site.accepted ? logged(s, site.accepted) : s.marked > 0;

describe.each(SITES)('Feature: $name tells a hub that answers from one that does not', (site) => {
  it('Scenario: an accepted ack is taken as accepted, and the hub got this event with this payload', async () => {
    const seen = await run(site, 'ok', { ackMs: SHORT_MS, until: accepted(site) });

    expect(hub!.received.find((r) => r.event === site.event)?.payload).toMatchObject(
      site.payload as object
    );
    expect(logged(seen, site.refused)).toBe(false);
  });

  it('Scenario: a refusal is reported with its reason and nothing is marked sent', async () => {
    const seen = await run(site, 'refuse', {
      ackMs: SHORT_MS,
      until: (s) => logged(s, site.refused),
    });

    expect(seen.marked).toBe(0);
  });

  it.each(['silent', 'empty'] as const)(
    'Scenario: an ack that never comes (%s) is a timeout, not a refusal, and nothing is marked sent',
    async (mode) => {
      const seen = await run(site, mode, {
        ackMs: SHORT_MS,
        until: (s) => logged(s, site.silent(SHORT_MS)),
      });

      expect(seen.marked).toBe(0);
      expect(logged(seen, site.refused)).toBe(false);
      expect(logged(seen, /tick failed/)).toBe(false);
    }
  );

  it('Scenario: an ack that arrives between one and two timeouts is late for a 1x site and in time for a 2x one', async () => {
    const seen = await run(site, 'late', {
      ackMs: SLOW_MS,
      until: site.waits === 1 ? (s) => logged(s, site.silent(SLOW_MS)) : accepted(site),
    });

    expect(logged(seen, site.refused)).toBe(false);
  });

  it('Scenario: an ack that arrives after two timeouts is late for every site, so nothing is marked sent', async () => {
    const seen = await run(site, 'later', {
      ackMs: SLOW_MS,
      until: (s) => logged(s, site.silent(SLOW_MS)),
    });

    expect(seen.marked).toBe(0);
    expect(logged(seen, site.refused)).toBe(false);
  });
});
