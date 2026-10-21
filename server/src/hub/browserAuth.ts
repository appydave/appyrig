import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { AUTH_ERRORS, SESSION_COOKIE, TOKEN_QUERY_PARAM } from '@appydave/shared';

/**
 * Who may talk to the hub (AC 18).
 *
 * - Collectors: the hub token in the `/collector` socket handshake (collectorIngest.ts).
 * - Browsers: the `appyrig_session` cookie, set by visiting `/?token=<hub token>` once.
 * - Agents and scripts over HTTP: `Authorization: Bearer <hub token>` (no cookie jar needed).
 *
 * The cookie value is an HMAC of a fixed label keyed by the hub token, not a random session id:
 * it survives a hub restart (S8: the page reconnects without logging in again), and changing
 * HUB_TOKEN signs every browser out. There is no session table to lose or leak.
 *
 * Open without auth, and carrying no fleet data: OPEN_PATHS.
 */

export const OPEN_PATHS: readonly string[] = [
  '/v1/docs',
  '/v1/openrpc.json',
  '/v1/health',
  '/health',
];

const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

export function sameSecret(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || given.length === 0) {
    return false;
  }

  const a = Buffer.from(given);
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}

export function sessionValue(hubToken: string): string {
  return createHmac('sha256', hubToken).update(`${SESSION_COOKIE}:v1`).digest('base64url');
}

export function sessionCookieHeader(hubToken: string): string {
  return `${SESSION_COOKIE}=${sessionValue(hubToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_S}`;
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const part of header.split(';')) {
    const eq = part.indexOf('=');

    if (eq > 0 && part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }

  return undefined;
}

/** True when the request headers carry a valid session cookie or a bearer hub token. */
export function isAuthorised(headers: IncomingHttpHeaders, hubToken: string | undefined): boolean {
  if (!hubToken) {
    return false;
  }

  if (sameSecret(readCookie(headers.cookie, SESSION_COOKIE), sessionValue(hubToken))) {
    return true;
  }

  const auth = headers.authorization;

  return typeof auth === 'string' && auth.startsWith('Bearer ')
    ? sameSecret(auth.slice('Bearer '.length).trim(), hubToken)
    : false;
}

export interface BrowserAuthOptions {
  hubToken: string | undefined;
  /** Where a successful `/?token=` visit lands. `/` when the hub serves the client itself. */
  afterLogin: string;
}

function refuse(res: Response, status: number, error: string): void {
  res.status(status).json({
    status: 'error',
    error,
    login: `Visit /?${TOKEN_QUERY_PARAM}=<hub token> once to get a session cookie`,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Express gate, mounted before every route. Lets OPEN_PATHS through, turns a `/?token=` visit
 * into a session cookie, and refuses everything else without a session.
 */
export function browserAuth(opts: BrowserAuthOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (OPEN_PATHS.includes(req.path)) {
      next();

      return;
    }

    const given = req.query[TOKEN_QUERY_PARAM];

    if (req.method === 'GET' && req.path === '/' && given !== undefined) {
      if (opts.hubToken && sameSecret(given, opts.hubToken)) {
        res.setHeader('Set-Cookie', sessionCookieHeader(opts.hubToken));
        res.redirect(303, opts.afterLogin); // drops the token from the address bar

        return;
      }

      refuse(res, 401, 'hub token invalid');

      return;
    }

    if (isAuthorised(req.headers, opts.hubToken)) {
      next();

      return;
    }

    refuse(res, 401, AUTH_ERRORS.browserSession);
  };
}
