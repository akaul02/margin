import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
const production = process.env.MARGIN_TEST_PRODUCTION === '1';
const url = production ? 'http://127.0.0.1:4178' : 'http://127.0.0.1:5173';
export default defineConfig({
  testDir: './tests/browser', fullyParallel: false, workers: 1, timeout: 30_000,
  use: { baseURL: url, browserName: 'chromium', channel: 'chrome', viewport: { width: 1440, height: 1080 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  reporter: [['list']],
  webServer: { env: { MARGIN_SHARED_DIR: mkdtempSync(join(tmpdir(),'margin-browser-synthetic-')) }, command: production ? 'npm run preview' : 'npm run dev', url, reuseExistingServer: !production },
});
