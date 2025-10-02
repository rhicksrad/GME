import { defineConfig } from 'vite';

export default defineConfig({
  base: '/GME/',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
