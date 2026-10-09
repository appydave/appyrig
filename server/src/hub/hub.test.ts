import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASLEEP_AFTER_MS, AUTH_ERRORS, SESSION_COOKIE } from '@appydave/shared';
import {
  COOKIE,
  TOKEN,
  connectError,
  loadSnapshot,
  manualClock,
  nextUpdate,
  push,
  startHub,
  type RunningHub,
} from '../test/hubHarness.js';

const running: RunningHub[] = [];
const dirs: string[] = [];
const start = async (...args: Parameters<typeof startHub>) => {
  const h = await startHub(...args);
  running.push(h);
  return h;
};
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'appyrig-hub-'));
  dirs.push(d);
  return d;
};

afterEach(async () => {
  await Promise.all(running.splice(0).map((h) => h.stop()));
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

describe('AC 5 — collector → hub → browser over Socket.IO', () => {
  it('a browser socket gets fleet:update within 1 s of a collector push', async () => {
    const h = await start();
    const browser = h.browser();
    expect(await nextUpdate(browser)).toMatchObject({ full: true, machines: [] });

    const collector = h.collector({ token: TOKEN, machineId: 'roamy' });
    const update = nextUpdate(browser);
    const sentAt = Date.now();
    const ack = await push(collector, loadSnapshot('roamy'));
    const got = await update;
    const elapsed = Date.now() - sentAt;

    expect(ack.ok).toBe(true);
    expect(elapsed).toBeLessThan(1_000);
    expect(got.full).toBe(false);
    expect(got.machines).toHaveLength(1);
    expect(got.machines[0]).toMatchObject({ machine: { id: 'roamy' }, liveness: 'live' });
  });

  it('a new browser gets every known machine on connect (full: true)', async () => {
    const h = await start();
    await push(h.collector({ token: TOKEN, machineId: 'roamy' }), loadSnapshot('roamy'));
    await push(h.collector({ token: TOKEN, machineId: 'm2' }), loadSnapshot('m2'));
    const first = await nextUpdate(h.browser());
    expect(first.full).toBe(true);
    expect(first.machines.map((m) => m.machine.id)).toEqual(['m2', 'roamy']);
  });

  it('refuses a collector with no token, and one with a wrong token', async () => {
    const h = await start();
    const none = await connectError(h.collector({ machineId: 'roamy' }));
    expect(none.message).toBe(AUTH_ERRORS.collectorToken);
    const wrong = await connectError(h.collector({ token: 'x'.repeat(25), machineId: 'roamy' }));
    expect(wrong.message).toBe(AUTH_ERRORS.collectorToken);
  });

  it('refuses every collector when the hub has no token', async () => {
    const h = await start({ hubToken: undefined });
    const err = await connectError(h.collector({ token: TOKEN, machineId: 'roamy' }));
    expect(err.message).toBe(AUTH_ERRORS.collectorToken);
  });

  it('refuses an invalid snapshot and a machine mismatch as data, storing neither', async () => {
    const h = await start();
    const collector = h.collector({ token: TOKEN, machineId: 'roamy' });
    expect(await push(collector, { schemaVersion: 1 })).toMatchObject({
      ok: false,
      failureMode: 'invalid_snapshot',
    });
    expect(await push(collector, loadSnapshot('m2'))).toMatchObject({
      ok: false,
      failureMode: 'machine_mismatch',
    });
    expect(h.hub.store.list()).toEqual([]);
  });
});

describe('AC 6 — liveness', () => {
  it('a silent machine turns asleep at ASLEEP_AFTER_MS, keeps lastSeen and its seats', async () => {
    const clock = manualClock();
    const h = await start({ now: clock.now });
    const browser = h.browser();
    await nextUpdate(browser);
    const snapshot = loadSnapshot('roamy');
    const ack = await push(h.collector({ token: TOKEN, machineId: 'roamy' }), snapshot);
    const lastSeen = ack.receivedAt;

    clock.advance(ASLEEP_AFTER_MS - 1);
    expect(h.hub.sweep()).toEqual([]);

    const update = nextUpdate(browser);
    clock.advance(1);
    const changed = h.hub.sweep();
    expect(changed.map((m) => m.machine.id)).toEqual(['roamy']);

    const got = await update;
    expect(got.full).toBe(false);
    const roamy = got.machines[0]!;
    expect(roamy.liveness).toBe('asleep');
    expect(roamy.lastSeen).toBe(lastSeen);
    // Seats keep their last-known state; the hub never rewrites them as idle.
    expect(roamy.snapshot.seats.map((s) => s.status)).toEqual(snapshot.seats.map((s) => s.status));

    // Already asleep: no second emit.
    clock.advance(60_000);
    expect(h.hub.sweep()).toEqual([]);
  });

  it('an asleep machine is live again on its next push', async () => {
    const clock = manualClock();
    const h = await start({ now: clock.now });
    const collector = h.collector({ token: TOKEN, machineId: 'roamy' });
    await push(collector, loadSnapshot('roamy'));
    clock.advance(ASLEEP_AFTER_MS);
    h.hub.sweep();
    expect(h.hub.store.get('roamy')?.liveness).toBe('asleep');

    const browser = h.browser();
    await nextUpdate(browser);
    const update = nextUpdate(browser);
    await push(collector, loadSnapshot('roamy'));
    expect((await update).machines[0]).toMatchObject({ liveness: 'live' });
  });

  it('the timer does the sweep on its own once started (real clock, short threshold)', async () => {
    const h = await start({ asleepAfterMs: 200, livenessIntervalMs: 25 });
    h.hub.start();
    const browser = h.browser();
    await nextUpdate(browser);
    const collector = h.collector({ token: TOKEN, machineId: 'roamy' });
    await push(collector, loadSnapshot('roamy'));
    collector.close(); // the collector stops
    const got = await new Promise<string>((resolve) =>
      browser.on('fleet:update', (u) => {
        const m = u.machines.find((x: { machine: { id: string } }) => x.machine.id === 'roamy');
        if (m?.liveness === 'asleep') resolve(m.liveness);
      })
    );
    expect(got).toBe('asleep');
  });
});

describe('AC 18 — browser auth', () => {
  it('refuses HTTP / and the browser socket without a session', async () => {
    const h = await start();
    for (const path of ['/', '/api/info', '/anything']) {
      const res = await request(h.url).get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error).toBe(AUTH_ERRORS.browserSession);
    }
    const err = await connectError(h.browser(''));
    expect(err.message).toBe(AUTH_ERRORS.browserSession);
  });

  it('a one-time /?token= visit sets the session cookie, which then opens HTTP and the socket', async () => {
    const h = await start();
    const login = await request(h.url).get(`/?token=${TOKEN}`);
    expect(login.status).toBe(303);
    expect(login.headers.location).not.toContain(TOKEN);
    const setCookie = String(login.headers['set-cookie']);
    expect(setCookie).toContain(`${SESSION_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).not.toContain(TOKEN);

    const cookie = setCookie.split(';')[0]!;
    expect(cookie).toBe(COOKIE);
    expect((await request(h.url).get('/api/info').set('Cookie', cookie)).status).toBe(200);
    expect((await nextUpdate(h.browser(cookie))).full).toBe(true);
  });

  it('a wrong /?token= is refused and sets nothing', async () => {
    const h = await start();
    const res = await request(h.url).get('/?token=wrong-token-0123456789');
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('a forged or stale cookie is refused (cookie is bound to the hub token)', async () => {
    const h = await start({ hubToken: 'another-hub-token-987654321' });
    expect((await request(h.url).get('/api/info').set('Cookie', COOKIE)).status).toBe(401);
    const err = await connectError(h.browser(`${SESSION_COOKIE}=forged`));
    expect(err.message).toBe(AUTH_ERRORS.browserSession);
  });

  it('agents may use Authorization: Bearer <hub token> instead of a cookie', async () => {
    const h = await start();
    const ok = await request(h.url).get('/api/info').set('Authorization', `Bearer ${TOKEN}`);
    expect(ok.status).toBe(200);
    const bad = await request(h.url).get('/api/info').set('Authorization', 'Bearer nope');
    expect(bad.status).toBe(401);
  });

  it('with no hub token at all, no login is possible', async () => {
    const h = await start({ hubToken: undefined });
    expect((await request(h.url).get(`/?token=${TOKEN}`)).status).toBe(401);
    expect((await request(h.url).get('/api/info').set('Cookie', COOKIE)).status).toBe(401);
  });

  it('the open doors pass without a session and carry no fleet data', async () => {
    const h = await start();
    await push(h.collector({ token: TOKEN, machineId: 'roamy' }), loadSnapshot('roamy'));
    for (const path of ['/v1/docs', '/v1/openrpc.json', '/v1/health', '/health']) {
      const res = await request(h.url).get(path);
      expect(res.status, path).not.toBe(401);
      expect(res.text, path).not.toContain('roamy');
      expect(res.text, path).not.toContain(TOKEN);
    }
  });
});

describe('S8 — disk store: a restarted hub shows last-known state at once', () => {
  it('writes data/snapshots/<machine>.json and a new hub loads it with its real lastSeen', async () => {
    const dataDir = tempDir();
    const clock = manualClock();
    const first = await start({ dataDir, now: clock.now });
    const ack = await push(
      first.collector({ token: TOKEN, machineId: 'roamy' }),
      loadSnapshot('roamy')
    );
    await first.hub.store.flush();
    const stored = JSON.parse(readFileSync(join(dataDir, 'snapshots', 'roamy.json'), 'utf8'));
    expect(stored.lastSeen).toBe(ack.receivedAt);
    expect(stored.snapshot.machine.id).toBe('roamy');
    expect(stored).not.toHaveProperty('liveness'); // derived on load, never stored

    // Restart 5 s later: still within the window → live.
    clock.advance(5_000);
    const second = await start({ dataDir, now: clock.now });
    await second.hub.load();
    const update = await nextUpdate(second.browser());
    expect(update.machines[0]).toMatchObject({ liveness: 'live', lastSeen: ack.receivedAt });

    // Restart an hour later: asleep from the first paint, with the real lastSeen.
    clock.advance(3_600_000);
    const third = await start({ dataDir, now: clock.now });
    await third.hub.load();
    const later = await nextUpdate(third.browser());
    expect(later.machines[0]).toMatchObject({ liveness: 'asleep', lastSeen: ack.receivedAt });
  });

  it('skips and reports a corrupt file or one named for another machine', async () => {
    const dataDir = tempDir();
    const snaps = join(dataDir, 'snapshots');
    mkdirSync(snaps, { recursive: true });
    writeFileSync(join(snaps, 'broken.json'), '{ not json');
    writeFileSync(
      join(snaps, 'm4.json'),
      JSON.stringify({ lastSeen: '2026-10-09T12:00:00.000Z', snapshot: loadSnapshot('roamy') })
    );
    writeFileSync(
      join(snaps, 'm2.json'),
      JSON.stringify({ lastSeen: '2026-10-09T12:00:00.000Z', snapshot: loadSnapshot('m2') })
    );
    const errors: string[] = [];
    const h = await start({ dataDir, onDiskError: (m) => errors.push(m) });
    const loaded = await h.hub.load();
    expect(loaded.map((m) => m.machine.id)).toEqual(['m2']);
    expect(errors).toHaveLength(2);
    expect(errors.join('\n')).toMatch(/broken\.json/);
    expect(errors.join('\n')).toMatch(/m4\.json holds machine roamy/);
  });

  it('a missing data folder is an empty fleet, not an error', async () => {
    const errors: string[] = [];
    const h = await start({
      dataDir: join(tempDir(), 'never-created'),
      onDiskError: (m) => errors.push(m),
    });
    expect(await h.hub.load()).toEqual([]);
    expect(errors).toEqual([]);
  });
});
