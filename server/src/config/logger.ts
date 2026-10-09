import pino from 'pino';
import { env } from './env.js';

/** Pino logger instance. Uses pino-pretty in development; JSON output in production/test. */
export const logger = pino({
  level: env.isDevelopment ? 'debug' : 'info',
  ...(env.isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    },
  }),
});
