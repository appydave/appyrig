import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response, type NextFunction } from 'express';
import { AppError, errorHandler } from './errorHandler.js';

function buildApp(thrower: (req: Request, res: Response, next: NextFunction) => void) {
  const app = express();
  app.get('/test', thrower);
  app.use(errorHandler);
  return app;
}

describe('AppError', () => {
  it('stores statusCode and message', () => {
    const err = new AppError(422, 'Unprocessable');
    expect(err.statusCode).toBe(422);
    expect(err.message).toBe('Unprocessable');
  });

  it('defaults isOperational to true', () => {
    const err = new AppError(400, 'Bad input');
    expect(err.isOperational).toBe(true);
  });

  it('allows isOperational to be set false', () => {
    const err = new AppError(500, 'Crash', false);
    expect(err.isOperational).toBe(false);
  });

  it('is an instance of Error', () => {
    const err = new AppError(404, 'Not found');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('errorHandler middleware', () => {
  it('returns the AppError statusCode and message when isOperational is true', async () => {
    const app = buildApp((_req, _res, next) => {
      next(new AppError(404, 'Resource not found'));
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(404);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toBe('Resource not found');
    expect(res.body.timestamp).toBeDefined();
  });

  it('returns 500 and generic message for non-operational AppError', async () => {
    const app = buildApp((_req, _res, next) => {
      next(new AppError(500, 'Internal detail', false));
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toBe('Internal server error');
  });

  it('returns 500 and generic message for unknown (non-AppError) errors', async () => {
    const app = buildApp((_req, _res, next) => {
      next(new Error('Unexpected crash'));
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('error');
    expect(res.body.error).toBe('Internal server error');
  });

  it('returns the correct status for a 403 AppError', async () => {
    const app = buildApp((_req, _res, next) => {
      next(new AppError(403, 'Forbidden'));
    });

    const res = await request(app).get('/test');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });
});
