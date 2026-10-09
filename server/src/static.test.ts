/**
 * Tests for 404 behaviour in development/test mode.
 *
 * The SPA static-file handler in index.ts is guarded by env.isProduction,
 * which is evaluated at module load. In test mode that block is never active,
 * so unknown routes must always return clean 404 JSON — never an HTML page
 * or a 500 from a missing dist/ directory.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './index.js';

describe('404 catch-all', () => {
  it('returns 404 JSON for an unknown route', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ status: 'error', error: 'Not found' });
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('returns JSON not HTML for unknown /api routes', async () => {
    const res = await request(app).get('/api/unknown');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('confirms SPA handler is not active in test mode (no 500 from missing dist/)', async () => {
    // If the SPA wildcard were registered it would call sendFile against a
    // missing dist/ directory and return 500. A clean 404 confirms it's not.
    const res = await request(app).get('/dashboard/settings');
    expect(res.status).toBe(404);
    expect(res.body.status).toBe('error');
  });
});
