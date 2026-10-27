import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createServer, preview, type ViteDevServer, type PreviewServer } from 'vite';
import { marginConfig } from '../vite.config';

let root: string;
let server: ViteDevServer | PreviewServer;
const marker = 'SYNTHETIC PRIVATE ROOM AND OLD NOTE HISTORY';
afterEach(async () => {
  if (server) {
    if ('close' in server) await server.close();
    else await new Promise<void>(resolve => server.httpServer!.close(() => resolve()));
  }
  if (root) await rm(root, { recursive: true, force: true });
});

it.each(['dev', 'preview'] as const)('%s never serves room stores as assets or enables cross-origin reading', async mode => {
  root = await mkdtemp(path.join(tmpdir(), 'margin-private-assets-synthetic-'));
  const custom = path.join(root, 'custom room store');
  for (const dir of ['.margin-shared', '.margin-shared-preview', 'custom room store', 'dist/.margin-shared-preview']) {
    await mkdir(path.join(root, dir), { recursive: true });
    await writeFile(path.join(root, dir, 'synthetic-room.json'), JSON.stringify({ text: marker }));
  }
  await writeFile(path.join(root, 'index.html'), '<html><body>Synthetic Margin</body></html>');
  await writeFile(path.join(root, 'dist/index.html'), '<html><body>Synthetic Margin</body></html>');
  await writeFile(path.join(root, '.env'), 'SYNTHETIC_ONLY=not-a-credential');
  const options = { ...marginConfig(custom), root, configFile: false as const, logLevel: 'silent' as const };
  if (mode === 'dev') {
    server = await createServer({ ...options, server: { ...options.server, host: '127.0.0.1', port: 0, hmr: false, watch: null } });
    await server.listen();
  } else server = await preview({ ...options, preview: { ...options.preview, host: '127.0.0.1', port: 0 } });
  const url = `http://127.0.0.1:${(server.httpServer!.address() as AddressInfo).port}`;
  for (const folder of ['.margin-shared', '.margin-shared-preview', 'custom room store']) {
    for (const suffix of ['', '?raw', '?import']) {
      for (const route of [`/${folder}/synthetic-room.json`, `/@fs${root}/${folder}/synthetic-room.json`]) {
        const response = await fetch(url + route + suffix, { headers: { Origin: 'http://localhost:9876' } });
        expect(response.status, route + suffix).toBe(403);
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
        expect(await response.text()).not.toContain(marker);
      }
    }
  }
  const home = await fetch(url + '/', { headers: { Origin: 'http://localhost:9876' } });
  expect(home.ok).toBe(true);
  expect(await home.text()).toContain('Synthetic Margin');
  expect(home.headers.get('access-control-allow-origin')).toBeNull();
  if (mode === 'dev') {
    const env = await fetch(url + '/.env');
    expect(env.status).toBe(403);
    expect(await env.text()).not.toContain('SYNTHETIC_ONLY');
  }
});
