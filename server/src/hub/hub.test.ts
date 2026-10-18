import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASLEEP_AFTER_MS,
  AUTH_ERRORS,
  SESSION_COOKIE,
  SeatHistoryEventSchema,
  MachineSnapshotSchema,
} from '@appydave/shared';
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

  it("D09 W2: a rig's planned edges reach the browser; a snapshot without them still loads", async () => {
    const h = await start();
    const browser = h.browser();
    await nextUpdate(browser);
    const snap = loadSnapshot('roamy');
    const edges = [{ from: 'a@kernel', to: 'b@kernel', kind: 'delegates_to' }];
    const withEdges = { ...snap, rigs: [{ ...snap.rigs[0]!, edges }, ...snap.rigs.slice(1)] };
    const update = nextUpdate(browser);
    expect(await push(h.collector({ token: TOKEN, machineId: 'roamy' }), withEdges)).toMatchObject({
      ok: true,
    });
    expect((await update).machines[0]!.snapshot.rigs[0]!.edges).toEqual(edges);
    expect(loadSnapshot('m2').rigs.every((r) => r.edges === undefined)).toBe(true);
    expect(
      await push(h.collector({ token: TOKEN, machineId: 'm2' }), loadSnapshot('m2'))
    ).toMatchObject({ ok: true });
    // A malformed edge is refused like any other bad field, not stored.
    const bad = { ...snap, rigs: [{ ...snap.rigs[0]!, edges: [{ from: 'a' }] }] };
    expect(await push(h.collector({ token: TOKEN, machineId: 'roamy' }), bad)).toMatchObject({
      ok: false,
      failureMode: 'invalid_snapshot',
    });
  });

  it("D09 W3: a seat's agentRole and keySkills reach the browser; more than five is refused", async () => {
    const h = await start();
    const browser = h.browser();
    await nextUpdate(browser);
    const snap = loadSnapshot('roamy');
    const card = { agentRole: 'implementer', keySkills: ['recipe', 'dev-team:audit-test-quality'] };
    const seats = [{ ...snap.seats[0]!, ...card }, ...snap.seats.slice(1)];
    const update = nextUpdate(browser);
    expect(
      await push(h.collector({ token: TOKEN, machineId: 'roamy' }), { ...snap, seats })
    ).toMatchObject({ ok: true });
    expect((await update).machines[0]!.snapshot.seats[0]).toMatchObject(card);
    const six = [{ ...snap.seats[0]!, keySkills: ['a', 'b', 'c', 'd', 'e', 'f'] }];
    expect(
      await push(h.collector({ token: TOKEN, machineId: 'roamy' }), { ...snap, seats: six })
    ).toMatchObject({ ok: false, failureMode: 'invalid_snapshot' });
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
    const live = nextUpdate(browser);
    const ack = await push(h.collector({ token: TOKEN, machineId: 'roamy' }), snapshot);
    const lastSeen = ack.receivedAt;
    // The push's ack (collector socket) and its fleet:update (browser socket) are independent, and a
    // compressed frame can reach the browser after the ack. Wait for that update before sweeping.
    expect((await live).machines[0]?.liveness).toBe('live');

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

describe('seat.get timeout (BUG-seatget) — fleet pushes are compressed', () => {
  it('negotiates permessage-deflate on the browser websocket', async () => {
    const h = await start();
    const browser = h.browser();
    await nextUpdate(browser);
    // The engine upgrades polling → websocket; wait for it, then read the negotiated extensions.
    await new Promise<void>((resolve) => {
      if (browser.io.engine.transport.name === 'websocket') resolve();
      else browser.io.engine.once('upgrade', () => resolve());
    });
    const ws = (browser.io.engine.transport as unknown as { ws: { extensions: string } }).ws;
    expect(ws.extensions).toContain('permessage-deflate');
  });
});

describe('v1.4 S4 — queue bodies and rig.entry over the hub', () => {
  const bodies = (machineId: string, ids: string[]) => ({
    machineId,
    collectedAt: '2026-10-11T12:00:00.000Z',
    items: ids.map((id) => ({ id, body: `defect text for ${id}`, truncated: false })),
  });
  const sendBodies = (s: Parameters<typeof push>[0], payload: unknown) =>
    new Promise<{ ok: boolean; failureMode?: string }>((resolve) =>
      s
        .timeout(2_000)
        .emit('collector:handoffs', payload, (err: unknown, ack: never) =>
          resolve(err ? { ok: false, failureMode: 'timeout' } : ack)
        )
    );

  it('handoff.get is pending until the body arrives, then present, and refuses an unknown id', async () => {
    const h = await start();
    const snapshot = loadSnapshot('roamy');
    const collector = h.collector({ token: TOKEN, machineId: 'roamy' });
    await push(collector, snapshot);
    const id = snapshot.queue[0]!.id;

    const before = h.hub.core.call('cli', 'handoff.get', { machine: 'roamy', id });
    expect(before).toMatchObject({ ok: true, value: { id, body: null, bodyStatus: 'pending' } });

    expect((await sendBodies(collector, bodies('roamy', [id]))).ok).toBe(true);
    const after = h.hub.core.call('cli', 'handoff.get', { machine: 'roamy', id });
    expect(after).toMatchObject({
      ok: true,
      value: {
        body: `defect text for ${id}`,
        bodyStatus: 'present',
        from: snapshot.queue[0]!.source,
      },
    });

    expect(h.hub.core.call('cli', 'handoff.get', { machine: 'roamy', id: 'nope' })).toMatchObject({
      ok: false,
      error: { failureMode: 'handoff-not-found' },
    });
  });

  it('refuses bodies for another machine and malformed bodies, storing neither', async () => {
    const h = await start();
    const collector = h.collector({ token: TOKEN, machineId: 'roamy' });
    await push(collector, loadSnapshot('roamy'));
    expect(await sendBodies(collector, bodies('m2', ['q']))).toMatchObject({
      ok: false,
      failureMode: 'machine_mismatch',
    });
    expect(await sendBodies(collector, { machineId: 'roamy', items: 'no' })).toMatchObject({
      ok: false,
      failureMode: 'invalid_snapshot',
    });
  });

  it('bodies survive a hub restart (stored on disk)', async () => {
    const dir = tempDir();
    const snapshot = loadSnapshot('roamy');
    const id = snapshot.queue[0]!.id;
    const h1 = await start({ dataDir: dir });
    const c = h1.collector({ token: TOKEN, machineId: 'roamy' });
    await push(c, snapshot);
    await sendBodies(c, bodies('roamy', [id]));
    await h1.hub.store.flush();
    await h1.stop();
    running.splice(running.indexOf(h1), 1);

    const h2 = await start({ dataDir: dir });
    await h2.hub.load();
    expect(h2.hub.core.call('cli', 'handoff.get', { machine: 'roamy', id })).toMatchObject({
      ok: true,
      value: { bodyStatus: 'present' },
    });
  });

  it('old collector → new hub: a snapshot and a history without origin are accepted; new → old is refused', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'roamy' });
    await push(c, loadSnapshot('roamy'));
    const oldEvent = { at: '2026-10-11T09:00:00.000Z', kind: 'prompt', text: 'hi' };
    const ack = await new Promise<{ ok: boolean }>((resolve) =>
      c.emit(
        'collector:history',
        {
          machineId: 'roamy',
          seat: 'a@r',
          collectedAt: '2026-10-11T09:00:00.000Z',
          events: [oldEvent],
          truncated: false,
        },
        resolve
      )
    );
    expect(ack.ok).toBe(true);
    // The pre-v1.4 strict event shape refuses `origin`: an old hub would reject a new collector's history.
    const oldShape = SeatHistoryEventSchema.omit({ origin: true });
    expect(oldShape.safeParse({ ...oldEvent, origin: 'typed' }).success).toBe(false);
    expect(oldShape.safeParse(oldEvent).success).toBe(true);
  });

  it('rig.entry reads the histories the collector pushed', async () => {
    const h = await start();
    const snapshot = loadSnapshot('roamy');
    const seat = snapshot.seats.find((s) => s.rig !== null)!;
    const c = h.collector({ token: TOKEN, machineId: 'roamy' });
    await push(c, snapshot);
    await new Promise((resolve) =>
      c.emit(
        'collector:history',
        {
          machineId: 'roamy',
          seat: seat.id,
          collectedAt: '2026-10-11T09:00:00.000Z',
          truncated: false,
          events: [
            { at: '2026-10-11T09:00:00.000Z', kind: 'prompt', text: 'Fix it.', origin: 'typed' },
            { at: '2026-10-11T09:00:02.000Z', kind: 'tool', text: 'Bash: ls' },
          ],
        },
        resolve
      )
    );
    const out = h.hub.core.call('cli', 'rig.entry', { machine: 'roamy', rig: seat.rig });
    expect(out).toMatchObject({
      ok: true,
      value: { entry: { status: 'outside-queue', entry: { seat: seat.id, excerpt: 'Fix it.' } } },
    });
    expect(h.hub.core.call('cli', 'rig.entry', { machine: 'roamy', rig: 'nope' })).toMatchObject({
      ok: false,
      error: { failureMode: 'rig-not-found' },
    });
  });
});

