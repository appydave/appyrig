import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import express from 'express';
import type { Server } from 'node:http';
import ErrorFallback from './components/ErrorFallback.js';
import App from './App.js';

// Capture native fetch before any stub replaces it
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

// Component that always throws — used to test ErrorBoundary catching
function ThrowingComponent(): never {
  throw new Error('deliberate test error');
}

describe('main.tsx wiring — ErrorBoundary', () => {
  it('renders without throwing when the app tree is mounted', () => {
    expect(() =>
      render(
        <StrictMode>
          <ErrorBoundary FallbackComponent={ErrorFallback}>
            <App />
          </ErrorBoundary>
        </StrictMode>
      )
    ).not.toThrow();
  });

  it('shows ErrorFallback when a child component throws', () => {
    // Suppress the expected console.error from react-error-boundary
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <StrictMode>
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          <ThrowingComponent />
        </ErrorBoundary>
      </StrictMode>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('deliberate test error')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('renders a Try again button in the error fallback', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <ThrowingComponent />
      </ErrorBoundary>
    );

    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('renders App content inside the ErrorBoundary wrapper', () => {
    render(
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <App />
      </ErrorBoundary>
    );

    expect(screen.getByText(/Production-ready RVETS stack boilerplate/)).toBeInTheDocument();
  });
});
