import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@appydave/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let _socket: AppSocket | null = null;

/**
 * Resolve the socket URL from env var or window.location.
 * Set VITE_SOCKET_URL to bypass Vite WebSocket proxy upgrade issues.
 */
export function getSocketUrl(): string {
  return (import.meta.env.VITE_SOCKET_URL as string | undefined) ?? window.location.origin;
}

/**
 * Returns the shared Socket.io singleton. Creates it on first call.
 * All hooks should use this rather than creating their own connections.
 */
export function getEntitySocket(): AppSocket {
  if (!_socket) {
    _socket = io(getSocketUrl(), {
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 3000,
    });
  }
  return _socket;
}
