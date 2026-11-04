import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRoomServer } from './room-server.mjs';
import { dataKey, defaultDataDir, openStore } from './store.mjs';
import { keyedLink, openInBrowser, reportBrowserOpenError } from './open.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const preview = process.argv.includes('--preview');
const port = Number(process.env.MARGIN_PORT) || (preview ? 4178 : 5173),
  apiPort = Number(process.env.MARGIN_API_PORT) || (preview ? 4180 : 5180);
const compiled = await build({
  entryPoints: [path.join(root, 'src/model.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const model = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const dataDir = process.env.MARGIN_SHARED_DIR || path.join(root, preview ? '.margin-shared-preview' : '.margin-shared');
// Projects are saved to a SQLite file on this computer. MARGIN_STORAGE=browser keeps them in browser storage instead.
const fileDir = process.env.MARGIN_STORAGE === 'browser' ? null : process.env.MARGIN_DATA_DIR || defaultDataDir();
const store = fileDir ? openStore(fileDir, model) : undefined;
const key = fileDir ? dataKey(fileDir) : undefined;
const service = await startRoomServer({
  port: apiPort,
  dataDir,
  allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
  validateProject: model.validateProject,
  exportProject: model.exportProject,
  store,
  storeKey: key,
});
console.log(`Margin local sharing: http://127.0.0.1:${apiPort} (loopback only)`);
console.log(store ? `Margin data file: ${store.file}` : 'Margin is saving projects in browser storage.');
// Readiness must belong to this start, not another service already on the port.
// This marker is not a data-file key and grants no access to project data.
const instance = randomUUID();
const child = spawn(
  process.execPath,
  [
    path.join(root, 'node_modules/vite/bin/vite.js'),
    ...(preview ? ['preview'] : []),
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, MARGIN_API_ORIGIN: `http://127.0.0.1:${apiPort}`, MARGIN_START_INSTANCE: instance },
  },
);
let stopping = false;
const browserOpening = new AbortController();
async function stop() {
  if (stopping) return;
  stopping = true;
  browserOpening.abort();
  child.kill('SIGTERM');
  await service.close();
  store?.close();
}
process.on('SIGINT', () => {
  void stop();
});
process.on('SIGTERM', () => {
  void stop();
});
child.on('exit', async code => {
  await stop();
  process.exitCode = code ?? 0;
});
child.on('error', async () => {
  await stop();
  process.exitCode = 1;
});
if (process.argv.includes('--open')) {
  // Open once the page answers, with the key so this browser can read the data file.
  let ready = false;
  for (let i = 0; i < 100 && !stopping; i++) {
    ready = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.any([browserOpening.signal, AbortSignal.timeout(1_000)]),
    }).then(
      r => r.ok && r.headers.get('X-Margin-Instance') === instance,
      () => false,
    );
    if (ready || stopping) break;
    await new Promise(r => setTimeout(r, 200));
  }
  if (ready && !stopping) {
    try {
      await openInBrowser(key ? keyedLink(port, key) : `http://127.0.0.1:${port}/`, { signal: browserOpening.signal });
    } catch (error) {
      if (!stopping) {
        console.error('Margin is still running, but its browser could not be opened.');
        reportBrowserOpenError(error, port, fileDir, preview);
      }
    }
  } else if (!stopping) {
    console.error(
      'Margin did not become ready in time, so no browser was opened. Check the server output, then run npm run open when it is ready.',
    );
  }
}
