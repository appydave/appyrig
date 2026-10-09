import type { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger.js';
import { AppError } from '../helpers/AppError.js';

// Re-export so consumers can import AppError from either location.
export { AppError };

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const isOperational = err instanceof AppError ? err.isOperational : false;

  logger.error({ err, statusCode, isOperational }, err.message);

  res.status(statusCode).json({
    status: 'error',
    error: isOperational ? err.message : 'Internal server error',
    timestamp: new Date().toISOString(),
  });
}
