import { defineConfig, loadEnv, type HttpProxy } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isLocalDevRequest } from './src/v2/devProxy';

/**
 * v2 W0 preview: APPYRIG_HUB_URL points this dev server's proxy at another hub (e.g. the M2's,
 * http://100.126.70.25:7191). That hub's session cookie cannot be set for localhost, so the proxy
 * adds `Authorization: Bearer <token>` itself, server side, from APPYRIG_HUB_TOKEN_FILE (default
 * ~/.config/appyrig/token). The token never reaches the browser. Unset = today's local hub.
 */
function remoteHubAuth(hubUrl: string | undefined, tokenFile: string | undefined) {
  if (!hubUrl) return null;
  try {
    const file = tokenFile || path.join(os.homedir(), '.config', 'appyrig', 'token');
    const token = readFileSync(file, 'utf8').trim();
    return token ? `Bearer ${token}` : null;
  } catch {
    return null;
  }
}

// Ports come from this tree's root .env (PORT = hub, CLIENT_URL = this dev server), so each lane
// worktree and QA copy runs on its own ports (MISSION.md) without editing this file.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const hub = env.APPYRIG_HUB_URL || `http://localhost:${env.PORT || 7191}`;
  const clientPort = Number(new URL(env.CLIENT_URL || 'http://localhost:7190').port);
  const auth = remoteHubAuth(env.APPYRIG_HUB_URL, env.APPYRIG_HUB_TOKEN_FILE);
  if (env.APPYRIG_HUB_URL && !auth) {
    console.warn(
      `[appyrig] APPYRIG_HUB_URL=${env.APPYRIG_HUB_URL} but no hub token was read ` +
        `(APPYRIG_HUB_TOKEN_FILE or ~/.config/appyrig/token): the hub will refuse this preview.`
    );
  }
  // Same target and options for every proxied path. With a remote hub the bearer rides along, but
  // only for a page served by this dev server on this machine (devProxy.ts); a WebSocket upgrade
  // from any other origin is refused.
  const to = (ws = false) => ({
    target: hub,
    changeOrigin: true,
    ...(ws ? { ws: true } : {}),
    ...(auth
      ? {
          configure: (proxy: HttpProxy.Server) => {
            proxy.on('proxyReq', (proxyReq, req) => {
              if (isLocalDevRequest(req.headers, clientPort))
                proxyReq.setHeader('authorization', auth);
            });
            proxy.on('proxyReqWs', (proxyReq, req, socket) => {
              if (isLocalDevRequest(req.headers, clientPort)) {
                proxyReq.setHeader('authorization', auth);
              } else {
                proxyReq.destroy();
                socket.destroy();
              }
            });
          },
        }
      : {}),
  });
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@components': path.resolve(__dirname, 'src/components'),
        '@hooks': path.resolve(__dirname, 'src/hooks'),
        '@pages': path.resolve(__dirname, 'src/pages'),
        '@utils': path.resolve(__dirname, 'src/utils'),
        '@contexts': path.resolve(__dirname, 'src/contexts'),
        '@config': path.resolve(__dirname, 'src/config'),
      },
    },
    server: {
      port: clientPort,
      strictPort: true,
      // Never beyond this machine: with APPYRIG_HUB_URL the proxy carries the hub token.
      host: 'localhost',
      proxy: {
        '/api': to(),
        '/v1': to(),
        '/health': to(),
        '/socket.io': to(true),
      },
    },
  };
});
