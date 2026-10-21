import { useEffect, useReducer, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  AUTH_ERRORS,
  FLEET_EVENTS,
  type BrowserClientToServerEvents,
  type BrowserServerToClientEvents,
} from '@appydave/shared';
import { applyFleetUpdate, initialFleetState, type FleetState } from './store.js';

export type FleetSocket = Socket<BrowserServerToClientEvents, BrowserClientToServerEvents>;

let socket: FleetSocket | null = null;

/**
 * The one browser socket to the hub's `/` namespace. It receives `fleet:update`, and its only
 * emit is `core:call` for read-only API verbs (see coreCall.ts).
 */
export function getFleetSocket(): FleetSocket {
  if (!socket) {
    // D52: always same origin. The hub serves the built client itself, and in dev Vite proxies
    // /socket.io to the hub, so the session cookie (AC 18) rides along without credentialed CORS.
    // VITE_SOCKET_URL is deliberately not used here.
    socket = io(window.location.origin, {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
  }

  return socket;
}

export type HubLink = 'connecting' | 'connected' | 'disconnected' | 'unauthorised';

type Action = { type: 'update'; payload: unknown };

function reducer(state: FleetState, action: Action): FleetState {
  return applyFleetUpdate(state, action.payload);
}

export interface FleetView {
  state: FleetState;
  link: HubLink;
}

export function useFleet(getSocket: () => FleetSocket = getFleetSocket): FleetView {
  const [state, dispatch] = useReducer(reducer, initialFleetState);
  const [link, setLink] = useState<HubLink>('connecting');

  useEffect(() => {
    const s = getSocket();
    const onUpdate = (payload: unknown) => dispatch({ type: 'update', payload });
    const onConnect = () => setLink('connected');
    const onDisconnect = () => setLink('disconnected');
    const onError = (err: Error) =>
      setLink(err.message === AUTH_ERRORS.browserSession ? 'unauthorised' : 'disconnected');

    s.on(FLEET_EVENTS.UPDATE, onUpdate);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onError);
    if (s.connected) {
      setLink('connected');
    }

    return () => {
      s.off(FLEET_EVENTS.UPDATE, onUpdate);
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onError);
    };
  }, [getSocket]);

  return { state, link };
}

/**
 * A clock for freshness labels, ticking once a second. Render governor: it stops while the tab
 * is hidden, so a wall left open in a background tab costs nothing.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) {
        return;
      }

      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), intervalMs);
    };

    const stop = () => {
      if (timer) {
        clearInterval(timer);
      }

      timer = null;
    };

    const onVisibility = () => (document.hidden ? stop() : start());

    if (!document.hidden) {
      start();
    }

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs]);

  return now;
}
