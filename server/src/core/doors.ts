import { createHash } from 'node:crypto';
import { Router, json, type NextFunction, type Request, type Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import {
  FEEDBACK_BODY_LIMIT,
  FEEDBACK_ROUTE,
  FeedbackIdSchema,
  type CallAnswer,
} from '@appydave/shared';
import { PRINCIPAL_HEADER } from './vendor/capability.js';
import { JSONRPC_CODES } from './vendor/failure-codes.js';
import { answerJsonRpc, toOpenRpc, type OpenRpcDocument } from './vendor/openrpc.js';
import { renderApiPage } from './vendor/api-page.js';
import { ALWAYS_POSSIBLE, FAILURE_CODES, REFUSAL_DETAILS, VERBS } from './verbs.js';
import type { Core } from './core.js';
import type { AppIdentity } from './identity.js';

/**
 * The HTTP doors onto the core (plan §0.2). All of them call core.call() and nothing else.
 *
 *   GET  /v1/health        open   app + version (B14), no fleet data
 *   GET  /v1/openrpc.json  open   the generated spec (B8, B12), no fleet data
 *   GET  /v1/docs          open   read-only reference page with a which-copy banner (B8, B10)
 *   GET  /v1/console       session  callable console, fires as agent:console, dry run ticked (B9)
 *   POST /v1/rpc           session  JSON-RPC 2.0 (B3, B4, B5, B7)
 *   POST /v1/call          session  { verb, input, dryRun } → { ok, value | error }
 *   POST /v1/feedback      session  the body IS feedback.add's input (it may carry a PNG, so it has its own 5 MB body limit);
 *                                   answers like /v1/call, 201 when a note was filed
 *   GET  /v1/feedback/:id/screenshot.png   session  the PNG of a note
 *
 * "open" = listed in OPEN_PATHS (hub/browserAuth.ts); everything else is behind the session.
 */

export const RPC_PATH = '/v1/rpc';
export const CONSOLE_PATH = '/v1/console';
export const DOCS_PATH = '/v1/docs';
export const CONSOLE_PRINCIPAL = 'agent:console';
const DRY_RUN_HEADER = 'x-fli-dry-run';
const NAMES = {
  unknownCapability: 'unknown-capability',
  invalidInput: 'invalid-input',
  internal: 'internal',
};

/** The OpenRPC document. Deterministic: the same registry and version give the same bytes. */
export function apiDocument(identity: AppIdentity): OpenRpcDocument {
  return toOpenRpc({
    title: identity.title,
    version: identity.version,
    description:
      'Read-only live view of OpenRig agent teams across machines. Every verb reads the last snapshot each machine pushed to this hub; none sends anything to a seat. ' +
      `POST JSON-RPC 2.0 to ${RPC_PATH} with header ${PRINCIPAL_HEADER} (agent:<name>, cli or human[:surface]) and the hub session cookie or Authorization: Bearer <hub token>.`,
    servers: [{ name: 'hub', url: RPC_PATH, summary: 'this hub (same origin)' }],
    capabilities: VERBS,
    codes: FAILURE_CODES,
    refusalDetails: REFUSAL_DETAILS,
    alwaysPossible: ALWAYS_POSSIBLE,
    generatedBy: 'server/src/core/doors.ts apiDocument()',
  });
}

/**
 * fli-core's which-copy banner (B10) calls a page LIVE only on a loopback hostname and a
 * SNAPSHOT anywhere else. The hub is meant to be read from other machines over Tailscale, so the
 * served pages also count the hub's own bind addresses as live. Done here, on the rendered bytes,
 * so the vendored file stays unchanged; a test fails if the upstream expression ever moves.
 */
export const LOOPBACK_EXPR = "['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)";

export function withLiveHosts(html: string, hosts: string[]): string {
  if (!html.includes(LOOPBACK_EXPR)) throw new Error('api page: which-copy expression not found');
  const names = new Set(['127.0.0.1', 'localhost', '[::1]']);
  for (const h of hosts) names.add(h.includes(':') ? `[${h}]` : h);
  return html.replace(LOOPBACK_EXPR, `${JSON.stringify([...names])}.includes(location.hostname)`);
}

/** CSP that allows exactly this page's inline script and style, nothing from anywhere else. */
export function pageCsp(html: string): string {
  const hash = (body: string) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`;
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => hash(m[1]!));
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => hash(m[1]!));
  return [
    "default-src 'none'",
    `script-src ${scripts.join(' ')}`,
    `style-src ${styles.join(' ')}`,
    "connect-src 'self'",
    "img-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export interface ApiPages {
  docs: string;
  console: string;
}

export function renderPages(doc: OpenRpcDocument, liveHosts: string[]): ApiPages {
  const consoleHint = `open ${CONSOLE_PATH} on this hub (sign in once with /?token=<hub token>), or run: appyrig <verb> --json`;
  return {
    docs: withLiveHosts(
      renderApiPage(doc, {
        otherPage: { href: CONSOLE_PATH, label: 'Open the console' },
        surface: { consoleHint },
      }),
      liveHosts
    ),
    console: withLiveHosts(
      renderApiPage(doc, {
        console: {
          rpcPath: RPC_PATH,
          principal: CONSOLE_PRINCIPAL,
          dryRun: true,
          dryRunDefault: true,
        },
        otherPage: { href: DOCS_PATH, label: 'Read-only reference' },
        surface: { consoleHint },
      }),
      liveHosts
    ),
  };
}

// ── principal and dry-run headers (B3, B4) ─────────────────────────────────────────────────────

type HeaderCheck =
  | { ok: true; principal: string; dryRun: boolean | undefined }
  | { ok: false; failureMode: string; message: string; details: unknown };

export function readCallHeaders(headers: IncomingHttpHeaders): HeaderCheck {
  const foreign = Object.keys(headers).filter(
    (h) => /^x-[a-z0-9-]+-principal$/.test(h) && h !== PRINCIPAL_HEADER
  );
  const principal = headers[PRINCIPAL_HEADER];
  if (foreign.length > 0 || typeof principal !== 'string' || principal === '') {
    return {
      ok: false,
      failureMode: 'principal-header',
      message:
        foreign.length > 0
          ? `${foreign.join(', ')} is not read here; name yourself in ${PRINCIPAL_HEADER}. Nothing was done.`
          : `Name yourself in ${PRINCIPAL_HEADER} (agent:<name>, cli or human[:surface]). Nothing was done.`,
      details: { expected: PRINCIPAL_HEADER, got: foreign },
    };
  }
  const dry = headers[DRY_RUN_HEADER];
  if (dry !== undefined && dry !== '1' && dry !== '0') {
    return {
      ok: false,
      failureMode: 'invalid-input',
      message: `${DRY_RUN_HEADER} must be 1 or 0. Nothing was done.`,
      details: { issues: [{ path: DRY_RUN_HEADER, message: `got ${JSON.stringify(dry)}` }] },
    };
  }
  return { ok: true, principal, dryRun: dry === undefined ? undefined : dry === '1' };
}

const ENVELOPE_KEYS = new Set(['jsonrpc', 'method', 'params', 'id']);

function rpcError(id: unknown, code: number, message: string, data: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, data } };
}

const STATUS: Record<string, number> = {
  forbidden: 403,
  'invalid-input': 400,
  'principal-header': 400,
  'unknown-capability': 404,
  'machine-not-found': 404,
  'seat-not-found': 404,
  'handoff-not-found': 404,
  'rig-not-found': 404,
  'file-not-found': 404,
  'feedback-not-found': 404,
  'feedback-unavailable': 503,
  'feedback-full': 409,
  'library-item-not-found': 404,
  internal: 500,
};

export function apiRouter(
  core: Core,
  identity: AppIdentity,
  liveHosts: string[],
  /** The PNG of a feedback note by id, or undefined. The id is checked against the id pattern before it gets here and again in the store. */
  screenshotOf: (id: string) => Buffer | undefined = () => undefined
): Router {
  const doc = apiDocument(identity);
  const pages = renderPages(doc, liveHosts);
  const csp = { docs: pageCsp(pages.docs), console: pageCsp(pages.console) };
  const router = Router();

  router.get('/v1/health', (_req, res) => {
    res.json({ ok: true, app: identity.title, version: identity.version });
  });
  router.get('/v1/openrpc.json', (_req, res) => {
    res.json(doc);
  });
  router.get(DOCS_PATH, (_req, res) => {
    res.setHeader('Content-Security-Policy', csp.docs).type('html').send(pages.docs);
  });
  router.get(CONSOLE_PATH, (_req, res) => {
    res.setHeader('Content-Security-Policy', csp.console).type('html').send(pages.console);
  });

  router.post(RPC_PATH, async (req, res) => {
    const body: unknown = req.body;
    const id =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as { id?: unknown }).id
        : null;
    const headers = readCallHeaders(req.headers);
    if (!headers.ok) {
      res.status(400).json(
        rpcError(
          id,
          FAILURE_CODES[headers.failureMode as keyof typeof FAILURE_CODES],
          headers.message,
          {
            failureMode: headers.failureMode,
            details: headers.details,
          }
        )
      );
      return;
    }
    if (Array.isArray(body)) {
      res.json(
        rpcError(
          null,
          JSONRPC_CODES.invalidRequest,
          'Batches are refused here; send one request.',
          {
            failureMode: 'invalid-input',
          }
        )
      );
      return;
    }
    if (typeof body === 'object' && body !== null) {
      const extra = Object.keys(body).filter((k) => !ENVELOPE_KEYS.has(k));
      if (extra.length > 0) {
        res.json(
          rpcError(
            id,
            JSONRPC_CODES.invalidRequest,
            `${extra.join(', ')} is not a JSON-RPC envelope key; put it inside "params". Nothing was done.`,
            {
              failureMode: 'invalid-input',
              details: { issues: extra.map((k) => ({ path: k, message: 'misplaced' })) },
            }
          )
        );
        return;
      }
    }
    const answer = await answerJsonRpc(
      body,
      async (method, params) => {
        const { dryRun, ...input } = params;
        if (dryRun !== undefined && headers.dryRun !== undefined && dryRun !== headers.dryRun) {
          return {
            ok: false,
            error: {
              failureMode: 'invalid-input',
              message: `params.dryRun and ${DRY_RUN_HEADER} disagree. Nothing was done.`,
            },
          };
        }
        return core.call(headers.principal, method, input, { dryRun: dryRun ?? headers.dryRun });
      },
      { codes: FAILURE_CODES, names: NAMES, refuseNotifications: true }
    );
    if (answer === null) res.status(204).end();
    else res.json(answer);
  });

  // feedback.add over HTTP: the only door that takes a big body, so it carries its own limit.
  // (The hub's global JSON parser skips this path; see createHub.)
  router.post(FEEDBACK_ROUTE, json({ limit: FEEDBACK_BODY_LIMIT }), (req, res) => {
    const headers = readCallHeaders(req.headers);
    const send = (answer: CallAnswer) =>
      res.status(answer.ok ? 201 : (STATUS[answer.error.failureMode] ?? 400)).json(answer);
    if (!headers.ok) {
      send({
        ok: false,
        error: {
          failureMode: headers.failureMode,
          message: headers.message,
          details: headers.details,
        },
      });
      return;
    }
    send(core.call(headers.principal, 'feedback.add', req.body, { dryRun: headers.dryRun }));
  });

  router.get(`${FEEDBACK_ROUTE}/:id/screenshot.png`, (req, res) => {
    const id = FeedbackIdSchema.safeParse(req.params.id);
    const png = id.success ? screenshotOf(id.data) : undefined;
    if (!png) {
      res.status(404).json({
        ok: false,
        error: { failureMode: 'feedback-not-found', message: 'No such screenshot.' },
      });
      return;
    }
    res
      .type('image/png')
      .set('Cache-Control', 'private, max-age=31536000, immutable')
      .set('X-Content-Type-Options', 'nosniff')
      .send(png);
  });

  router.post('/v1/call', (req, res) => {
    const headers = readCallHeaders(req.headers);
    const send = (answer: CallAnswer) =>
      res.status(answer.ok ? 200 : (STATUS[answer.error.failureMode] ?? 400)).json(answer);
    if (!headers.ok) {
      send({
        ok: false,
        error: {
          failureMode: headers.failureMode,
          message: headers.message,
          details: headers.details,
        },
      });
      return;
    }
    const body = req.body as { verb?: unknown; input?: unknown; dryRun?: unknown } | undefined;
    const extra = Object.keys(body ?? {}).filter((k) => !['verb', 'input', 'dryRun'].includes(k));
    if (typeof body?.verb !== 'string' || extra.length > 0) {
      send({
        ok: false,
        error: {
          failureMode: 'invalid-input',
          message: 'Body is { verb, input?, dryRun? }. Nothing was done.',
          details: { issues: extra.map((k) => ({ path: k, message: 'unknown key' })) },
        },
      });
      return;
    }
    send(
      core.call(headers.principal, body.verb, body.input, { dryRun: body.dryRun ?? headers.dryRun })
    );
  });

  return router;
}

/** A body that is not JSON on /v1/rpc is a JSON-RPC parse error, not the app's generic 400. */
export function rpcParseError(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (req.path === RPC_PATH && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json(
      rpcError(null, JSONRPC_CODES.parseError, 'Body is not JSON.', {
        failureMode: 'invalid-input',
      })
    );
    return;
  }
  next(err);
}
