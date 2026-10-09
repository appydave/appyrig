import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import { io as ioc } from 'socket.io-client';
import { SOCKET_EVENTS } from '@appydave/shared';
import { app, httpServer } from './index.js';

describe('Express app (via index.ts export)', () => {
  it('GET /health returns 200', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/info returns 200', async () => {
    const res = await request(app).get('/api/info');
    expect(res.status).toBe(200);
  });

  it('GET /unknown-route returns 404', async () => {
    const res = await request(app).get('/unknown-route-that-does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toBe('Not found');
  });
});

describe('Socket.io via httpServer export', () => {
  let port: number;

  beforeAll(async () => {
    // In test mode index.ts skips auto-listen to prevent EADDRINUSE across
    // parallel test files. Start the server on a random port here instead.
    if (!httpServer.listening) {
      await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    }
    port = (httpServer.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  it('connects and receives server:pong after client:ping', () => {
    return new Promise<void>((resolve, reject) => {
      const url = `http://localhost:${port}`;

      const client = ioc(url, { forceNew: true, transports: ['websocket'] });

      client.on('connect_error', (err) => {
        client.disconnect();
        reject(err);
      });

      client.on('connect', () => {
        client.on(SOCKET_EVENTS.SERVER_PONG, (data) => {
          try {
            expect(data.message).toBe('pong');
            expect(typeof data.timestamp).toBe('string');
            client.disconnect();
            resolve();
          } catch (err) {
            client.disconnect();
            reject(err);
          }
        });
        client.emit(SOCKET_EVENTS.CLIENT_PING);
      });
    });
  });

  it('can connect and disconnect cleanly', () => {
    return new Promise<void>((resolve, reject) => {
      const url = `http://localhost:${port}`;

      const client = ioc(url, { forceNew: true, transports: ['websocket'] });

      client.on('connect_error', (err) => {
        client.disconnect();
        reject(err);
      });

      client.on('connect', () => {
        expect(client.connected).toBe(true);
        client.disconnect();
      });

      client.on('disconnect', (reason) => {
        try {
          expect(client.connected).toBe(false);
          expect(reason).toBe('io client disconnect');
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });
});
