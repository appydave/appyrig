#!/usr/bin/env node
/**
 * appyrig: command-line door onto the AppyRig hub (plan §0.2). Read-only: every verb is a query
 * over the last snapshot each machine pushed. It talks to POST /v1/rpc (JSON-RPC 2.0) and nothing
 * else; the verbs, their inputs and their refusals come from the hub's OpenRPC document.
 *
 *   appyrig <verb> [key=value ...] [--input '<json>'] [--json] [--dry-run] [--as <principal>]
 *   appyrig verbs            list the verbs the hub offers (from /v1/openrpc.json)
 *   appyrig docs             print the URL of the hub's read-only reference page
 *   appyrig console          print the URL of the hub's console page
 *
 * Note: the stored token (~/.config/appyrig/token) is sent to whichever hub you point --hub at.
 * Settings: --hub <url> | APPYRIG_HUB_URL (default http://127.0.0.1:7191)
 *           --token-file <path> | APPYRIG_TOKEN_FILE | APPYRIG_TOKEN | ~/.config/appyrig/token
 * stderr always starts with `appyrig: as <principal>` for a call. Exit 0 ok, 1 the hub refused the
 * call, 2 usage or could not reach the hub.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const DEFAULT_HUB = 'http://127.0.0.1:7191';
const PRINCIPAL_HEADER = 'x-fli-principal';

class Usage extends Error {
  constructor(message, showHelp = true) {
    super(message);
    this.showHelp = showHelp;
  }
}

function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** key=value pairs and/or --input JSON into one params object. */
export function buildParams(positionals, inputJson) {
  let params = {};
  if (inputJson !== undefined) {
    let parsed;
    try {
      parsed = JSON.parse(inputJson);
    } catch {
      throw new Usage('--input must be a JSON object');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Usage('--input must be a JSON object');
    }
    params = parsed;
  }
  for (const pair of positionals) {
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      throw new Usage(`expected key=value, got "${pair}"`);
    }
    params[pair.slice(0, eq)] = parseValue(pair.slice(eq + 1));
  }

  return params;
}

function readToken(values, env, readFile) {
  if (values['token-file']) {
    return readFile(values['token-file']).trim();
  }
  if (env.APPYRIG_TOKEN_FILE) {
    return readFile(env.APPYRIG_TOKEN_FILE).trim();
  }
  if (env.APPYRIG_TOKEN) {
    return env.APPYRIG_TOKEN.trim();
  }
  try {
    return readFile(join(homedir(), '.config/appyrig/token')).trim();
  } catch {
    return '';
  }
}

const HELP = `usage: appyrig <verb> [key=value ...] [--input '<json>'] [--json] [--dry-run] [--as <principal>]
       appyrig verbs | docs | console
options: --hub <url>  --token-file <path>  --json  --dry-run  --as <principal>  -h`;

export async function run(argv, env = process.env, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s));
  const err = io.err ?? ((s) => process.stderr.write(s));
  const readFile = io.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const doFetch = io.fetch ?? fetch;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        hub: { type: 'string' },
        'token-file': { type: 'string' },
        input: { type: 'string' },
        as: { type: 'string' },
        json: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
    const [verb, ...rest] = positionals;
    if (values.help || !verb) {
      out(`${HELP}\n`);

      return values.help ? 0 : 2;
    }
    const hub = (values.hub ?? env.APPYRIG_HUB_URL ?? DEFAULT_HUB).replace(/\/+$/, '');

    if (verb === 'docs' || verb === 'console') {
      out(`${hub}/v1/${verb}\n`);

      return 0;
    }
    if (verb === 'verbs') {
      const res = await doFetch(`${hub}/v1/openrpc.json`);
      if (!res.ok) {
        throw new Usage(`GET /v1/openrpc.json -> HTTP ${res.status}`);
      }
      const doc = await res.json();
      for (const m of doc.methods ?? []) {
        out(`${m.name}\t${m.summary ?? ''}\n`);
      }

      return 0;
    }

    const principal = values.as ?? 'cli';
    const params = buildParams(rest, values.input);
    if (values['dry-run']) {
      params.dryRun = true;
    }
    const token = readToken(values, env, readFile);
    if (!token) {
      throw new Usage(
        'no hub token: set --token-file, APPYRIG_TOKEN_FILE, APPYRIG_TOKEN or ~/.config/appyrig/token'
      );
    }
    err(`appyrig: as ${principal}\n`);
    let res;
    try {
      res = await doFetch(`${hub}/v1/rpc`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          [PRINCIPAL_HEADER]: principal,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: verb, params }),
      });
    } catch (e) {
      throw new Usage(
        `cannot reach the hub at ${hub}: ${e instanceof Error ? e.message : e}`,
        false
      );
    }
    let body;
    try {
      body = await res.json();
    } catch {
      throw new Usage(`hub answered HTTP ${res.status} with a body that is not JSON`);
    }
    // A rejected token is a setup failure, not a refused verb: check the HTTP status first, because
    // the hub's 401 body also has an `error` key (a string) that is not a JSON-RPC error.
    if (res.status === 401 || res.status === 403) {
      throw new Usage(
        `hub refused the token (HTTP ${res.status}): check --token-file / APPYRIG_TOKEN_FILE`,
        false
      );
    }
    if (body && typeof body === 'object' && body.jsonrpc === '2.0' && body.error) {
      const e = body.error;
      const mode = e.data?.failureMode ?? String(e.code);
      err(`appyrig: refused: ${mode}: ${e.message}\n`);
      for (const issue of e.data?.details?.issues ?? []) {
        err(`appyrig:   ${issue.path}: ${issue.message}\n`);
      }
      if (values.json) {
        out(`${JSON.stringify(body.error)}\n`);
      }

      return 1;
    }
    if (!body || typeof body !== 'object' || !('result' in body)) {
      throw new Usage(`unexpected hub answer (HTTP ${res.status})`);
    }
    out(
      values.json ? `${JSON.stringify(body.result)}\n` : `${JSON.stringify(body.result, null, 2)}\n`
    );

    return 0;
  } catch (e) {
    if (e instanceof Usage || e?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
      err(`appyrig: ${e.message}\n${e.showHelp === false ? '' : `${HELP}\n`}`);

      return 2;
    }
    err(`appyrig: ${e instanceof Error ? e.message : e}\n`);

    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await run(process.argv.slice(2));
}
