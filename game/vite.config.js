import { defineConfig } from 'vite';

// In dev, the game server runs separately (npm run dev:server) and Vite proxies /api to it.
export default defineConfig({
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
