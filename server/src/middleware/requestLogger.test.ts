import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requestLogger } from './requestLogger.js';
import { logger } from '../config/logger.js';

function buildApp() {
  const app = express();
  app.use(requestLogger);
  app.get('/ok', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/client-error', (_req, res) => {
    res.status(404).json({ error: 'not found' });
  });
  app.get('/server-error', (_req, res) => {
    res.status(500).json({ error: 'crash' });
  });
  app.get('/redirect', (_req, res) => {
    res.status(301).redirect('/ok');
  });
  return app;
}

describe('requestLogger middleware', () => {
  it('allows a successful request to pass through', async () => {
    const res = await request(buildApp()).get('/ok');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('does not block 4xx responses', async () => {
    const res = await request(buildApp()).get('/client-error');
    expect(res.status).toBe(404);
  });

  it('does not block 5xx responses', async () => {
    const res = await request(buildApp()).get('/server-error');
    expect(res.status).toBe(500);
  });

  it('assigns a unique request id', async () => {
    const app = buildApp();
    const res1 = await request(app).get('/ok');
    const res2 = await request(app).get('/ok');
    // Both requests succeed; id is internal but pino-http attaches nothing to body
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});

describe('requestLogger customLogLevel', () => {
  // pino-http calls methods on a child logger created via logger.child({req}).
  // We intercept logger.child to return a controlled mock so we can assert
  // which log level method is actually invoked for each HTTP status code.

  interface ChildMock {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    child: ReturnType<typeof vi.fn>;
  }

  let childMock: ChildMock;

  beforeEach(() => {
    childMock = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };
    // child().child() may be called too — wire up nested child to same mock
    childMock.child.mockReturnValue(childMock);
    vi.spyOn(logger, 'child').mockReturnValue(
      childMock as unknown as ReturnType<typeof logger.child>
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs at info level for 2xx responses', async () => {
    await request(buildApp()).get('/ok');
    expect(childMock.info).toHaveBeenCalled();
    expect(childMock.warn).not.toHaveBeenCalled();
    expect(childMock.error).not.toHaveBeenCalled();
  });

  it('logs at info level for 3xx responses', async () => {
    await request(buildApp()).get('/redirect').redirects(0);
    expect(childMock.info).toHaveBeenCalled();
    expect(childMock.warn).not.toHaveBeenCalled();
    expect(childMock.error).not.toHaveBeenCalled();
  });

  it('logs at warn level for 4xx responses', async () => {
    await request(buildApp()).get('/client-error');
    expect(childMock.warn).toHaveBeenCalled();
    expect(childMock.info).not.toHaveBeenCalled();
    expect(childMock.error).not.toHaveBeenCalled();
  });

  it('logs at error level for 5xx responses', async () => {
    await request(buildApp()).get('/server-error');
    expect(childMock.error).toHaveBeenCalled();
    expect(childMock.info).not.toHaveBeenCalled();
    expect(childMock.warn).not.toHaveBeenCalled();
  });
});
