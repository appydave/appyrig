import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FEEDBACK_NOTES_MAX,
  FEEDBACK_SCREENSHOT_MAX_BYTES,
  FEEDBACK_SCREENSHOT_MAX_DIMENSION,
  FeedbackAddInputSchema,
} from '@appydave/shared';
import { inspectPng } from './feedbackStore.js';
import { COOKIE, startHub, type RunningHub } from '../test/hubHarness.js';

// A real 1x1 PNG.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

/** The first 33 bytes of a PNG with chosen dimensions (inspectPng reads only the signature and IHDR). */
const pngHeader = (w: number, h: number, pad = 0): string => {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b.toString('base64');
};

const dirs: string[] = [];
const running: RunningHub[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'appyrig-fb-'));
  dirs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(running.splice(0).map((h) => h.stop()));
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const start = async (dataDir?: string) => {
  const h = await startHub({ dataDir });
  running.push(h);
  return h;
};

const note = (over: Record<string, unknown> = {}) => ({
  verdict: 'down',
  region: 'flow:step-3',
  note: 'the defect text is unreadable',
  snapshot: 'rig=flicut-reapply · step 3 of 12',
  viewState: {
    route: '/',
    view: 'flow',
    selectedRig: 'flicut-reapply',
    machines: ['m2'],
    legend: true,
    explain: false,
  },
  screenshotPng: PNG_1X1,
  ...over,
});
const HUMAN = { 'x-fli-principal': 'human:ui' };
const post = (h: RunningHub, body: unknown, headers: Record<string, string> = HUMAN) =>
  request(h.hub.app)
    .post('/v1/feedback')
    .set('Cookie', COOKIE)
    .set(headers)
    .send(body as object);
const call = (h: RunningHub, verb: string, input: unknown, principal = 'agent:test') =>
  request(h.hub.app)
    .post('/v1/call')
    .set('Cookie', COOKIE)
    .set('x-fli-principal', principal)
    .send({ verb, input });

describe('inspectPng', () => {
  it('reads the size from the file itself', () => {
    expect(inspectPng(PNG_1X1)).toMatchObject({ width: 1, height: 1 });
    expect(inspectPng(pngHeader(1600, 900))).toMatchObject({ width: 1600, height: 900 });
  });
  it('refuses what is not a PNG, not plain base64, or out of size', () => {
    expect(() =>
      inspectPng(
        Buffer.from('GIF89a not a png at all, just text bytes here....').toString('base64')
      )
    ).toThrow(/not a PNG/);
    expect(() => inspectPng(`data:image/png;base64,${PNG_1X1}`)).toThrow(/plain base64/);
    expect(() => inspectPng(`${PNG_1X1}\n${PNG_1X1}`)).toThrow(/plain base64/);
    expect(() => inspectPng('')).toThrow();
    expect(() => inspectPng(pngHeader(FEEDBACK_SCREENSHOT_MAX_DIMENSION + 1, 10))).toThrow(
      /limit is 8000/
    );
    expect(() => inspectPng(pngHeader(0, 10))).toThrow(/limit/);
    expect(() => inspectPng(pngHeader(10, 10, FEEDBACK_SCREENSHOT_MAX_BYTES))).toThrow(/Downscale/);
    // a PNG signature with the wrong chunk after it
    const b = Buffer.from(pngHeader(10, 10), 'base64');
    b.write('JUNK', 12, 'latin1');
    expect(() => inspectPng(b.toString('base64'))).toThrow(/not a PNG/);
  });
});