describe('v1.4 S6 — machine health', () => {
  const ok = <T>(value: T) => ({ status: 'ok' as const, value });
  const health = (sampledAt: string) => ({
    sampledAt,
    memory: {
      totalBytes: ok(34359738368),
      usedBytes: ok(12 * 1024 ** 3),
      pressureLevel: ok('normal' as const),
      freePct: ok(87),
      swapUsedBytes: ok(0),
      swapTotalBytes: {
        status: 'unavailable' as const,
        reason: 'vm.swapusage not reported by sysctl',
      },
    },
    processes: {
      claude: ok(10),
      tmuxSessions: ok(3),
      terminalShells: ok(14),
      terminalApps: ok([{ app: 'iTerm2', processes: 3, rssBytes: 90_000_000 }]),
    },
  });

  it('an old-shape snapshot (no health) answers no-data with a reason, not an error and not zeros', async () => {
    const h = await start();
    await push(h.collector({ token: TOKEN, machineId: 'roamy' }), loadSnapshot('roamy'));
    expect(h.hub.core.call('cli', 'health.get', {})).toMatchObject({
      ok: true,
      value: [
        {
          machine: 'roamy',
          status: 'no-data',
          sampleAgeMs: null,
          health: null,
          reason: expect.stringMatching(/no health data from this collector yet/),
        },
      ],
    });
  });

  it('a snapshot with health returns every reading and the age of the sample; unavailable stays unavailable', async () => {
    const clock = manualClock();
    const h = await start({ now: clock.now });
    const sampled = new Date(clock.now().getTime() - 25_000).toISOString();
    const ack = await push(h.collector({ token: TOKEN, machineId: 'm2' }), {
      ...loadSnapshot('m2'),
      // F3: ages are measured on the collector's clock, so the push is stamped now like a real one
      // (the recorded fixture's collectedAt would read as a clock days behind).
      collectedAt: clock.now().toISOString(),
      health: health(sampled),
    });
    expect(ack.ok).toBe(true);
    const row = (
      h.hub.core.call('cli', 'health.get', { machine: 'm2' }) as {
        value: { status: string; sampleAgeMs: number; health: ReturnType<typeof health> }[];
      }
    ).value[0]!;
    expect(row).toMatchObject({ status: 'ok', sampleAgeMs: 25_000 });
    expect(row.health.memory.swapTotalBytes).toMatchObject({ status: 'unavailable' });
    expect(row.health.processes.terminalApps).toMatchObject({ status: 'ok' });
    clock.advance(60_000);
    expect(
      (
        h.hub.core.call('cli', 'health.get', { machine: 'm2' }) as {
          value: { sampleAgeMs: number }[];
        }
      ).value[0]!.sampleAgeMs
    ).toBe(85_000);
  });

  it('both directions: old collector → new hub accepted; new collector → old hub refused (hub first)', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    expect((await push(c, loadSnapshot('m2'))).ok).toBe(true);
    expect(
      (await push(c, { ...loadSnapshot('m2'), health: health('2026-10-11T12:00:00.000Z') })).ok
    ).toBe(true);
    // The pre-1.4 snapshot schema is strict and has no `health`: an old hub would refuse the push.
    const v13 = MachineSnapshotSchema.omit({ health: true });
    expect(
      v13.safeParse({ ...loadSnapshot('m2'), health: health('2026-10-11T12:00:00.000Z') }).success
    ).toBe(false);
    expect(v13.safeParse(loadSnapshot('m2')).success).toBe(true);
  });

  it('refuses a malformed health reading (a half-made value, or an ok with no value)', async () => {
    const h = await start();
    const bad = {
      ...health('2026-10-11T12:00:00.000Z'),
      memory: { ...health('2026-10-11T12:00:00.000Z').memory, freePct: { status: 'ok' } },
    };
    const ack = await push(h.collector({ token: TOKEN, machineId: 'm2' }), {
      ...loadSnapshot('m2'),
      health: bad,
    });
    expect(ack).toMatchObject({ ok: false, failureMode: 'invalid_snapshot' });
  });
});

