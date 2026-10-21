import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COOKIE, startHub, type RunningHub } from '../test/hubHarness.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const dirs: string[] = [];
const running: RunningHub[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((h) => h.stop()));
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
async function start(withFolder: boolean) {
  const dataDir = mkdtempSync(join(tmpdir(), 'appyrig-v1a-'));
  dirs.push(dataDir);
  if (withFolder) {
    const f = join(dataDir, 'v1-archive');
    mkdirSync(f);
    writeFileSync(join(f, 'v1-02-b.png'), PNG);
    writeFileSync(join(f, 'v1-01-a.png'), PNG);
    writeFileSync(join(f, 'notes.txt'), 'x');
    writeFileSync(join(f, 'V1-bad.png'), PNG);
  }
  writeFileSync(join(dataDir, 'secret.png'), PNG);
  const h = await startHub({ dataDir });
  running.push(h);
  return h;
}

describe('V1 archive routes', () => {
  it('lists only the png names, sorted', async () => {
    const h = await start(true);
    const r = await request(h.url).get('/api/v1-archive').set('Cookie', COOKIE);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ files: ['v1-01-a.png', 'v1-02-b.png'] });
  });

  it('serves a png', async () => {
    const h = await start(true);
    const r = await request(h.url).get('/api/v1-archive/v1-01-a.png').set('Cookie', COOKIE);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(r.body, PNG)).toBe(0);
  });

  it('lists [] and 404s when the folder is missing', async () => {
    const h = await start(false);
    const l = await request(h.url).get('/api/v1-archive').set('Cookie', COOKIE);
    expect(l.body).toEqual({ files: [] });
    const f = await request(h.url).get('/api/v1-archive/v1-01-a.png').set('Cookie', COOKIE);
    expect(f.status).toBe(404);
  });

  it('refuses bad names and traversal with 404', async () => {
    const h = await start(true);
    for (const bad of [
      'notes.txt',
      'V1-bad.png',
      'v1-missing.png',
      '..%2Fsecret.png',
      '..%2F..%2Fsecret.png',
      'v1-%2e%2e%2fsecret.png',
      'v1-01-a.png%00.txt',
    ]) {
      const r = await request(h.url).get(`/api/v1-archive/${bad}`).set('Cookie', COOKIE);
      expect(r.status, bad).toBe(404);
    }
  });

  it('needs the session like every other route, and has no write route', async () => {
    const h = await start(true);
    expect((await request(h.url).get('/api/v1-archive')).status).toBe(401);
    expect((await request(h.url).get('/api/v1-archive/v1-01-a.png')).status).toBe(401);
    const w = await request(h.url).put('/api/v1-archive/v1-01-a.png').set('Cookie', COOKIE);
    expect(w.status).toBe(404);
  });
});
