import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./client', import.meta.url));
const shared = fileURLToPath(new URL('./shared', import.meta.url));

export default defineConfig({
  root,
  base: './',
  resolve: {
    alias: { '@shared': shared },
  },
  server: {
    port: 5173,
    proxy: {
      // Dev: the game server runs separately on 8080.
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/api': { target: 'http://localhost:8080' },
    },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist/public', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
