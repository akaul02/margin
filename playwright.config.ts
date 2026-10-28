import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
const production = process.env.MARGIN_TEST_PRODUCTION === '1';
// Tests use their own ports and temporary folders, so they never touch a copy of Margin you are running.
const ports = production ? { browser: 4378, file: 4478 } : { browser: 5273, file: 5373 };
const synthetic = (name: string) => mkdtempSync(join(tmpdir(), `margin-${name}-synthetic-`));
// Set once by the main process; workers inherit it, so tests find the data file's key.
process.env.MARGIN_TEST_DATA_DIR ??= synthetic('file');
const server = (port: number, env: Record<string, string>) => ({
  env: { MARGIN_SHARED_DIR: synthetic('rooms'), MARGIN_PORT: String(port), MARGIN_API_PORT: String(port + 2), ...env },
  command: production ? 'npm run preview' : 'npm run dev',
  url: `http://127.0.0.1:${port}`,
  reuseExistingServer: false,
});
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    browserName: 'chromium',
    channel: 'chrome',
    viewport: { width: 1440, height: 1080 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
  projects: [
    { name: 'browser storage', testIgnore: /data-file\.spec/, use: { baseURL: `http://127.0.0.1:${ports.browser}` } },
    { name: 'data file', testMatch: /data-file\.spec/, use: { baseURL: `http://127.0.0.1:${ports.file}` } },
  ],
  webServer: [
    server(ports.browser, { MARGIN_STORAGE: 'browser' }),
    server(ports.file, { MARGIN_DATA_DIR: process.env.MARGIN_TEST_DATA_DIR }),
  ],
});
