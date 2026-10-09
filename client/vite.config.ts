import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// TODO: Update port and proxy target for your project
export default defineConfig({
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
    port: 7190,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:7191',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:7191',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:7191',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
