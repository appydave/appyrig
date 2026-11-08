import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSources } from '@collector/adapters/sources.js';

const dirs: string[] = [];

afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const slowScript = () => {
  const dir = mkdtempSync(join(tmpdir(), 'appyrig-sources-'));
  const file = join(dir, 'slow.sh');

  dirs.push(dir);
  writeFileSync(file, '#!/bin/sh\nsleep 5\n');
  chmodSync(file, 0o755);

  return file;
};

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
