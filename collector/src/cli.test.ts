import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * The appyrig CLI (bin/appyrig.mjs) against a stub hub: the exact request it sends, how it reports
 * a result and a refusal, and its exit codes. Plus the api:check drift gate (scripts/gen-api.ts).
 */
const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'bin/appyrig.mjs');
const TSX = join(ROOT, 'node_modules/.bin/tsx');

interface Seen {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}
let server: Server | undefined;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = undefined;
});

async function stubHub(answer: (seen: Seen) => { status?: number; json: unknown }) {
  const seen: Seen[] = [];
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const s: Seen = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      };
      seen.push(s);
      const a = answer(s);
      res.writeHead(a.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(a.json));
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

function tokenFile() {
  const f = join(mkdtempSync(join(tmpdir(), 'appyrig-cli-')), 'token');
  writeFileSync(f, 'cli-token-0123456789\n');
  return f;
}

function cli(args: string[], env: Record<string, string> = {}) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveRun) => {
    const p = spawn('node', [CLI, ...args], { env: { PATH: process.env.PATH ?? '', ...env } });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stderr += c));
    p.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

describe('appyrig cli', () => {
  it('sends one JSON-RPC call with bearer token and principal, prints the result', async () => {
    const hub = await stubHub(() => ({ json: { jsonrpc: '2.0', id: 1, result: [{ id: 'm2' }] } }));
    const r = await cli(['machine.list', '--json', '--hub', hub.url, '--token-file', tokenFile()]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([{ id: 'm2' }]);
    expect(r.stderr).toContain('appyrig: as cli');
    expect(hub.seen).toHaveLength(1);
    const s = hub.seen[0]!;
    expect(s).toMatchObject({ method: 'POST', url: '/v1/rpc' });
    expect(s.headers.authorization).toBe('Bearer cli-token-0123456789');
    expect(s.headers['x-fli-principal']).toBe('cli');
    expect(s.body).toEqual({ jsonrpc: '2.0', id: 1, method: 'machine.list', params: {} });
  });

  it('key=value and --input become params; --as names the caller; --dry-run goes inside params', async () => {
    const hub = await stubHub(() => ({ json: { jsonrpc: '2.0', id: 1, result: 'ok' } }));
    const r = await cli(
      [
        'seat.tail',
        'machine=m2',
        'lines=20',
        '--input',
        '{"seat":"a@b"}',
        '--as',
        'agent:qa',
        '--dry-run',
        '--json',
      ],
      { APPYRIG_HUB_URL: hub.url, APPYRIG_TOKEN_FILE: tokenFile() }
    );
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('appyrig: as agent:qa');
    expect(hub.seen[0]!.headers['x-fli-principal']).toBe('agent:qa');
    expect(hub.seen[0]!.body).toMatchObject({
      method: 'seat.tail',
      params: { machine: 'm2', lines: 20, seat: 'a@b', dryRun: true },
    });
  });

  it('a refusal exits 1, names the failure mode on stderr, and prints nothing on stdout', async () => {
    const hub = await stubHub(() => ({
      status: 404,
      json: {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32002,
          message: 'No machine "x" has reported.',
          data: { failureMode: 'machine-not-found' },
        },
      },
    }));
    const r = await cli(['seat.list', 'machine=x', '--hub', hub.url, '--token-file', tokenFile()]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('refused: machine-not-found: No machine "x" has reported.');
    expect(r.stdout).toBe('');
  });

  it("a rejected token (the hub's real 401 body) is a setup failure: exit 2, not a refused verb", async () => {
    const hub = await stubHub(() => ({
      status: 401,
      json: { status: 'error', error: 'browser session missing or invalid', timestamp: 'x' },
    }));
    const r = await cli(['machine.list', '--hub', hub.url, '--token-file', tokenFile()]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('hub refused the token (HTTP 401)');
    expect(r.stderr).not.toContain('undefined');
    expect(r.stdout).toBe('');
  });

  it('a refusal prints the field-level issues the hub returned', async () => {
    const hub = await stubHub(() => ({
      json: {
        jsonrpc: '2.0',
        id: 1,
        error: {
          code: -32602,
          message: 'input does not match',
          data: {
            failureMode: 'invalid-input',
            details: { issues: [{ path: 'seat', message: 'Required' }] },
          },
        },
      },
    }));
    const r = await cli(['seat.get', 'machine=m2', '--hub', hub.url, '--token-file', tokenFile()]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('refused: invalid-input: input does not match');
    expect(r.stderr).toContain('seat: Required');
  });

  it('exit 2 for usage problems and an unreachable hub, never a silent 0', async () => {
    expect((await cli([])).code).toBe(2);
    const noToken = await cli(['fleet.get', '--hub', 'http://127.0.0.1:1'], { HOME: tmpdir() });
    expect(noToken.code).toBe(2);
    expect(noToken.stderr).toMatch(/no hub token/);
    const down = await cli([
      'fleet.get',
      '--hub',
      'http://127.0.0.1:1',
      '--token-file',
      tokenFile(),
    ]);
    expect(down.code).toBe(2);
    expect(down.stderr).toMatch(/cannot reach the hub/);
    const bad = await cli([
      'fleet.get',
      'oops',
      '--hub',
      'http://127.0.0.1:1',
      '--token-file',
      tokenFile(),
    ]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toMatch(/key=value/);
  });

  it('docs and console print the hub URLs; verbs lists the openrpc methods', async () => {
    const hub = await stubHub(() => ({
      json: { methods: [{ name: 'fleet.get', summary: 'Every machine' }, { name: 'seat.get' }] },
    }));
    expect((await cli(['docs', '--hub', hub.url])).stdout.trim()).toBe(`${hub.url}/v1/docs`);
    expect((await cli(['console', '--hub', hub.url])).stdout.trim()).toBe(`${hub.url}/v1/console`);
    const v = await cli(['verbs', '--hub', hub.url]);
    expect(v.stdout).toBe('fleet.get\tEvery machine\nseat.get\t\n');
    expect(hub.seen.map((s) => s.url)).toEqual(['/v1/openrpc.json']);
  });

  it('never calls anything but /v1/rpc and /v1/openrpc.json (read-only door)', () => {
    const src = readFileSync(CLI, 'utf8');
    const paths = [...src.matchAll(/\/v1\/[a-z.]+/g)].map((m) => m[0]);
    expect(new Set(paths)).toEqual(new Set(['/v1/openrpc.json', '/v1/rpc']));
  });
});

describe('api:check (B12 drift gate)', () => {
  const gen = (args: string[]) =>
    spawnSync(TSX, [join(ROOT, 'scripts/gen-api.ts'), ...args], { cwd: ROOT, encoding: 'utf8' });

  it('the committed api/ files are current', () => {
    const r = gen(['--check']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/api:check ok \(\d+ verbs, all read-only/);
  });

  it('fails and says which file when one is stale, passes again once regenerated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'appyrig-api-'));
    for (const f of ['openrpc.json', 'reference.html'])
      copyFileSync(join(ROOT, 'api', f), join(dir, f));
    expect(gen(['--check', '--dir', dir]).status).toBe(0);

    writeFileSync(
      join(dir, 'openrpc.json'),
      readFileSync(join(dir, 'openrpc.json'), 'utf8').replace('"fleet.get"', '"fleet.gett"')
    );
    const stale = gen(['--check', '--dir', dir]);
    expect(stale.status).toBe(1);
    expect(stale.stderr).toContain('api/openrpc.json is stale');

    execFileSync(TSX, [join(ROOT, 'scripts/gen-api.ts'), '--dir', dir], { cwd: ROOT });
    expect(gen(['--check', '--dir', dir]).status).toBe(0);
  });

  it('a missing reference page is also drift', () => {
    const dir = mkdtempSync(join(tmpdir(), 'appyrig-api-'));
    copyFileSync(join(ROOT, 'api/openrpc.json'), join(dir, 'openrpc.json'));
    const r = gen(['--check', '--dir', dir]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('api/reference.html is stale');
  });
});
