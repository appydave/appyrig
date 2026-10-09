import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { apiSuccess, apiFailure } from './response.js';

function buildApp() {
  const app = express();
  app.get('/success', (_req, res) => {
    apiSuccess(res, { name: 'test' });
  });
  app.get('/success-201', (_req, res) => {
    apiSuccess(res, { created: true }, 201);
  });
  app.get('/failure', (_req, res) => {
    apiFailure(res, 'Something went wrong');
  });
  app.get('/failure-404', (_req, res) => {
    apiFailure(res, 'Not found', 404);
  });
  return app;
}

describe('apiSuccess', () => {
  it('returns 200 with status ok and data', async () => {
    const res = await request(buildApp()).get('/success');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.data).toEqual({ name: 'test' });
    expect(res.body.timestamp).toBeDefined();
  });

  it('returns the provided status code', async () => {
    const res = await request(buildApp()).get('/success-201');
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ created: true });
  });
});

describe('apiFailure', () => {
  it('returns 400 with status error and message', async () => {
    const res = await request(buildApp()).get('/failure');
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toBe('Something went wrong');
    expect(res.body.timestamp).toBeDefined();
  });

  it('returns the provided status code', async () => {
    const res = await request(buildApp()).get('/failure-404');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});
