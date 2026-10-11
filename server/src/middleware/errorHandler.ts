import type { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';
import { AppError } from '../helpers/AppError.js';

// Re-export so consumers can import AppError from either location.
export { AppError };

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  // A body over a parser's limit is the caller's doing, not a server fault: say so plainly (413).
  if ((err as { type?: string }).type === 'entity.too.large') {
    logger.warn({ limit: (err as { limit?: number }).limit }, 'request body too large');
    res.status(413).json({
      status: 'error',
      error: 'Request body too large',
      timestamp: new Date().toISOString(),
    });
    return;
  }
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const isOperational = err instanceof AppError ? err.isOperational : false;

  logger.error({ err, statusCode, isOperational }, err.message);

  res.status(statusCode).json({
    status: 'error',
    error: isOperational ? err.message : 'Internal server error',
    timestamp: new Date().toISOString(),
  });
}
