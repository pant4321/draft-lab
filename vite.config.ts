import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve('web'),
  base: './',
  publicDir: resolve('build/web-public'),
  plugins: [react()],
  server: { host: '127.0.0.1', port: 8765, strictPort: true },
  build: {
    outDir: resolve('build/pages'),
    emptyOutDir: true,
    assetsDir: 'bundles',
  },
});