describe('POST /v1/feedback', () => {
  it('files a note with a screenshot into data/feedback/ and lists it back', async () => {
    const dir = tempDir();
    const h = await start(dir);
    const res = await post(h, note());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      value: {
        id: 'fb-0001',
        hasScreenshot: true,
        count: 1,
        dryRun: false,
        screenshot: { width: 1, height: 1 },
      },
    });

    const folder = join(dir, 'feedback', 'fb-0001');
    expect(readdirSync(folder).sort()).toEqual(['note.json', 'screenshot.png']);
    const saved = JSON.parse(readFileSync(join(folder, 'note.json'), 'utf8'));
    expect(saved).toMatchObject({
      id: 'fb-0001',
      verdict: 'down',
      region: 'flow:step-3',
      viewer: 'human:ui',
      status: 'open',
      snapshot: 'rig=flicut-reapply · step 3 of 12',
      viewState: {
        route: '/',
        view: 'flow',
        selectedRig: 'flicut-reapply',
        legend: true,
        explain: false,
      },
    });
    expect(saved.appVersion).toMatch(/^\d/); // the server fills the version
    expect(saved).not.toHaveProperty('screenshotPng'); // the bytes live in the PNG file, not the JSON
    expect(readFileSync(join(folder, 'screenshot.png')).subarray(1, 4).toString()).toBe('PNG');
    // the agent-readable index: one line, readable with cat
    const index = readFileSync(join(dir, 'feedback', 'index.jsonl'), 'utf8')
      .trim()
      .split('\n');
    expect(index).toHaveLength(1);
    expect(JSON.parse(index[0]!)).toMatchObject({
      id: 'fb-0001',
      hasScreenshot: true,
      route: '/',
      view: 'flow',
      selectedRig: 'flicut-reapply',
    });
    // 0600 files, 0700 folders: notes can quote anything on screen
    expect(statSync(join(folder, 'note.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(folder, 'screenshot.png')).mode & 0o777).toBe(0o600);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
  });

  it('DONE-WHEN: three notes with screenshots, and an agent lists them back (verb, file, and PNG route)', async () => {
    const dir = tempDir();
    const h = await start(dir);
    for (const [i, verdict] of (['down', 'question', 'idea'] as const).entries())
      expect(
        (
          await post(
            h,
            note({ verdict, note: `note number ${i + 1}`, region: i === 0 ? 'wall' : 'map' })
          )
        ).status
      ).toBe(201);

    // an AGENT principal can list and get (read paths), though it could not file them
    const listed = await call(h, 'feedback.list', {});
    expect(listed.body.value.total).toBe(3);
    expect(listed.body.value.notes.map((n: { id: string }) => n.id)).toEqual([
      'fb-0003',
      'fb-0002',
      'fb-0001',
    ]); // newest first
    expect(listed.body.value.notes.every((n: { hasScreenshot: boolean }) => n.hasScreenshot)).toBe(
      true
    );
    expect(listed.body.value.indexFile).toBe(join(dir, 'feedback', 'index.jsonl'));
    expect((await call(h, 'feedback.list', { verdict: 'question' })).body.value.notes).toHaveLength(
      1
    );
    expect((await call(h, 'feedback.list', { region: 'map' })).body.value.notes).toHaveLength(2);
    expect((await call(h, 'feedback.list', { limit: 1 })).body.value.notes).toHaveLength(1);
    expect(
      (await call(h, 'feedback.list', { since: '2999-01-01T00:00:00.000Z' })).body.value.notes
    ).toHaveLength(0);

    const got = await call(h, 'feedback.get', { id: 'fb-0002' });
    expect(got.body.value).toMatchObject({
      note: { id: 'fb-0002', verdict: 'question', note: 'note number 2' },
      screenshotUrl: '/v1/feedback/fb-0002/screenshot.png',
      folder: join(dir, 'feedback', 'fb-0002'),
    });
    const png = await request(h.hub.app)
      .get('/v1/feedback/fb-0002/screenshot.png')
      .set('Cookie', COOKIE);
    expect(png.status).toBe(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(png.body).subarray(1, 4).toString()).toBe('PNG');
  });

  it('ids continue across a hub restart, and a torn last index line is ignored', async () => {
    const dir = tempDir();
    const h1 = await start(dir);
    await post(h1, note());
    await post(h1, note());
    await h1.stop();
    running.splice(running.indexOf(h1), 1);
    writeFileSync(
      join(dir, 'feedback', 'index.jsonl'),
      `${readFileSync(join(dir, 'feedback', 'index.jsonl'), 'utf8')}{"id":"fb-00`,
      { flag: 'w' }
    );
    const h2 = await start(dir);
    const res = await post(h2, note({ note: 'after the restart' }));
    expect(res.body.value).toMatchObject({ id: 'fb-0003', count: 3 });
    expect((await call(h2, 'feedback.list', {})).body.value.total).toBe(3);
  });

  it('is authenticated and human-only: no session, an agent, or no principal is refused and writes nothing', async () => {
    const dir = tempDir();
    const h = await start(dir);
    expect((await request(h.hub.app).post('/v1/feedback').set(HUMAN).send(note())).status).toBe(
      401
    );
    const agent = await post(h, note(), { 'x-fli-principal': 'agent:claude' });
    expect(agent.status).toBe(403);
    expect(agent.body.error.failureMode).toBe('forbidden');
    expect((await post(h, note(), { 'x-fli-principal': 'cli' })).status).toBe(403);
    expect((await post(h, note(), {})).status).toBe(400); // no principal header
    expect(readdirSync(dir)).toEqual([]); // not even the feedback folder
  });

  it('validates: verdict, region (no paths), note, view state, strict fields; each refusal writes nothing', async () => {
    const dir = tempDir();
    const h = await start(dir);
    const bad: [string, Record<string, unknown>][] = [
      ['verdict', { verdict: 'meh' }],
      ['region path', { region: '../../etc/passwd' }],
      ['region slash', { region: 'a/b' }],
      ['region empty', { region: '' }],
      ['note empty', { note: '   ' }],
      ['note too long', { note: 'x'.repeat(4001) }],
      ['snapshot too long', { snapshot: 'x'.repeat(2001) }],
      ['smuggled path field', { path: '/etc/passwd' }],
      ['smuggled id field', { id: 'fb-9999' }],
      ['view state missing route', { viewState: { view: 'wall' } }],
      ['view state unknown key', { viewState: { route: '/', secret: 1 } }],
      [
        'view state too big',
        {
          viewState: {
            route: '/',
            filters: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, 'v'])),
          },
        },
      ],
      ['view state huge value', { viewState: { route: 'x'.repeat(301) } }],
    ];
    for (const [name, over] of bad) {
      const res = await post(h, note(over));
      expect(res.status, name).toBe(400);
      expect(res.body.error.failureMode, name).toBe('invalid-input');
    }
    expect(readdirSync(dir)).toEqual([]);
    // the schema itself agrees (this is what the UI can validate before sending)
    expect(FeedbackAddInputSchema.safeParse(note()).success).toBe(true);
  });

  it('refuses a bad screenshot with a plain reason, and writes nothing', async () => {
    const dir = tempDir();
    const h = await start(dir);
    const notPng = await post(
      h,
      note({
        screenshotPng: Buffer.from('hello world this is not a png file at all!!').toString(
          'base64'
        ),
      })
    );
    expect(notPng.status).toBe(400);
    expect(notPng.body.error.message).toMatch(/not a PNG/);
    const prefixed = await post(h, note({ screenshotPng: `data:image/png;base64,${PNG_1X1}` }));
    expect(prefixed.body.error.message).toMatch(/plain base64/);
    const huge = await post(
      h,
      note({ screenshotPng: pngHeader(10, 10, FEEDBACK_SCREENSHOT_MAX_BYTES + 100) })
    );
    expect(huge.status).toBe(400); // over the schema's own length cap for the base64 text
    expect(huge.body.error.failureMode).toBe('invalid-input');
    expect(JSON.stringify(huge.body.error.details)).toContain('screenshotPng');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('a note without a screenshot is fine', async () => {
    const dir = tempDir();
    const h = await start(dir);
    const bare: Record<string, unknown> = note();
    delete bare.screenshotPng;
    const res = await post(h, bare);
    expect(res.body.value).toMatchObject({ id: 'fb-0001', hasScreenshot: false, screenshot: null });
    expect(readdirSync(join(dir, 'feedback', 'fb-0001'))).toEqual(['note.json']);
    expect(
      (await request(h.hub.app).get('/v1/feedback/fb-0001/screenshot.png').set('Cookie', COOKIE))
        .status
    ).toBe(404);
  });

  it('its own 5 MB body limit applies to this route only: a 1 MB body is fine, 6 MB is refused, and /v1/call keeps 100 KB', async () => {
    const dir = tempDir();
    const h = await start(dir);
    // ~3 MB PNG as base64 is ~4 MB of JSON: under the route limit, far over the default
    const big = pngHeader(1600, 900, FEEDBACK_SCREENSHOT_MAX_BYTES - 40);
    const ok = await post(h, note({ screenshotPng: big }));
    expect(ok.status).toBe(201);
    expect(ok.body.value.screenshot.bytes).toBe(FEEDBACK_SCREENSHOT_MAX_BYTES - 7); // 33 + pad bytes
    const tooBig = await post(h, note({ screenshotPng: 'A'.repeat(6 * 1024 * 1024) }));
    expect(tooBig.status).toBe(413);
    const call150k = await request(h.hub.app)
      .post('/v1/call')
      .set('Cookie', COOKIE)
      .set('x-fli-principal', 'human:ui')
      .send({
        verb: 'feedback.add',
        input: note({ note: 'y'.repeat(100), snapshot: 'z'.repeat(150_000) }),
      });
    expect(call150k.status).toBe(413);
  });

  it('dry run validates and writes nothing', async () => {
    const dir = tempDir();
    const h = await start(dir);
    const res = await post(h, note(), { ...HUMAN, 'x-fli-dry-run': '1' });
    expect(res.status).toBe(201);
    expect(res.body.value).toMatchObject({ id: 'fb-0001', dryRun: true });
    expect(readdirSync(dir)).toEqual([]);
    // and a dry run of a bad note is still refused
    expect((await post(h, note({ verdict: 'x' }), { ...HUMAN, 'x-fli-dry-run': '1' })).status).toBe(
      400
    );
  });

  it(`stops at ${FEEDBACK_NOTES_MAX} notes with a clear refusal`, async () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'feedback'), { recursive: true });
    const line = (n: number) =>
      JSON.stringify({
        id: `fb-${String(n).padStart(4, '0')}`,
        createdAt: '2026-10-11T12:00:00.000Z',
        viewer: 'human:ui',
        verdict: 'up',
        region: 'wall',
        note: 'x',
        route: '/',
        view: null,
        selectedRig: null,
        hasScreenshot: false,
        appVersion: '1.0.0',
      });
    writeFileSync(
      join(dir, 'feedback', 'index.jsonl'),
      `${Array.from({ length: FEEDBACK_NOTES_MAX }, (_, i) => line(i + 1)).join('\n')}\n`
    );
    const h = await start(dir);
    const res = await post(h, note());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ failureMode: 'feedback-full' });
    expect(readdirSync(join(dir, 'feedback'))).toEqual(['index.jsonl']);
  });

  it('a hub with no data directory says so (503) instead of pretending to store', async () => {
    const h = await start(undefined);
    const res = await post(h, note());
    expect(res.status).toBe(503);
    expect(res.body.error.failureMode).toBe('feedback-unavailable');
    expect((await call(h, 'feedback.list', {})).body.value).toMatchObject({
      total: 0,
      notes: [],
      indexFile: null,
    });
  });
});

