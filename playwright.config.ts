import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'build/playwright-results',
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:8791',
    channel: process.env.DRAFTEDGE_BROWSER_CHANNEL || undefined,
    viewport: { width: 1366, height: 900 },
  },
  webServer: {
    command: 'node tests/serve-pages.mjs',
    url: 'http://127.0.0.1:8791/',
    reuseExistingServer: false,
  },
});
