import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Ports come from this tree's root .env (PORT = hub, CLIENT_URL = this dev server), so each lane
// worktree and QA copy runs on its own ports (MISSION.md) without editing this file.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '..'), '');
  const hub = `http://localhost:${env.PORT || 7191}`;
  const clientPort = Number(new URL(env.CLIENT_URL || 'http://localhost:7190').port);
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
      proxy: {
        '/api': {
          target: hub,
          changeOrigin: true,
        },
        '/v1': {
          target: hub,
          changeOrigin: true,
        },
        '/health': {
          target: hub,
          changeOrigin: true,
        },
        '/socket.io': {
          target: hub,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
