import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { FLEET_EVENTS, type CallAnswer, type ClientToServerEvents } from '@appydave/shared';
import { readIdentity } from './identity.js';
import { LOOPBACK_EXPR, apiDocument, pageCsp, renderPages, withLiveHosts } from './doors.js';
import { renderApiPage } from './vendor/api-page.js';
import {
  COOKIE,
  TOKEN,
  loadSnapshot,
  nextUpdate,
  push,
  startHub,
  type RunningHub,
} from '../test/hubHarness.js';

const running: RunningHub[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((h) => h.stop()));
});

async function hubWithFleet() {
  const h = await startHub({ liveHosts: ['127.0.0.1', '100.126.70.25'] });
  running.push(h);
  await push(h.collector({ token: TOKEN, machineId: 'roamy' }), loadSnapshot('roamy'));
  return h;
}

const AUTH = { Authorization: `Bearer ${TOKEN}` };
const AS = { 'x-fli-principal': 'agent:probe' };
const rpc = (h: RunningHub, body: unknown, headers: Record<string, string> = { ...AUTH, ...AS }) =>
  request(h.url)
    .post('/v1/rpc')
    .set(headers)
    .send(body as object);

const version = readIdentity().version;

describe('AC 8 — the API bar on the read verbs', () => {
  it('B1: rpc, /v1/call and the browser socket give the same answer from the one seam', async () => {
    const h = await hubWithFleet();
    const viaRpc = await rpc(h, { jsonrpc: '2.0', id: 1, method: 'seat.list', params: {} });
    const viaCall = await request(h.url)
      .post('/v1/call')
      .set({ ...AUTH, ...AS })
      .send({ verb: 'seat.list' });
    const browser = h.browser();
    await nextUpdate(browser);
    const viaSocket = await new Promise<CallAnswer>((r) =>
      browser.emit(FLEET_EVENTS.CALL, { verb: 'seat.list', input: {} }, r)
    );
    expect(viaRpc.status).toBe(200);
    expect(viaCall.body).toEqual({ ok: true, value: viaRpc.body.result });
    expect(viaSocket).toEqual(viaCall.body);
  });

  it('B3: x-fli-principal is required; a foreign x-*-principal is refused, naming the right header', async () => {
    const h = await hubWithFleet();
    const missing = await rpc(h, { jsonrpc: '2.0', id: 1, method: 'fleet.get' }, AUTH);
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatchObject({
      code: -32004,
      data: { failureMode: 'principal-header', details: { expected: 'x-fli-principal' } },
    });
    const foreign = await rpc(
      h,
      { jsonrpc: '2.0', id: 2, method: 'fleet.get' },
      { ...AUTH, ...AS, 'x-flicast-principal': 'agent:x' }
    );
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.message).toMatch(/x-flicast-principal.*x-fli-principal/);
    expect(foreign.body.error.data.details.got).toEqual(['x-flicast-principal']);
    const viaCall = await request(h.url)
      .post('/v1/call')
      .set({ ...AUTH, 'x-appyrig-principal': 'agent:x' })
      .send({ verb: 'fleet.get' });
    expect(viaCall.status).toBe(400);
    expect(viaCall.body.error.failureMode).toBe('principal-header');
  });

  it('B4: dryRun boolean in params works; a string or a misplaced dryRun is refused', async () => {
    const h = await hubWithFleet();
    const ok = await rpc(h, {
      jsonrpc: '2.0',
      id: 1,
      method: 'machine.list',
      params: { dryRun: true },
    });
    expect(ok.body.result).toBeDefined();
    const str = await rpc(h, {
      jsonrpc: '2.0',
      id: 2,
      method: 'machine.list',
      params: { dryRun: 'true' },
    });
    expect(str.body.error).toMatchObject({ code: -32602, data: { failureMode: 'invalid-input' } });
    const misplaced = await rpc(h, { jsonrpc: '2.0', id: 3, method: 'machine.list', dryRun: true });
    expect(misplaced.body.error).toMatchObject({
      code: -32600,
      data: { failureMode: 'invalid-input' },
    });
    expect(misplaced.body.error.message).toMatch(/dryRun.*params/);
    const badHeader = await rpc(
      h,
      { jsonrpc: '2.0', id: 4, method: 'machine.list' },
      { ...AUTH, ...AS, 'x-fli-dry-run': 'yes' }
    );
    expect(badHeader.status).toBe(400);
  });

  it('B5: a notification (no id) is refused with -32600, and so is a batch', async () => {
    const h = await hubWithFleet();
    const note = await rpc(h, { jsonrpc: '2.0', method: 'fleet.get' });
    expect(note.status).toBe(200);
    expect(note.body.error).toMatchObject({ code: -32600 });
    const batch = await rpc(h, [{ jsonrpc: '2.0', id: 1, method: 'fleet.get' }]);
    expect(batch.body.error).toMatchObject({ code: -32600 });
  });

  it('B7: refusals carry a stable code, failureMode and details', async () => {
    const h = await hubWithFleet();
    const res = await rpc(h, {
      jsonrpc: '2.0',
      id: 7,
      method: 'seat.tail',
      params: { machine: 'm4', seat: 'x' },
    });
    expect(res.body).toMatchObject({
      id: 7,
      error: {
        code: -32002,
        data: { failureMode: 'machine-not-found', details: { known: ['roamy'] } },
      },
    });
    const unknown = await rpc(h, { jsonrpc: '2.0', id: 8, method: 'seat.send' });
    expect(unknown.body.error).toMatchObject({
      code: -32601,
      data: { failureMode: 'unknown-capability' },
    });
    const garbage = await request(h.url)
      .post('/v1/rpc')
      .set({ ...AUTH, ...AS, 'content-type': 'application/json' })
      .send('{ not json');
    expect(garbage.body.error).toMatchObject({ code: -32700 });
  });

  it('B8: /v1/docs and /v1/openrpc.json are open and carry no token and no fleet data', async () => {
    const h = await hubWithFleet();
    for (const path of ['/v1/docs', '/v1/openrpc.json', '/v1/health']) {
      const res = await request(h.url).get(path);
      expect(res.status, path).toBe(200);
      expect(res.text, path).not.toContain(TOKEN);
      expect(res.text, path).not.toMatch(/roamy|kernel@|starter@/);
    }
  });

  it('B14: /v1/health, system.status and OpenRPC info.version all report the app version', async () => {
    const h = await hubWithFleet();
    expect((await request(h.url).get('/v1/health')).body).toEqual({
      ok: true,
      app: 'AppyRig',
      version,
    });
    expect((await request(h.url).get('/v1/openrpc.json')).body.info.version).toBe(version);
    const status = await rpc(h, { jsonrpc: '2.0', id: 1, method: 'system.status' });
    expect(status.body.result).toMatchObject({ app: 'AppyRig', version });
  });

  it('rpc, call and the console need the session; the open doors do not', async () => {
    const h = await hubWithFleet();
    const body = { jsonrpc: '2.0', id: 1, method: 'fleet.get' };
    expect((await request(h.url).post('/v1/rpc').set(AS).send(body)).status).toBe(401);
    expect((await request(h.url).post('/v1/call').set(AS).send({ verb: 'fleet.get' })).status).toBe(
      401
    );
    expect((await request(h.url).get('/v1/console')).status).toBe(401);
    const withCookie = await request(h.url)
      .post('/v1/rpc')
      .set({ ...AS, Cookie: COOKIE })
      .send(body);
    expect(withCookie.body.result.machines).toHaveLength(1);
  });
});