describe('v1.4 S7 — rig files and the OpenRig database shape', () => {
  const file = (id: string, content = 'name: x\n') => ({
    id,
    name: id.split(':')[1]!,
    scope: id.split(':')[0] as 'spec' | 'mission',
    bytes: content.length,
    modifiedAt: '2026-10-11T12:00:00.000Z',
    truncated: false,
    content,
  });
  const emit = (s: Parameters<typeof push>[0], event: string, payload: unknown) =>
    new Promise<{ ok: boolean; failureMode?: string }>((resolve) =>
      s
        .timeout(2_000)
        .emit(event, payload, (err: unknown, ack: never) =>
          resolve(err ? { ok: false, failureMode: 'timeout' } : ack)
        )
    );
  const rigOf = (machine: 'm2' | 'roamy', over: object = {}) => {
    const snap = loadSnapshot(machine);
    const rig = {
      ...snap.rigs[0]!,
      specStatus: 'found' as const,
      specPath: '/x/rig.yaml',
      ...over,
    };
    return { snap: { ...snap, rigs: [rig, ...snap.rigs.slice(1)] }, name: rig.name };
  };
  // Loosely typed on purpose: these tests poke at verb answers by shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Answer = { ok: boolean; value?: any; error?: { failureMode: string } };
  const call = (
    h: { hub: { core: { call: (p: string, v: string, i: unknown) => unknown } } },
    verb: string,
    input: unknown
  ) => h.hub.core.call('cli', verb, input) as Answer;

  it('rig.files: pending until the files arrive, then ok; no-spec and no-data say why', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    const { snap, name } = rigOf('m2');
    await push(c, snap);
    expect(call(h, 'rig.files', { machine: 'm2', rig: name }).value).toMatchObject({
      status: 'pending',
      files: [],
    });

    const ack = await emit(c, 'collector:rigfiles', {
      machineId: 'm2',
      collectedAt: '2026-10-11T12:00:00.000Z',
      rig: name,
      replace: true,
      files: [file('spec:rig.yaml'), file('mission:MISSION.md', '# m')],
    });
    expect(ack.ok).toBe(true);
    const list = call(h, 'rig.files', { machine: 'm2', rig: name }).value;
    expect(list).toMatchObject({ status: 'ok', reason: null });
    expect(list.files.map((f: { id: string }) => f.id)).toEqual([
      'spec:rig.yaml',
      'mission:MISSION.md',
    ]);
    expect(list.files[0]).not.toHaveProperty('content'); // names and sizes only
    expect(
      call(h, 'rig.file', { machine: 'm2', rig: name, fileId: 'mission:MISSION.md' }).value.file
        .content
    ).toBe('# m');

    const none = rigOf('roamy', { specStatus: 'not-found', specPath: null });
    await push(h.collector({ token: TOKEN, machineId: 'roamy' }), none.snap);
    expect(call(h, 'rig.files', { machine: 'roamy', rig: none.name }).value).toMatchObject({
      status: 'no-spec',
    });
    const old = loadSnapshot('roamy');
    await push(h.collector({ token: TOKEN, machineId: 'roamy' }), old);
    expect(call(h, 'rig.files', { machine: 'roamy', rig: old.rigs[0]!.name }).value).toMatchObject({
      status: 'no-data',
    });
  });

  it('a later chunk adds files; a new replace drops what is no longer there', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    const { snap, name } = rigOf('m2');
    await push(c, snap);
    const base = { machineId: 'm2', collectedAt: '2026-10-11T12:00:00.000Z', rig: name };
    await emit(c, 'collector:rigfiles', { ...base, replace: true, files: [file('spec:rig.yaml')] });
    await emit(c, 'collector:rigfiles', {
      ...base,
      replace: false,
      files: [file('spec:CULTURE.md')],
    });
    expect(call(h, 'rig.files', { machine: 'm2', rig: name }).value.files).toHaveLength(2);
    await emit(c, 'collector:rigfiles', { ...base, replace: true, files: [file('spec:rig.yaml')] });
    expect(call(h, 'rig.files', { machine: 'm2', rig: name }).value.files).toHaveLength(1);
  });

  it('PATH ESCAPES: a client can only name a file id; paths, dots and absolute paths are refused as input', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    const { snap, name } = rigOf('m2');
    await push(c, snap);
    await emit(c, 'collector:rigfiles', {
      machineId: 'm2',
      collectedAt: '2026-10-11T12:00:00.000Z',
      rig: name,
      replace: true,
      files: [file('spec:rig.yaml')],
    });
    for (const fileId of [
      '../../etc/passwd',
      '/etc/passwd',
      'spec:../../etc/passwd',
      'spec:..',
      'spec:a/b.md',
      'spec:/etc/passwd',
      'rig.yaml',
      'spec:',
      'other:rig.yaml',
      '',
      'spec:rig.yaml/../../x',
    ]) {
      const r = call(h, 'rig.file', { machine: 'm2', rig: name, fileId });
      expect(r.ok, fileId).toBe(false);
      expect(r.error?.failureMode, fileId).toBe('invalid-input');
    }
    // a well-formed id nobody pushed is simply not found, and the answer lists what exists
    const missing = call(h, 'rig.file', { machine: 'm2', rig: name, fileId: 'spec:shadow.md' });
    expect(missing.error?.failureMode).toBe('file-not-found');
    // an extra field (a smuggled path) is refused by the strict input
    expect(
      call(h, 'rig.file', {
        machine: 'm2',
        rig: name,
        fileId: 'spec:rig.yaml',
        path: '/etc/passwd',
      }).error?.failureMode
    ).toBe('invalid-input');
  });

  it('refuses malformed pushes, another machine, and a file id that is a path', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    await push(c, loadSnapshot('m2'));
    const base = { collectedAt: '2026-10-11T12:00:00.000Z', rig: 'r', replace: true };
    expect(
      await emit(c, 'collector:rigfiles', { ...base, machineId: 'roamy', files: [] })
    ).toMatchObject({ failureMode: 'machine_mismatch' });
    expect(
      await emit(c, 'collector:rigfiles', {
        ...base,
        machineId: 'm2',
        files: [file('spec:../../x')],
      })
    ).toMatchObject({ failureMode: 'invalid_snapshot' });
    expect(
      await emit(c, 'collector:rigfiles', { ...base, machineId: 'm2', files: 'no' })
    ).toMatchObject({ failureMode: 'invalid_snapshot' });
  });

  // v1.5 · L1: the loadout channel. Hub first: an old collector (snapshot only, no loadout) must
  // still push, and the verb must then say "pending", never an empty loadout.
  it('loadout: an old collector still pushes; the verb is pending until a loadout arrives, then ok', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    const snap = loadSnapshot('m2');
    expect(await push(c, snap)).toMatchObject({ ok: true });
    const seat = snap.seats.find((s) => s.runtime === 'claude-code')!.id;
    expect(call(h, 'seat.loadout', { machine: 'm2', seat }).value).toMatchObject({
      status: 'pending',
      loadout: null,
    });
    const loadout = {
      machineId: 'm2',
      seat,
      collectedAt: '2026-10-12T00:00:00.000Z',
      runtime: 'claude-code',
      cwd: '/w',
      status: 'ok',
      listing: {
        at: '2026-10-11T11:18:09.715Z',
        skillCount: 1,
        isInitial: true,
        deltas: 0,
        reported: 1,
        listings: 1,
        transcript: '/t.jsonl',
      },
      cwdIsGitRepo: true,
      cwdExists: true,
      skills: [{ name: 'recipe', source: 'repo', plugin: null, alsoIn: [] }],
      layers: [],
    };
    expect(await emit(c, 'collector:loadout', loadout)).toMatchObject({ ok: true });
    expect(call(h, 'seat.loadout', { machine: 'm2', seat }).value).toMatchObject({
      status: 'ok',
      loadout: { skills: [{ name: 'recipe', source: 'repo' }] },
    });
    // the snapshot keeps flowing alongside; with the pill's optional skillCount it is accepted and served
    const withPill = {
      ...snap,
      seats: snap.seats.map((s) => (s.id === seat ? { ...s, skillCount: 313 } : s)),
    };
    expect(await push(c, withPill)).toMatchObject({ ok: true });
    expect(call(h, 'seat.get', { machine: 'm2', seat }).value.seat.skillCount).toBe(313);
    expect(await push(c, snap)).toMatchObject({ ok: true });
    expect(await emit(c, 'collector:loadout', { ...loadout, machineId: 'roamy' })).toMatchObject({
      failureMode: 'machine_mismatch',
    });
    expect(
      await emit(c, 'collector:loadout', { ...loadout, skills: [{ name: 'x', source: 'guess' }] })
    ).toMatchObject({ failureMode: 'invalid_snapshot' });
  });

  // v2 data channels: hub first. An old collector (snapshot only) still pushes; the daemon-data
  // event is validated, machine-checked, stored, and served by seat.detail.
  it('daemon data: validated, machine-checked, stored and served; an old collector is unaffected', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    const snap = loadSnapshot('m2');
    // the ack tells the collector what this hub understands; an older hub sends no caps
    expect(await push(c, snap)).toMatchObject({ ok: true, caps: ['v2-fields', 'daemondata'] });
    const seat = snap.seats.find((s) => s.source === 'openrig')!.id;
    expect(call(h, 'seat.detail', { machine: 'm2', seat }).value).toMatchObject({
      status: 'pending',
      detail: null,
    });
    const body = {
      kind: 'seatdetail',
      machineId: 'm2',
      key: seat,
      collectedAt: '2026-10-18T12:00:00.000Z',
      status: 'ok',
      reason: null,
      data: {
        spec: null,
        startupFiles: [],
        startupActions: [],
        peers: [],
        recoveryNotes: [],
        installedResources: [],
      },
    };
    expect(await emit(c, 'collector:daemondata', body)).toMatchObject({ ok: true });
    expect(call(h, 'seat.detail', { machine: 'm2', seat }).value).toMatchObject({ status: 'ok' });
    expect(await emit(c, 'collector:daemondata', { ...body, machineId: 'roamy' })).toMatchObject({
      failureMode: 'machine_mismatch',
    });
    expect(await emit(c, 'collector:daemondata', { ...body, kind: 'nope' })).toMatchObject({
      failureMode: 'invalid_snapshot',
    });
    expect(
      await emit(c, 'collector:daemondata', { ...body, data: { ...body.data, extra: 1 } })
    ).toMatchObject({ failureMode: 'invalid_snapshot' });
  });

  const col = (name: string, type = 'TEXT') => ({
    name,
    type,
    notNull: false,
    pk: 0,
    default: null,
  });
  const schemaPush = (version: string | null, cols: string[], over: object = {}) => ({
    machineId: 'm2',
    collectedAt: '2026-10-11T12:00:00.000Z',
    status: 'ok' as const,
    reason: null,
    openrigVersion: version,
    tables: [
      { name: 'rigs', kind: 'table' as const, columns: cols.map((c) => col(c)), foreignKeys: [] },
    ],
    ...over,
  });

  it('db.schema: baseline on the first version, then a diff when the OpenRig version changes', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    await push(c, loadSnapshot('m2'));
    expect(call(h, 'db.schema', { machine: 'm2' }).value).toMatchObject({
      status: 'no-data',
      tables: [],
      changes: null,
    });

    await emit(c, 'collector:schema', schemaPush('0.6.6 (2620dea8)', ['id', 'name']));
    expect(call(h, 'db.schema', { machine: 'm2' }).value).toMatchObject({
      status: 'ok',
      openrigVersion: '0.6.6 (2620dea8)',
      changes: { status: 'baseline', comparedTo: null },
      versionsSeen: [{ version: '0.6.6 (2620dea8)' }],
    });
    expect(
      call(h, 'db.schema', { machine: 'm2' }).value.tables[0].columns.map(
        (x: { name: string }) => x.name
      )
    ).toEqual(['id', 'name']);

    await emit(c, 'collector:schema', schemaPush('0.7.0 (abc12345)', ['id', 'name', 'owner']));
    const v = call(h, 'db.schema', { machine: 'm2' }).value;
    expect(v.openrigVersion).toBe('0.7.0 (abc12345)');
    expect(v.changes).toMatchObject({
      status: 'changed',
      comparedTo: '0.6.6 (2620dea8)',
      changedTables: [{ name: 'rigs', addedColumns: ['owner'] }],
    });
    expect(v.versionsSeen.map((x: { version: string }) => x.version)).toEqual([
      '0.6.6 (2620dea8)',
      '0.7.0 (abc12345)',
    ]);

    // a re-sample under the same version just replaces it; the comparison stays against the previous version
    await emit(
      c,
      'collector:schema',
      schemaPush('0.7.0 (abc12345)', ['id', 'name', 'owner', 'extra'])
    );
    expect(
      call(h, 'db.schema', { machine: 'm2' }).value.changes.changedTables[0].addedColumns
    ).toEqual(['owner', 'extra']);
  });

  it('db.schema: no-openrig and unreadable keep their reason and list no tables; a bad status is refused', async () => {
    const h = await start();
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    await push(c, loadSnapshot('m2'));
    await emit(
      c,
      'collector:schema',
      schemaPush(null, [], {
        status: 'no-openrig',
        reason: 'no OpenRig database at ~/.openrig/openrig.sqlite',
        tables: [],
      })
    );
    expect(call(h, 'db.schema', { machine: 'm2' }).value).toMatchObject({
      status: 'no-openrig',
      reason: expect.stringContaining('no OpenRig database'),
      tables: [],
      changes: null,
    });
    expect(
      await emit(c, 'collector:schema', schemaPush(null, [], { status: 'fine' }))
    ).toMatchObject({ failureMode: 'invalid_snapshot' });
  });

  it('db.schema: the history survives a hub restart (kept in AppyRig data dir)', async () => {
    const dir = tempDir();
    const h1 = await start({ dataDir: dir });
    const c = h1.collector({ token: TOKEN, machineId: 'm2' });
    await push(c, loadSnapshot('m2'));
    await emit(c, 'collector:schema', schemaPush('0.6.6', ['id']));
    await emit(c, 'collector:schema', schemaPush('0.7.0', ['id', 'n']));
    await h1.hub.store.flush();
    await h1.stop();
    running.splice(running.indexOf(h1), 1);
    const h2 = await start({ dataDir: dir });
    await h2.hub.load();
    await push(h2.collector({ token: TOKEN, machineId: 'm2' }), loadSnapshot('m2'));
    expect(call(h2, 'db.schema', { machine: 'm2' }).value).toMatchObject({
      openrigVersion: '0.7.0',
      changes: { status: 'changed', comparedTo: '0.6.6' },
    });
  });

  it('db.schema: an unknown machine is refused', async () => {
    const h = await start();
    expect(call(h, 'db.schema', { machine: 'nope' }).error?.failureMode).toBe('machine-not-found');
  });

  it('both directions: pre-1.4 hubs know neither event (no listener, no ack); a new hub accepts old collectors, which send neither', async () => {
    // New hub, old collector: simply never sends these. Nothing to refuse; the verbs say so.
    const h = await start();
    await push(h.collector({ token: TOKEN, machineId: 'm2' }), loadSnapshot('m2'));
    expect(call(h, 'db.schema', { machine: 'm2' }).value.status).toBe('no-data');
    // New collector, old hub: the event has no listener there, so no ack comes back. The pusher
    // treats that as "hub older than v1.4" (pusher tests) and the connection stays up.
    const c = h.collector({ token: TOKEN, machineId: 'm2' });
    expect((await emit(c, 'collector:no-such-event-on-an-old-hub', {})).failureMode).toBe(
      'timeout'
    );
  });
});

