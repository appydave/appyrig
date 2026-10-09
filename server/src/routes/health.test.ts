import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import healthRouter from './health.js';

const app = express();
app.use(healthRouter);

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp);
    expect(res.body.data.status).toBe('ok');
  });
});