describe('B9 / B10 — docs and console pages', () => {
  it('the console fires as agent:console with dry run ticked, and points at /v1/rpc', async () => {
    const h = await hubWithFleet();
    const res = await request(h.url).get('/v1/console').set('Cookie', COOKIE);
    expect(res.status).toBe(200);
    expect(res.text).toContain('"principal":"agent:console"');
    expect(res.text).toContain('"dryRunDefault":true');
    expect(res.text).toContain('"rpcPath":"/v1/rpc"');
  });

  it('pages carry a CSP that allows only their own inline script and style', async () => {
    const h = await hubWithFleet();
    const res = await request(h.url).get('/v1/docs');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toBe(pageCsp(res.text));
    expect(csp).toMatch(/script-src 'sha256-[^']+'/);
    expect(csp).not.toMatch(/unsafe-inline/);
  });

  it('the which-copy banner counts the hub bind addresses as live, not as a snapshot', () => {
    const page = renderApiPage(apiDocument(readIdentity()), { surface: {} });
    expect(page).toContain(LOOPBACK_EXPR); // fails if the vendored expression ever changes
    const live = withLiveHosts(page, ['100.126.70.25', '::1']);
    expect(live).not.toContain(LOOPBACK_EXPR);
    expect(live).toContain('"100.126.70.25"');
    expect(live).toContain('"[::1]"');
    const pages = renderPages(apiDocument(readIdentity()), ['100.126.70.25']);
    expect(pages.docs).toContain('"100.126.70.25"');
    expect(pages.console).toContain('"100.126.70.25"');
  });

  it('the OpenRPC document is deterministic and lists every verb, all read-only', () => {
    const a = apiDocument(readIdentity());
    expect(JSON.stringify(a)).toBe(JSON.stringify(apiDocument(readIdentity())));
    expect(a.methods).toHaveLength(31);
    const writes = a.methods.filter((m) => m['x-side-effects'] !== 'read-only').map((m) => m.name);
    expect(writes).toEqual([]);
  });
});

describe('shared socket types (r1 P4 M1)', () => {
  it("the app's ClientToServerEvents carries core:call, so the UI can emit it without a cast", () => {
    // Compile-time: typecheck fails if ClientToServerEvents stops extending the browser door.
    const emit: ClientToServerEvents['core:call'] = (_request, ack) =>
      ack({ ok: true, value: null });
    let got: CallAnswer | undefined;
    emit({ verb: 'fleet.get' }, (a) => (got = a));
    expect(got).toEqual({ ok: true, value: null });
  });
});
