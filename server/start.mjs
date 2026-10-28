import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRoomServer } from './room-server.mjs';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const preview = process.argv.includes('--preview');
const port = preview ? 4178 : 5173,
  apiPort = preview ? 4180 : 5180;
const compiled = await build({
  entryPoints: [path.join(root, 'src/model.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const model = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const dataDir = process.env.MARGIN_SHARED_DIR || path.join(root, preview ? '.margin-shared-preview' : '.margin-shared');
const service = await startRoomServer({
  port: apiPort,
  dataDir,
  allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
  validateProject: model.validateProject,
  exportProject: model.exportProject,
});
console.log(`Margin local sharing: http://127.0.0.1:${apiPort} (loopback only)`);
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
    ...(process.argv.includes('--open') ? ['--open'] : []),
  ],
  { cwd: root, stdio: 'inherit' },
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill('SIGTERM');
  await service.close();
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
