// Opens Margin in the default browser with the data file's key, so this browser can read your saved work.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { dataKey, defaultDataDir } from './store.mjs';

export function openInBrowser(url, { signal } = {}) {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  return new Promise((resolve, reject) => {
    let child,
      timer,
      settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      // Some launchers remain alive with the browser. Never keep Margin open
      // waiting for them, and never kill the user's browser when Margin stops.
      child?.unref();
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => finish(new DOMException('Browser opening was cancelled.', 'AbortError'));
    if (signal?.aborted) {
      cancel();
      return;
    }
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      child = spawn(command, args, { stdio: 'ignore', detached: true });
    } catch {
      finish(new Error(`Could not launch the default browser using ${command}.`));
      return;
    }
    // A started launcher acknowledges a request, not an opened page. Briefly
    // observe prompt failures; a long-lived launcher must not hold up the CLI.
    child.once('spawn', () => {
      if (!settled) timer = setTimeout(() => finish(), 500);
    });
    // Never log the original error: it can contain the private data-file URL.
    child.once('error', () => finish(new Error(`Could not launch the default browser using ${command}. Check that it is installed.`)));
    child.once('exit', (code, exitSignal) => {
      if (code === 0) finish();
      else finish(new Error(`The browser launcher (${command}) ${exitSignal ? 'was interrupted' : `exited with code ${code}`}.`));
    });
  });
}

export const keyedLink = (port, key) => `http://127.0.0.1:${port}/#key=${key}`;

export function reportBrowserOpenError(error, port, fileDir, preview = false) {
  console.error(error.message);
  console.error(`Open http://127.0.0.1:${port}/ manually in a browser on this computer.`);
  if (fileDir)
    console.error(
      `If this browser has not opened the data file before, read ${path.join(fileDir, 'key')} locally and append #key= followed by its contents to that address. Keep the key private.`,
    );
  console.error(
    `Or fix your default-browser settings and run npm run open${preview ? ' -- --preview' : ''} again, using the same storage and port settings.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const preview = process.argv.includes('--preview');
  const port = Number(process.env.MARGIN_PORT) || (preview ? 4178 : 5173);
  const fileDir = process.env.MARGIN_STORAGE === 'browser' ? null : process.env.MARGIN_DATA_DIR || defaultDataDir();
  let url = `http://127.0.0.1:${port}/`;
  if (fileDir) {
    if (!existsSync(path.join(fileDir, 'margin.sqlite'))) {
      console.error('Margin has no data file yet. Start it with npm run dev -- --open first.');
      process.exit(1);
    }
    url = keyedLink(port, dataKey(fileDir));
  }
  try {
    await openInBrowser(url);
    console.log(`Requested Margin in your default browser at http://127.0.0.1:${port}/`);
  } catch (error) {
    reportBrowserOpenError(error, port, fileDir, preview);
    process.exitCode = 1;
  }
}
