import pinoHttp from 'pino-http';
import crypto from 'node:crypto';
import { logger } from '../config/logger.js';

export const requestLogger = pinoHttp({
  logger,
  genReqId: () => crypto.randomUUID(),
  customLogLevel: (_req, res) => {
    const status = res.statusCode;
    if (status >= 500) return 'error';
    if (status >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
});
