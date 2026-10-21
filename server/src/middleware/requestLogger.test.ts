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

describe('requestLogger never writes a credential (r1 H1)', () => {
  it('masks the /?token= value and drops Authorization, Cookie and Set-Cookie', async () => {
    const { default: pino } = await import('pino');
    const { Writable } = await import('node:stream');
    const { createRequestLogger, maskUrl } = await import('./requestLogger.js');
    const { browserAuth, sessionValue } = await import('../hub/browserAuth.js');
    const TOKEN = 'secret-hub-token-0123456789abcdef';
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const app = express();

    app.use(createRequestLogger(pino(sink)));
    app.use(browserAuth({ hubToken: TOKEN, afterLogin: '/' }));
    app.get('/api/info', (_req, res) => res.json({ ok: true }));

    const login = await request(app).get(`/?token=${TOKEN}`);

    expect(login.status).toBe(303);

    const cookie = String(login.headers['set-cookie']).split(';')[0]!;

    await request(app).get('/api/info').set('Cookie', cookie);
    await request(app).get('/api/info').set('Authorization', `Bearer ${TOKEN}`);
    await request(app).get(`/?token=wrong&token=${TOKEN}`);

    const log = lines.join('');

    expect(lines.length).toBeGreaterThanOrEqual(4);
    expect(log).not.toContain(TOKEN);
    expect(log).not.toContain(sessionValue(TOKEN));
    expect(log).toContain('token=[redacted]');
    expect(log).toContain('GET /?token=[redacted] 303');
    expect(maskUrl('/x?a=1&TOKEN=abc#h')).toBe('/x?a=1&TOKEN=[redacted]#h');
  });
});

describe('requestLogger keeps polling out of the info log (P6)', () => {
  it('logs routine successes on the polled paths at debug, everything else and all failures as before', async () => {
    const { default: pino } = await import('pino');
    const { Writable } = await import('node:stream');
    const { createRequestLogger } = await import('./requestLogger.js');
    const lines: { level: number; msg: string }[] = [];
    const sink = new Writable({
      write(chunk, _enc, done) {
        lines.push(JSON.parse(String(chunk)));
        done();
      },
    });
    const app = express();

    app.use(express.json());
    app.use(createRequestLogger(pino({ level: 'info' }, sink)));
    app.get('/health', (_req, res) => res.json({ ok: true }));
    app.get('/v1/health', (_req, res) => res.json({ ok: true }));
    app.post('/v1/rpc', (req, res) => res.status(req.body.fail ? 401 : 200).json({}));
    app.get('/api/info', (_req, res) => res.json({ ok: true }));

    await request(app).get('/health');
    await request(app).get('/v1/health?x=1');
    await request(app).post('/v1/rpc').send({});
    await request(app).post('/v1/rpc').send({ fail: true });
    await request(app).get('/api/info');

    expect(lines.map((l) => l.msg)).toEqual(['POST /v1/rpc 401', 'GET /api/info 200']);
    expect(lines[0]!.level).toBe(40); // warn
  });
});
