import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { io as ioc, type Socket } from 'socket.io-client';
import { FLEET_EVENTS, type FleetUpdate, type MachineSnapshot } from '@appydave/shared';
import { createHub, type Hub, type HubOptions } from '../hub/createHub.js';
import { sessionCookieHeader } from '../hub/browserAuth.js';

/** Test-only helpers: real hubs on random localhost ports, real Socket.IO clients. */

export const TOKEN = 'test-hub-token-0123456789';
export const COOKIE = sessionCookieHeader(TOKEN).split(';')[0]!;

const SNAPSHOTS = resolve(process.cwd(), '..', 'test/fixtures/snapshots');
export const loadSnapshot = (name: string): MachineSnapshot =>
  JSON.parse(readFileSync(resolve(SNAPSHOTS, `${name}.json`), 'utf8'));

/** A clock tests move by hand. */
export function manualClock(start = '2026-10-09T12:00:00.000Z') {
  let t = Date.parse(start);
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export interface RunningHub {
  hub: Hub;
  url: string;
  sockets: Socket[];
  browser: (cookie?: string) => Socket;
  collector: (auth: object) => Socket;
  stop: () => Promise<void>;
}

export async function startHub(opts: Partial<HubOptions> = {}): Promise<RunningHub> {
  const hub = createHub({ hubToken: TOKEN, clientUrl: 'http://localhost:1', ...opts });
  const { port } = await hub.listen(0, ['127.0.0.1']);
  const url = `http://127.0.0.1:${port}`;
  const sockets: Socket[] = [];
  const open = (path: string, extra: object) => {
    const s = ioc(`${url}${path}`, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      ...extra,
    });
    sockets.push(s);
    return s;
  };
  return {
    hub,
    url,
    sockets,
    browser: (cookie = COOKIE) => open('/', cookie ? { extraHeaders: { cookie } } : {}),
    collector: (auth) => open('/collector', { auth }),
    stop: async () => {
      sockets.splice(0).forEach((s) => s.close());
      await hub.close();
    },
  };
}

export const nextUpdate = (s: Socket) =>
  new Promise<FleetUpdate>((r) => s.once(FLEET_EVENTS.UPDATE, r));

export const connectError = (s: Socket) => new Promise<Error>((r) => s.once('connect_error', r));

export function push(s: Socket, snapshot: unknown) {
  return new Promise<{ ok: boolean; [k: string]: unknown }>((r) =>
    s.emit(FLEET_EVENTS.SNAPSHOT, snapshot, r)
  );
}
