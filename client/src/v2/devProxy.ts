/**
 * v2 preview: the dev proxy's guard (used by client/vite.config.ts, tested here).
 *
 * With APPYRIG_HUB_URL set, the dev server adds the hub token to requests it forwards. Only a page
 * served by this dev server on this machine may borrow it: the request's Origin (or, without one,
 * its Host) must be localhost / 127.0.0.1 / [::1] on the dev port. Anything else is forwarded
 * without the token, and a WebSocket upgrade from anywhere else is refused.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

type Headers = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function localUrl(raw: string, port: number): boolean {
  try {
    const u = new URL(raw);
    return LOCAL_HOSTS.has(u.hostname) && Number(u.port || 80) === port;
  } catch {
    return false;
  }
}

/** True when the request comes from a page on this dev server (same machine, same port). */
export function isLocalDevRequest(headers: Headers, port: number): boolean {
  const origin = first(headers.origin);
  if (origin !== undefined) return localUrl(origin, port);
  const host = first(headers.host);
  return host !== undefined && localUrl(`http://${host}`, port);
}
