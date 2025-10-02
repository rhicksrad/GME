import { defineConfig } from 'vite';

const repoBase = process.env.GITHUB_REPOSITORY?.split('/')?.[1];

export default defineConfig({
  base: repoBase ? `/${repoBase}/` : '/',
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
