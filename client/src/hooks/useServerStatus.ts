import { useEffect, useState } from 'react';
import type { HealthResponse, ServerInfo } from '@appydave/shared';

interface ServerStatus {
  health: HealthResponse | null;
  info: ServerInfo | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches server health (/health) and metadata (/api/info) on mount.
 * @returns health status, server info, loading flag, and error string
 */
export function useServerStatus() {
  const [status, setStatus] = useState<ServerStatus>({
    health: null,
    info: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);

    async function fetchStatus() {
      try {
        const [healthRes, infoRes] = await Promise.all([
          fetch('/health', { signal }),
          fetch('/api/info', { signal }),
        ]);

        if (!healthRes.ok || !infoRes.ok) {
          throw new Error('Server returned an error');
        }

        const healthBody = await healthRes.json();
        const infoBody = await infoRes.json();

        setStatus({
          health: healthBody.data,
          info: infoBody.data,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        setStatus((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to connect to server',
        }));
      }
    }

    fetchStatus();

    return () => {
      controller.abort();
    };
  }, []);

  return status;
}
