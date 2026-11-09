import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSources } from '@collector/adapters/sources.js';

const dirs: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const slowScript = () => {
  const dir = mkdtempSync(join(tmpdir(), 'appyrig-sources-'));
  const file = join(dir, 'slow.sh');

  dirs.push(dir);
  writeFileSync(file, '#!/bin/sh\nsleep 5\n');
  chmodSync(file, 0o755);

  return file;
};

const failingRig = () => {
  const dir = mkdtempSync(join(tmpdir(), 'appyrig-sources-'));
  const file = join(dir, 'rig.sh');

  dirs.push(dir);
  writeFileSync(file, '#!/bin/sh\necho bad >&2\nexit 2\n');
  chmodSync(file, 0o755);

  return file;
};

const PS = [{ rigId: 'r1', name: 'alpha', status: 'running', nodeCount: 0, runningCount: 0 }];

/** A daemon that lists one rig, then fails its nodes and graph reads with `fail` (a throw) or HTTP 500. */
const daemonFailingReads = (fail?: unknown) =>
  vi.stubGlobal('fetch', async (url: URL) => {
    if (url.pathname === '/api/ps') {
      return Response.json(PS);
    }

    if (fail !== undefined) {
      throw fail;
    }

    return new Response('no', { status: 500 });
  });

const closedPort = () =>
  new Promise<number>((resolve) => {
    const server = createServer();

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      server.close(() => resolve(port));
    });
  });

describe('createSources: what a failed read says', () => {
  it('names a missing binary', async () => {
    const sources = createSources({ viewerBin: '/nonexistent/herdr-for-test' });

    await expect(sources.viewerAgents()).rejects.toThrow('/nonexistent/herdr-for-test not found');
  });

  it('names a binary that outlives its timeout', async () => {
    const file = slowScript();
    const sources = createSources({ viewerBin: file, timeoutMs: 200 });

    await expect(sources.viewerAgents()).rejects.toThrow(`${file} timed out after 200ms`);
  });

  it('says plainly that no OpenRig daemon is running when the port refuses', async () => {
    const port = await closedPort();
    const sources = createSources({ daemonUrl: `http://127.0.0.1:${port}` });

    await expect(sources.daemon()).rejects.toThrow('no OpenRig daemon running on this machine');
  });
});

describe('createSources.daemon: what a partly failed read says in warnings', () => {
  it('words the nodes, graph and queue failures exactly', async () => {
    daemonFailingReads();

    const sources = createSources({ daemonUrl: 'http://127.0.0.1:1', rigBin: failingRig() });
    const read = await sources.daemon();

    expect(read.warnings).toEqual([
      'nodes unreadable for alpha: GET /api/rigs/r1/nodes -> HTTP 500',
      'graph unreadable for alpha: GET /api/rigs/r1/graph -> HTTP 500 (no planned lines)',
      'queue unreadable: rig queue list exited 2: bad',
    ]);
  });

  it('shows a thrown string as itself, not as undefined', async () => {
    daemonFailingReads('boom');

    const sources = createSources({ daemonUrl: 'http://127.0.0.1:1', rigBin: failingRig() });
    const read = await sources.daemon();

    expect(read.warnings?.slice(0, 2)).toEqual([
      'nodes unreadable for alpha: boom',
      'graph unreadable for alpha: boom (no planned lines)',
    ]);
  });
});

describe('Feature: the daemon is only ever read on this machine', () => {
  it('Scenario: given a daemon URL on another machine, then createSources refuses it', () => {
    expect(() => createSources({ daemonUrl: 'http://100.89.32.35:7433' })).toThrow(
      /must be loopback/
    );
  });
});
