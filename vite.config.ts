import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repository = 'https://github.com/pant4321/draft-lab';
const revision = process.env.GITHUB_SHA ?? '';
const sourceUrl = /^[0-9a-f]{40}$/.test(revision)
  ? `${repository}/tree/${revision}`
  : repository;

export default defineConfig({
  root: resolve('web'),
  base: './',
  publicDir: resolve('build/web-public'),
  plugins: [react()],
  define: { 'import.meta.env.VITE_DRAFTEDGE_SOURCE_URL': JSON.stringify(sourceUrl) },
  server: { host: '127.0.0.1', port: 8765, strictPort: true },
  build: {
    outDir: resolve('build/pages'),
    emptyOutDir: true,
    assetsDir: 'bundles',
  },
});
