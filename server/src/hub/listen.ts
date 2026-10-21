import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Bind one HTTP server (and so its Socket.IO) to several addresses on one port, e.g. localhost
 * and the Tailscale IP, and nothing else (plan §0.1). Node listens on one address per server,
 * so each extra address is a plain TCP listener that hands its sockets to the HTTP server.
 *
 * Any address that cannot be bound fails the whole call: a hub that silently skipped its
 * Tailscale address would look fine here and be unreachable from every other machine.
 */

export interface Listening {
  port: number;
  hosts: string[];
  close: () => Promise<void>;
}

function listenOnce(server: NetServer | HttpServer, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

export function parseHosts(value: string): string[] {
  const hosts = value
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (hosts.length === 0) {
    throw new Error('HUB_BIND_HOSTS names no address');
  }

  return [...new Set(hosts)];
}

export async function listenOnHosts(
  http: HttpServer,
  port: number,
  hosts: string[]
): Promise<Listening> {
  const [first, ...rest] = hosts;
  if (!first) {
    throw new Error('listenOnHosts needs at least one host');
  }
  await listenOnce(http, port, first);
  const actualPort = (http.address() as AddressInfo).port; // port 0 → the one the OS picked
  const extras: NetServer[] = [];
  try {
    for (const host of rest) {
      const extra = createNetServer((socket) => http.emit('connection', socket));
      await listenOnce(extra, actualPort, host);
      extras.push(extra);
    }
  } catch (err) {
    await Promise.all(extras.map((s) => new Promise((r) => s.close(r))));
    await new Promise((r) => http.close(r));
    throw err;
  }

  return {
    port: actualPort,
    hosts,
    close: async () => {
      await Promise.all(extras.map((s) => new Promise((r) => s.close(r))));
    },
  };
}
