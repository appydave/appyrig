import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import infoRouter from './info.js';

const app = express();
app.use(infoRouter);

describe('GET /api/info', () => {
  it('returns server info', async () => {
    const res = await request(app).get('/api/info');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.data).toBeDefined();
    expect(res.body.data.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
    expect(res.body.data.environment).toBeDefined();
    expect(res.body.data.port).toBeDefined();
    expect(res.body.data.uptime).toBeGreaterThanOrEqual(0);
  });
});