describe('run card R2 — rig.waiting over the hub', () => {
  const sendBodies = (s: Parameters<typeof push>[0], payload: unknown) =>
    new Promise<{ ok: boolean }>((resolve) =>
      s
        .timeout(2_000)
        .emit('collector:handoffs', payload, (err: unknown, ack: never) =>
          resolve(err ? { ok: false } : ack)
        )
    );

  it('lists gates the newest mention still calls open (with a carried link), and the ssh address', async () => {
    const dir = tempDir();
    const configPath = join(dir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({ machines: { roamy: { ssh: 'davidcruwys@100.89.32.35' } } })
    );
    const h = await start({ configPath });
    const snap = loadSnapshot('roamy');
    const rig = snap.rigs[0]!.name;
    const at = (m: number) => new Date(Date.UTC(2026, 9, 13, 5, m)).toISOString();
    const item = (id: string, m: number, summary: string) => ({
      id,
      source: `lead@${rig}`,
      destination: 'planner@desk',
      state: 'done',
      priority: null,
      tags: [],
      summary,
      createdAt: at(m),
      updatedAt: at(m),
    });
    const queue = [
      item('q1', 1, 'angles gate OPEN for D10 (g_d03e25b293)'),
      item('q2', 2, 'social v3 proposed, gate g_8334a98162 open'),
      item('q3', 3, 'David approved g_d03e25b293: closed'),
      item('q4', 4, 'see g_aaaaaaaaaa for the record'),
      // A later bare mention (a list of ids) does not close an open gate.
      item('q6', 7, 'report lists social v3 gate g_8334a98162 (change 03)'),
      // QA R2 MEDIUM-2: a report to David's mailbox or a handoff inside the rig quoting a gate
      // as open never opens it (it is often another rig's gate)...
      { ...item('q7', 8, 'their gate g_cccccccccc is open'), destination: 'human@kernel' },
      { ...item('q8', 9, 'QA: gate g_dddddddddd open on ylo-d10'), destination: `qa@${rig}` },
      // r1 R2 LOW-1: a closing word elsewhere in the sentence does not hide an open gate.
      item('q11', 12, 'pair B: gate g_ffffffffff OPEN for David; rule check PASSED, copy accepted'),
      // ...and LOW-3: "do not wait on it, leave it" closes one.
      item('q9', 10, 'gate g_eeeeeeeeee open for review'),
      {
        ...item('q10', 11, 'Do NOT poll or wait on FliStudio gate g_eeeeeeeeee. Leave it'),
        source: 'planner@desk',
        destination: `lead@${rig}`,
      },
      {
        ...item('q5', 5, 'other rig: gate g_bbbbbbbbbb open'),
        source: 'x@other-rig',
        destination: 'y@other-rig',
      },
    ];
    const c = h.collector({ token: TOKEN, machineId: 'roamy' });
    await push(c, { ...snap, queue });
    await sendBodies(c, {
      machineId: 'roamy',
      collectedAt: at(6),
      items: [
        {
          id: 'q2',
          body: 'Gate open: http://localhost:7150/b/appydave/p/d10?zone=launch&gate=g_8334a98162 and http://100.82.235.39:7150/b/appydave/p/d10?zone=launch&gate=g_8334a98162#social',
          truncated: false,
        },
      ],
    });
    const out = h.hub.core.call('cli', 'rig.waiting', { machine: 'roamy', rig }) as {
      ok: boolean;
      value: {
        ssh: string | null;
        gates: { gate: string; itemId: string; link: string | null }[];
        scanned: number;
        bodiesMissing: number;
      };
    };
    expect(out.ok).toBe(true);
    expect(out.value.ssh).toBe('davidcruwys@100.89.32.35');
    // g_d03e… was opened then closed; g_aaaa… was never called open; g_bbbb… is another rig's.
    expect(out.value.gates.map((g) => [g.gate, g.itemId, g.link])).toEqual([
      ['g_ffffffffff', 'q11', null],
      [
        'g_8334a98162',
        'q2',
        'http://100.82.235.39:7150/b/appydave/p/d10?zone=launch&gate=g_8334a98162#social',
      ],
    ]);
    expect(out.value).toMatchObject({ scanned: 10, bodiesMissing: 9 });
    expect(h.hub.core.call('cli', 'rig.waiting', { machine: 'roamy', rig: 'nope' })).toMatchObject({
      ok: false,
      error: { failureMode: 'rig-not-found' },
    });
  });

  it('ssh is null when AppyRig config names no address for the machine', async () => {
    const h = await start();
    const snap = loadSnapshot('roamy');
    await push(h.collector({ token: TOKEN, machineId: 'roamy' }), snap);
    expect(
      h.hub.core.call('cli', 'rig.waiting', { machine: 'roamy', rig: snap.rigs[0]!.name })
    ).toMatchObject({ ok: true, value: { ssh: null, gates: [] } });
  });
});

