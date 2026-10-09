import type { Response } from 'express';

export function apiSuccess<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json({
    status: 'ok',
    data,
    timestamp: new Date().toISOString(),
  });
}

export function apiFailure(res: Response, error: string, statusCode = 400): void {
  res.status(statusCode).json({
    status: 'error',
    error,
    timestamp: new Date().toISOString(),
  });
}
