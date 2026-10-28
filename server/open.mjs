// Opens Margin in the default browser with the data file's key, so this browser can read your saved work.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dataKey, defaultDataDir } from './store.mjs';

export function openInBrowser(url) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  spawn(command, args, { stdio: 'ignore', detached: true }).unref();
}

export const keyedLink = (port, key) => `http://127.0.0.1:${port}/#key=${key}`;

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dir = process.env.MARGIN_DATA_DIR || defaultDataDir();
  if (!existsSync(path.join(dir, 'margin.sqlite'))) {
    console.error('Margin has no data file yet. Start it with npm run dev first.');
    process.exit(1);
  }
  const port = Number(process.env.MARGIN_PORT) || (process.argv.includes('--preview') ? 4178 : 5173);
  openInBrowser(keyedLink(port, dataKey(dir)));
  console.log(`Opened Margin at http://127.0.0.1:${port}/`);
}
