import type { FleetUpdate, MachineSnapshot } from './snapshot.js';

/**
 * AppyRig wire contract (P0b): Socket.IO events and the auth handshake.
 *
 * Two Socket.IO namespaces on the hub:
 *   `/`          — browsers. Read-only. Receives `fleet:update`.
 *   `/collector` — collectors. Push-only. Sends `collector:snapshot`.
 *
 * Auth (AC 5, AC 18):
 *   - A collector connects to `/collector` with `auth: { token, machineId }` (CollectorAuth).
 *     The hub compares `token` with its hub token; a missing or wrong token is refused at
 *     connect with the error message AUTH_ERRORS.collectorToken.
 *   - A browser gets a session cookie (SESSION_COOKIE) by visiting `/?token=<hub token>` once.
 *     HTTP routes and the `/` socket are refused without that cookie, except the open API doors
 *     (`/v1/docs`, `/v1/openrpc.json`, `/v1/health`), which carry no fleet data.
 */

export const SOCKET_NAMESPACES = {
  BROWSER: '/',
  COLLECTOR: '/collector',
} as const;

export const FLEET_EVENTS = {
  /** hub → browser. Payload: FleetUpdate. Sent with every machine on connect, then changed machines only. */
  UPDATE: 'fleet:update',
  /** collector → hub. Payload: MachineSnapshot. The hub acks with CollectorAck. */
  SNAPSHOT: 'collector:snapshot',
} as const;

/** Name of the browser session cookie (httpOnly, sameSite=lax). */
export const SESSION_COOKIE = 'appyrig_session';

/** Query parameter of the one-time browser login visit: `/?token=…`. */
export const TOKEN_QUERY_PARAM = 'token';

export const AUTH_ERRORS = {
  collectorToken: 'collector token missing or invalid',
  browserSession: 'browser session missing or invalid',
} as const;

/** `auth` payload a collector passes to `io(url + '/collector', { auth })`. */
export interface CollectorAuth {
  token: string;
  machineId: string;
}

/** Ack for `collector:snapshot`. A refused snapshot is data, not a throw. */
export type CollectorAck =
  | { ok: true; receivedAt: string }
  | { ok: false; failureMode: 'invalid_snapshot' | 'machine_mismatch'; message: string };

/** Events on the `/` namespace, hub → browser. The one definition; the scaffold's ServerToClientEvents extends it. */
export interface BrowserServerToClientEvents {
  'fleet:update': (update: FleetUpdate) => void;
}

/** Events on the `/` namespace, browser → hub. None in v1: the UI reads through the API core verbs. */
export type BrowserClientToServerEvents = Record<string, never>;

/** Events on the `/collector` namespace, collector → hub. */
export interface CollectorClientToServerEvents {
  'collector:snapshot': (snapshot: MachineSnapshot, ack: (result: CollectorAck) => void) => void;
}

/** Events on the `/collector` namespace, hub → collector. None in v1. */
export type CollectorServerToClientEvents = Record<string, never>;

/**
 * Test hook for the Playwright smoke tests (AC 11), installed by the client in every build mode:
 *
 *   window.__appyrig.xtermCount(): number
 *
 * Returns the number of live xterm.js Terminal instances: created and not yet disposed. The Wall
 * creates none (tiles are ANSI→HTML), so it is 0 on the Wall, 1 while Focus is open, and 0 again
 * after Esc closes Focus and disposes the terminal.
 */
export interface AppyRigTestHooks {
  xtermCount: () => number;
}
