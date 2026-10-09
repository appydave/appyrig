import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as ioc } from 'socket.io-client';
import type { Socket as ClientSocket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@appydave/shared';
import { SOCKET_EVENTS } from '@appydave/shared';

// waitFor utility for async assertions
function waitFor<T>(fn: () => T | Promise<T>, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        if (Date.now() - start > timeoutMs) {
          reject(err);
        } else {
          setTimeout(check, 50);
        }
      }
    };
    check();
  });
}

describe('Socket.io event handlers', () => {
  let io: Server<ClientToServerEvents, ServerToClientEvents>;
  let serverPort: number;

  beforeAll(() => {
    return new Promise<void>((resolve) => {
      const httpServer = createServer();

      io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
        cors: { origin: '*' },
      });

      io.on('connection', (socket) => {
        socket.on(SOCKET_EVENTS.CLIENT_PING, () => {
          socket.emit(SOCKET_EVENTS.SERVER_PONG, {
            message: 'pong',
            timestamp: new Date().toISOString(),
          });
        });
      });

      httpServer.listen(0, () => {
        serverPort = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(() => {
    return new Promise<void>((resolve) => {
      io.close(() => resolve());
    });
  });

  describe('client:ping → server:pong', () => {
    let clientSocket: ClientSocket<ServerToClientEvents, ClientToServerEvents>;

    beforeEach(() => {
      return new Promise<void>((resolve) => {
        clientSocket = ioc(`http://localhost:${serverPort}`, {
          forceNew: true,
          transports: ['websocket'],
        });
        clientSocket.on('connect', () => resolve());
      });
    });

    afterEach(() => {
      clientSocket.disconnect();
    });

    it('connects to the server', async () => {
      await waitFor(() => {
        expect(clientSocket.connected).toBe(true);
      });
    });

    it('receives server:pong with correct payload when client:ping is emitted', () => {
      return new Promise<void>((resolve, reject) => {
        clientSocket.on(SOCKET_EVENTS.SERVER_PONG, (data) => {
          try {
            expect(data).toBeDefined();
            expect(data.message).toBe('pong');
            expect(typeof data.timestamp).toBe('string');
            // Verify timestamp is a valid ISO date string
            expect(() => new Date(data.timestamp)).not.toThrow();
            expect(new Date(data.timestamp).toISOString()).toBe(data.timestamp);
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        clientSocket.emit(SOCKET_EVENTS.CLIENT_PING);
      });
    });

    it('responds to multiple ping events', () => {
      return new Promise<void>((resolve, reject) => {
        const pongCount = { value: 0 };

        clientSocket.on(SOCKET_EVENTS.SERVER_PONG, (data) => {
          try {
            expect(data.message).toBe('pong');
            expect(typeof data.timestamp).toBe('string');
            pongCount.value += 1;
            if (pongCount.value === 3) {
              resolve();
            }
          } catch (err) {
            reject(err);
          }
        });

        clientSocket.emit(SOCKET_EVENTS.CLIENT_PING);
        clientSocket.emit(SOCKET_EVENTS.CLIENT_PING);
        clientSocket.emit(SOCKET_EVENTS.CLIENT_PING);
      });
    });
  });

  describe('connection and disconnection', () => {
    it('can connect and disconnect cleanly', () => {
      return new Promise<void>((resolve, reject) => {
        const socket = ioc(`http://localhost:${serverPort}`, {
          forceNew: true,
          transports: ['websocket'],
        });

        socket.on('connect', () => {
          expect(socket.connected).toBe(true);
          socket.disconnect();
        });

        socket.on('disconnect', (reason) => {
          try {
            expect(socket.connected).toBe(false);
            expect(reason).toBe('io client disconnect');
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        socket.on('connect_error', (err) => {
          reject(err);
        });
      });
    });

    it('receives a socket id on connection', () => {
      return new Promise<void>((resolve, reject) => {
        const socket = ioc(`http://localhost:${serverPort}`, {
          forceNew: true,
          transports: ['websocket'],
        });

        socket.on('connect', () => {
          try {
            expect(socket.id).toBeDefined();
            expect(typeof socket.id).toBe('string');
            expect(socket.id!.length).toBeGreaterThan(0);
            socket.disconnect();
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        socket.on('connect_error', (err) => {
          reject(err);
        });
      });
    });
  });
});
