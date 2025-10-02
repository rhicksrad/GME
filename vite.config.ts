import { defineConfig } from 'vite';

const repository = process.env.GITHUB_REPOSITORY ?? '';
const repoName = repository.split('/')[1] ?? '';
const isUserPage = repoName.endsWith('.github.io');
const base = repoName && !isUserPage ? `/${repoName}/` : '/';

export default defineConfig({
  base,
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