describe('what the client can and cannot reach', () => {
  it('ids are server-made: the screenshot route and feedback.get refuse anything that is not fb-NNNN', async () => {
    const dir = tempDir();
    const h = await start(dir);
    await post(h, note());
    // plant a file next to the store that a path trick would reach
    writeFileSync(join(dir, 'secret.png'), 'not for you');
    for (const id of [
      '..%2Fsecret',
      '..',
      'fb-0001%2F..%2F..%2Fsecret',
      'fb-1',
      'FB-0001',
      'fb-0001.png',
      '%2Fetc%2Fpasswd',
      'fb-00001x',
    ]) {
      const r = await request(h.hub.app)
        .get(`/v1/feedback/${id}/screenshot.png`)
        .set('Cookie', COOKIE);
      expect(r.status, id).toBe(404);
      expect(r.headers['content-type'], id).not.toBe('image/png');
    }
    for (const id of ['../secret', 'fb-0001/../../secret', '/etc/passwd', 'fb-9999']) {
      const r = await call(h, 'feedback.get', { id });
      expect(r.body.ok, id).toBe(false);
      expect(['invalid-input', 'feedback-not-found'], id).toContain(r.body.error.failureMode);
    }
  });

  it('the only thing written under the data directory is feedback/ (nothing else, nowhere else)', async () => {
    const dir = tempDir();
    const h = await start(dir);
    await post(h, note());
    await post(h, note({ screenshotPng: undefined }));
    expect(readdirSync(dir)).toEqual(['feedback']);
    expect(readdirSync(join(dir, 'feedback')).sort()).toEqual([
      'fb-0001',
      'fb-0002',
      'index.jsonl',
    ]);
  });

  it('notes are listed from their files even when the index is gone (the index is a convenience, not the source)', async () => {
    const dir = tempDir();
    const h = await start(dir);
    await post(h, note());
    rmSync(join(dir, 'feedback', 'index.jsonl'));
    const got = await call(h, 'feedback.get', { id: 'fb-0001' });
    expect(got.body.value.note.id).toBe('fb-0001');
  });
});
