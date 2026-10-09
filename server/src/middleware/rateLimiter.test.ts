import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import rateLimit from 'express-rate-limit';

// Build a test-specific limiter with a very low limit so we can trigger 429 without
// sending 100 real requests.
function buildApp(limit: number) {
  const testLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  const app = express();
  app.use(testLimiter);
  app.get('/ping', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('rateLimiter middleware', () => {
  it('allows requests under the limit', async () => {
    const app = buildApp(5);

    const res = await request(app).get('/ping');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('returns 429 once the per-window limit is exceeded', async () => {
    const app = buildApp(3);

    // Send 3 allowed requests
    for (let i = 0; i < 3; i++) {
      const res = await request(app).get('/ping');
      expect(res.status).toBe(200);
    }

    // The 4th request should be rate-limited
    const limited = await request(app).get('/ping');
    expect(limited.status).toBe(429);
  });

  it('includes RateLimit headers on successful responses', async () => {
    const app = buildApp(10);

    const res = await request(app).get('/ping');

    // draft-8 headers use RateLimit-* format
    expect(res.status).toBe(200);
    // At least one rate-limit related header should be present
    const headers = Object.keys(res.headers).join(' ').toLowerCase();
    expect(headers).toMatch(/ratelimit/);
  });

  it('does not set legacy X-RateLimit headers', async () => {
    const app = buildApp(10);

    const res = await request(app).get('/ping');

    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
    expect(res.headers['x-ratelimit-remaining']).toBeUndefined();
  });
});
