import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { useServerStatus } from './useServerStatus.js';

// Capture the native fetch at module load time, before any test setup stubs it
const nativeFetch = globalThis.fetch;

let server: Server;
let serverPort: number;

beforeAll(() => {
  return new Promise<void>((resolve) => {
    const app = express();

    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', data: { status: 'ok' }, timestamp: new Date().toISOString() });
    });

    app.get('/api/info', (_req, res) => {
      res.json({
        status: 'ok',
        data: {
          nodeVersion: 'v20.0.0',
          environment: 'test',
          port: 0,
          clientUrl: 'http://localhost:5500',
          uptime: 42,
        },
      });
    });

    app.get('/error', (_req, res) => {
      res.status(500).json({ status: 'error', error: 'Internal Server Error' });
    });

    server = app.listen(0, () => {
      serverPort = (server.address() as AddressInfo).port;
      resolve();
    });
  });
});

// Route relative fetch calls to the real test server; runs after setup.ts beforeEach stub
beforeEach(() => {
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' && input.startsWith('/')
        ? `http://localhost:${serverPort}${input}`
        : input;
    return nativeFetch(url, init);
  };
});

afterAll(() => {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe('useServerStatus', () => {
  it('starts with loading=true', () => {
    const { result } = renderHook(() => useServerStatus());
    expect(result.current.loading).toBe(true);
    expect(result.current.health).toBeNull();
    expect(result.current.info).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('fetches /health and sets health state', async () => {
    const { result } = renderHook(() => useServerStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.health).not.toBeNull();
    expect(result.current.health?.status).toBe('ok');
  });

  it('fetches /api/info and sets info state', async () => {
    const { result } = renderHook(() => useServerStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.info).not.toBeNull();
    expect(result.current.info?.nodeVersion).toBe('v20.0.0');
    expect(result.current.info?.environment).toBe('test');
    expect(typeof result.current.info?.uptime).toBe('number');
  });

  it('sets error=null on success', async () => {
    const { result } = renderHook(() => useServerStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
  });

  it('sets error state when server returns 500', async () => {
    // Temporarily override fetch to return 500 for both endpoints
    const savedFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ status: 'error', error: 'Internal Server Error' }),
    });

    const { result } = renderHook(() => useServerStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Server returned an error');
    expect(result.current.health).toBeNull();

    globalThis.fetch = savedFetch;
  });

  it('sets error state when server is unreachable', async () => {
    // Temporarily override fetch to simulate network failure
    const savedFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'));

    const { result } = renderHook(() => useServerStatus());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Failed to fetch');
    expect(result.current.loading).toBe(false);

    globalThis.fetch = savedFetch;
  });
});
