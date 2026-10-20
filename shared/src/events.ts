import type { SeatHistory } from './history.js';
import type { HandoffBodies } from './handoffs.js';
import type { RigFilesPush } from './rigfiles.js';
import type { SchemaPush } from './dbschema.js';
import type { SeatLoadout } from './loadout.js';
import type { DbRowsPush } from './dbrows.js';
import type { DaemonDataPush } from './daemondata.js';
import type { MissionFilesPush } from './missionfiles.js';
import type { RigCommandsPush, RigSpecsPush } from './rigspecs.js';
import type { FleetUpdate, MachineSnapshot } from './snapshot.js';
import type { CallAnswer, CoreCallRequest } from './verbs.js';

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
  /** browser → hub. Payload: CoreCallRequest; the ack is the CallAnswer. Calls as `human:ui`. */
  CALL: 'core:call',
  /** collector → hub. Payload: SeatHistory (one seat). The hub acks with CollectorAck. v1.2. */
  HISTORY: 'collector:history',
  /** collector → hub. Payload: HandoffBodies (queue message bodies not yet sent). Acked with CollectorAck. v1.4. */
  HANDOFFS: 'collector:handoffs',
  /** collector → hub. Payload: RigFilesPush (a chunk of one rig's spec/mission files). Acked with CollectorAck. v1.4 · S7. */
  RIGFILES: 'collector:rigfiles',
  /** collector → hub. Payload: SchemaPush (the OpenRig database shape on that machine). Acked with CollectorAck. v1.4 · S7. */
  SCHEMA: 'collector:schema',
  /** collector → hub. Payload: SeatLoadout (one seat's listed skills and prompt layers). Acked with CollectorAck. v1.5 · L1. */
  LOADOUT: 'collector:loadout',
  /** collector → hub. Payload: DbRowsPush (one table's newest rows, read-only). Acked with CollectorAck. Batch 1 · B5. */
  DBROWS: 'collector:dbrows',
  /** collector → hub. Payload: DaemonDataPush (one kind of read-only OpenRig daemon data: seat detail, library, transitions, workflows, health, settings). Acked with CollectorAck. v2 data channels. */
  DAEMONDATA: 'collector:daemondata',
  /** collector → hub. Payload: MissionFilesPush (a rig's list of servable mission files, or one file/part). Acked with CollectorAck. Run board lane 1. */
  MISSIONFILES: 'collector:missionfiles',
  /** collector → hub. Payload: RigSpecsPush (every rig spec found on the machine). Acked with CollectorAck. N10. */
  RIGSPECS: 'collector:rigspecs',
  /** collector → hub. Payload: RigCommandsPush (the newest `rig` commands, redacted). Acked with CollectorAck. N10. */
  RIGCOMMANDS: 'collector:rigcommands',
  /** hub → collector, once on connection: the HUB_CAPS this hub understands, so the first push is already right. */
  CAPS: 'hub:caps',
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

/**
 * Ack for `collector:snapshot`. A refused snapshot is data, not a throw. `caps` (HUB_CAPS) is what
 * this hub understands beyond v1.5; an older hub sends none.
 */
export type CollectorAck =
  | { ok: true; receivedAt: string; caps?: string[] }
  | { ok: false; failureMode: 'invalid_snapshot' | 'machine_mismatch'; message: string };

/** Events on the `/` namespace, hub → browser. The one definition; the scaffold's ServerToClientEvents extends it. */
export interface BrowserServerToClientEvents {
  'fleet:update': (update: FleetUpdate) => void;
}

/**
 * Events on the `/` namespace, browser → hub. The UI's one door into the API core: every verb
 * the UI uses is a read-only core verb, called as principal `human:ui` (B1, B13).
 */
export interface BrowserClientToServerEvents {
  'core:call': (request: CoreCallRequest, ack: (answer: CallAnswer) => void) => void;
}

/** Principal the browser socket door calls as. */
export const UI_PRINCIPAL = 'human:ui';

/** Events on the `/collector` namespace, collector → hub. */
export interface CollectorClientToServerEvents {
  'collector:snapshot': (snapshot: MachineSnapshot, ack: (result: CollectorAck) => void) => void;
  'collector:history': (history: SeatHistory, ack: (result: CollectorAck) => void) => void;
  'collector:handoffs': (bodies: HandoffBodies, ack: (result: CollectorAck) => void) => void;
  'collector:rigfiles': (push: RigFilesPush, ack: (result: CollectorAck) => void) => void;
  'collector:schema': (push: SchemaPush, ack: (result: CollectorAck) => void) => void;
  'collector:loadout': (loadout: SeatLoadout, ack: (result: CollectorAck) => void) => void;
  'collector:dbrows': (push: DbRowsPush, ack: (result: CollectorAck) => void) => void;
  'collector:daemondata': (push: DaemonDataPush, ack: (result: CollectorAck) => void) => void;
  'collector:missionfiles': (push: MissionFilesPush, ack: (result: CollectorAck) => void) => void;
  'collector:rigspecs': (push: RigSpecsPush, ack: (result: CollectorAck) => void) => void;
  'collector:rigcommands': (push: RigCommandsPush, ack: (result: CollectorAck) => void) => void;
}

/** Events on the `/collector` namespace, hub → collector. None in v1. */
export interface CollectorServerToClientEvents {
  'hub:caps': (caps: string[]) => void;
}

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

/** socket.io maxHttpBufferSize on the hub (bytes). Collectors keep side-channel payloads under CHANNEL_PAYLOAD_MAX. */
export const HUB_MAX_BUFFER = 1_048_576;
