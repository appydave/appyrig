import pinoHttp from 'pino-http';
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Logger } from 'pino';
import { TOKEN_QUERY_PARAM } from '@appydave/shared';
import { logger } from '../config/logger.js';

/**
 * Request logging that never writes a credential (r1 H1). The hub log becomes a launchd log file
 * in P6, and a hub run in a tmux pane would be captured onto the wall. So:
 * - the `/?token=` value is masked in the url and the success line;
 * - the request is logged from an allow-list (method, masked url, host, user agent, peer), so
 *   the Authorization header (Bearer hub token) and the Cookie header (session) never appear;
 * - the response is logged as its status only, so a login's Set-Cookie never appears.
 */

/** Paths agents and health checks poll; a success on them is logged at debug, not info. */
export const QUIET_PATHS = new Set(['/v1/rpc', '/v1/call', '/v1/health', '/health']);

const TOKEN_IN_URL = new RegExp(`([?&]${TOKEN_QUERY_PARAM}=)[^&#]*`, 'gi');

export function maskUrl(url: string | undefined): string {
  return (url ?? '').replace(TOKEN_IN_URL, '$1[redacted]');
}

export function createRequestLogger(log: Logger) {
  return pinoHttp({
    logger: log,
    genReqId: () => crypto.randomUUID(),
    customLogLevel: (req, res) => {
      const status = res.statusCode;
      if (status >= 500) return 'error';
      if (status >= 400) return 'warn';
      // A poller hitting these every second filled the production log (P6): routine successes
      // drop to debug, which production does not print. Failures above still show.
      if (QUIET_PATHS.has((req.url ?? '').split('?')[0]!)) return 'debug';
      return 'info';
    },
    customSuccessMessage: (req, res) => `${req.method} ${maskUrl(req.url)} ${res.statusCode}`,
    serializers: {
      req: (req: IncomingMessage & { id?: unknown; raw?: IncomingMessage }) => {
        // pino-http hands serializers its own wrapped request; the original is on .raw.
        const raw = req.raw ?? req;
        return {
          id: req.id,
          method: raw.method,
          url: maskUrl(raw.url),
          host: raw.headers?.host,
          userAgent: raw.headers?.['user-agent'],
          remoteAddress: raw.socket?.remoteAddress,
        };
      },
      // Status only: response headers include Set-Cookie (the session) on a login.
      res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
    },
  });
}

export const requestLogger = createRequestLogger(logger);
