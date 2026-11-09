import { describe, it, expect } from 'vitest';
import { createServer, get } from 'node:http';
import { listenOnHosts, parseHosts } from './listen.js';

const fetchStatus = (host: string, port: number) =>
  new Promise<number>((resolve, reject) => {
    get({ host, port, path: '/' }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on('error', reject);
  });

describe('listenOnHosts — bind only the named addresses', () => {
  it('serves the same app on every named address and one port', async () => {
    const http = createServer((_req, res) => res.end('ok'));
    const bound = await listenOnHosts(http, 0, ['127.0.0.1', '::1']);

    try {
      expect(bound.hosts).toEqual(['127.0.0.1', '::1']);
      expect(await fetchStatus('127.0.0.1', bound.port)).toBe(200);
      expect(await fetchStatus('::1', bound.port)).toBe(200);
    } finally {
      await bound.close();
      await new Promise((r) => http.close(r));
    }
  });

  it('is not reachable on an address it was not given', async () => {
    const http = createServer((_req, res) => res.end('ok'));
    const bound = await listenOnHosts(http, 0, ['127.0.0.1']);

    try {
      await expect(fetchStatus('::1', bound.port)).rejects.toThrow(/ECONNREFUSED/);
    } finally {
      await bound.close();
      await new Promise((r) => http.close(r));
    }
  });

  it('fails loudly when an address is not on this machine, leaving nothing listening', async () => {
    const http = createServer();

    // 192.0.2.1 is TEST-NET-1: never assigned to a local interface.
    await expect(listenOnHosts(http, 0, ['127.0.0.1', '192.0.2.1'])).rejects.toMatchObject({
      code: 'EADDRNOTAVAIL',
    });
    expect(http.listening).toBe(false);
  });
});

describe('parseHosts', () => {
  it('splits, trims and de-duplicates', () => {
    expect(parseHosts(' 127.0.0.1, 100.126.70.25 ,127.0.0.1')).toEqual([
      '127.0.0.1',
      '100.126.70.25',
    ]);
  });
  it('refuses an empty list', () => {
    expect(() => parseHosts(' , ')).toThrow(/no address/);
  });
});