describe('run card R4 — rig.outputs over the hub', () => {
  it('names commits and FliStudio ids from the rig’s handoffs, never a qitem id; newest first', async () => {
    const h = await start();
    const snap = loadSnapshot('roamy');
    const rig = snap.rigs[0]!.name;
    const at = (m: number) => new Date(Date.UTC(2026, 9, 13, 5, m)).toISOString();
    const item = (id: string, m: number, summary: string) => ({
      id,
      source: `build@${rig}`,
      destination: `qa@${rig}`,
      state: 'done',
      priority: null,
      tags: [],
      summary,
      createdAt: at(m),
      updatedAt: at(m),
    });
    const queue = [
      item('q1', 1, 'R1 at 1e48236 for QA; see qitem-20261011150245-a1b2c3d4e5'),
      item('q2', 2, 'R1 fold 2f20b43 (was 1e48236), resource r_03fbe6e76e added'),
      item('q3', 3, 'branch pushed at bdf1d05, gate g_8334a98162 open'),
      item('q4', 4, 'words only: deadbeef is not a sha, nor 1234567, nor feedface'),
      { ...item('q5', 5, 'other rig commit 9999abc'), source: 'x@else', destination: 'y@else' },
    ];
    const c = h.collector({ token: TOKEN, machineId: 'roamy' });
    await push(c, { ...snap, queue });
    await new Promise<{ ok: boolean }>((resolve) =>
      c.timeout(2_000).emit(
        'collector:handoffs',
        {
          machineId: 'roamy',
          collectedAt: at(6),
          items: [
            {
              id: 'q3',
              body: 'Gate: http://100.82.235.39:7150/b/appydave/p/d10?zone=launch&gate=g_8334a98162#social',
              truncated: false,
            },
          ],
        },
        (err: unknown, ack: never) => resolve(err ? { ok: false } : ack)
      )
    );
    const out = h.hub.core.call('cli', 'rig.outputs', { machine: 'roamy', rig }) as {
      ok: boolean;
      value: {
        commits: { sha: string; itemId: string; mentions: number }[];
        flistudio: { id: string; kind: string; link: string | null }[];
        scanned: number;
      };
    };
    expect(out.ok).toBe(true);
    expect(out.value.commits.map((x) => [x.sha, x.itemId, x.mentions])).toEqual([
      ['bdf1d05', 'q3', 1],
      ['1e48236', 'q2', 2],
      ['2f20b43', 'q2', 1],
    ]);
    expect(out.value.flistudio).toEqual([
      expect.objectContaining({
        id: 'g_8334a98162',
        kind: 'gate',
        link: 'http://100.82.235.39:7150/b/appydave/p/d10?zone=launch&gate=g_8334a98162#social',
      }),
      expect.objectContaining({ id: 'r_03fbe6e76e', kind: 'resource', link: null }),
    ]);
    expect(out.value.scanned).toBe(4);
  });
});
