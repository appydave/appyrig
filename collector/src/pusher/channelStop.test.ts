import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { FLEET_EVENTS, HUB_CAPS } from '@appydave/shared';
import { buildSnapshot } from '@collector/builder.js';
import { fixtureSources } from '@collector/adapters/fixtureSources.js';
import { startPusher, type Pusher } from '@collector/pusher.js';

/**
 * G04 · stop(): a stopped pusher arms no new channel timer and clears the ones it had. Counts only
 * the timers the pusher arms itself (found by their delay): vi.getTimerCount() also counts the faked
 * timers of the `ws` library under socket.io (a 30 s close timer, armed by close() and again when the
 * hub's close frame lands, a real network event), which made a count of all timers flaky.
 */

const EVERY = 50;
const ACK = { ok: true, receivedAt: '2026-11-08T00:00:00.000Z' };

let io: Server | undefined;
let pusher: Pusher | undefined;

afterEach(async () => {
  await pusher?.stop();
  await new Promise<void>((r) => (io ? void io.close(() => r()) : r()));
  vi.useRealTimers();
  pusher = io = undefined;
});

/** A hub that advertises every cap and acks everything; resolves to its url. */
async function startHub() {
  const http = createServer();

  io = new Server(http);
  io.of('/collector').on('connection', (s) => {
    s.emit(FLEET_EVENTS.CAPS, Object.values(HUB_CAPS));
    s.onAny((_e: string, _payload: object, ack?: (a: typeof ACK) => void) => ack?.(ACK));
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));

  return `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

/** Starts a pusher whose only channel is rig files, and resolves once it is connected and has the caps. */
async function startOnlyRigFiles(rigFiles: () => Promise<null>) {
  const hubUrl = await startHub();

  pusher = startPusher({
    hubUrl,
    token: 'test-token-0123456789',
    machineId: 'roamy',
    build: () =>
      buildSnapshot(fixtureSources({ machine: 'roamy' }), {
        machine: { id: 'roamy', label: 'Roamy', hostname: null },
        version: 't',
        pid: null,
      }),
    intervalMs: 2_000_000_000,
    ackTimeoutMs: 60,
    log: () => {},
    rigFilesIntervalMs: EVERY,
    rigFiles,
  });

  const socket = pusher.socket;
  const capsIn = new Promise<void>((r) => socket.once(FLEET_EVENTS.CAPS, () => r()));

  if (!socket.connected) {
    await new Promise<void>((r) => socket.once('connect', () => r()));
  }

  await capsIn;
}

/** The ids of the timers armed with the channel's delay, and of every timer cleared. */
function watchTimers() {
  const armed = vi.spyOn(globalThis, 'setTimeout');
  const cleared = vi.spyOn(globalThis, 'clearTimeout');

  return {
    armedIds: () =>
      armed.mock.calls.flatMap(([, ms], i) => (ms === EVERY ? [armed.mock.results[i]?.value] : [])),
    clearedIds: () => cleared.mock.calls.map(([id]) => id),
  };
}

describe('Feature: a stopped pusher does not start a channel up again', () => {
  it('Scenario: a read still running when stop() is called schedules no further tick', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const timers = watchTimers();
    let release = () => {};

    await startOnlyRigFiles(
      () =>
        new Promise((r) => {
          release = () => r(null);
        })
    );
    await vi.advanceTimersByTimeAsync(EVERY);
    await pusher?.stop();

    const before = timers.armedIds().length;

    release();
    await vi.advanceTimersByTimeAsync(0);

    expect(before).toBe(1);
    expect(timers.armedIds()).toHaveLength(before);
  });

  it('Scenario: stop() clears every timer the channel armed, the first tick and the ones after it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const timers = watchTimers();
    let takes = 0;

    await startOnlyRigFiles(async () => {
      takes++;

      return null;
    });
    await vi.advanceTimersByTimeAsync(EVERY * 2);
    await pusher?.stop();

    expect(takes).toBeGreaterThanOrEqual(2);
    expect(timers.armedIds().length).toBeGreaterThanOrEqual(2);
    expect(timers.clearedIds()).toEqual(expect.arrayContaining(timers.armedIds()));
  });
});
