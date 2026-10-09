import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import express from 'express';
import type { Server } from 'node:http';
import App from './App.js';

// Capture the native fetch at module load time, before any test setup stubs it
const nativeFetch = globalThis.fetch;

let server: Server;
let serverPort: number;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app = express();
      app.get('/health', (_, res) =>
        res.json({ status: 'ok', timestamp: new Date().toISOString() })
      );
      app.get('/api/info', (_, res) =>
        res.json({
          status: 'ok',
          data: { nodeVersion: 'test', environment: 'test', port: 0, clientUrl: '', uptime: 0 },
        })
      );
      server = app.listen(0, () => {
        serverPort = (server.address() as { port: number }).port;
        resolve();
      });
    })
);

beforeEach(() => {
  globalThis.fetch = (input, init) => {
    const url =
      typeof input === 'string' && input.startsWith('/')
        ? `http://localhost:${serverPort}${input}`
        : input;
    return nativeFetch(url, init);
  };
});

afterEach(() => {
  globalThis.fetch = nativeFetch;
});

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server?.close(() => resolve());
    })
);

describe('App', () => {
  it('renders the tagline from LandingPage', async () => {
    render(<App />);
    expect(screen.getByText(/Production-ready RVETS stack boilerplate/)).toBeInTheDocument();
  });

  it('displays the status grid from DemoPage (DEV mode)', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('status-grid')).toBeInTheDocument(), {
      timeout: 5000,
    });
    // Verify actual content is rendered inside the status grid, not just its presence
    const grid = screen.getByTestId('status-grid');
    expect(grid.textContent).toMatch(/API Health/);
    expect(grid.textContent).toMatch(/WebSocket/);
  });

  it('displays the tech stack section from DemoPage (DEV mode)', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByTestId('tech-stack')).toBeInTheDocument());
  });
});
