import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'margin-open-synthetic-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Exercise the real CLI without opening a browser or touching real user data.
const preload = `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    import { EventEmitter } from 'node:events';
    import { writeFileSync } from 'node:fs';
    const spawn = childProcess.spawn;
    childProcess.spawn = (command, args, options) => {
      if (args?.[0]?.endsWith('/vite/bin/vite.js') && process.env.MARGIN_TEST_VITE) {
        const script = process.env.MARGIN_TEST_VITE === 'exit' ? 'process.exit(1)' : 'setInterval(() => {}, 1000)';
        const child = spawn(process.execPath, ['-e', script], options);
        writeFileSync(process.env.MARGIN_TEST_OPEN_CAPTURE + '.vite', String(child.pid));
        return child;
      }
      if (!['open', 'cmd', 'xdg-open'].includes(command)) return spawn(command, args, options);
      if (process.env.MARGIN_TEST_OPEN_RESULT === 'held') {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
        writeFileSync(process.env.MARGIN_TEST_OPEN_CAPTURE, JSON.stringify({command, args, syntheticPid: child.pid}));
        return child;
      }
      writeFileSync(process.env.MARGIN_TEST_OPEN_CAPTURE, JSON.stringify({command, args}));
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit('spawn'));
      setTimeout(() => {
        if (process.env.MARGIN_TEST_OPEN_RESULT === 'missing')
          child.emit('error', new Error('Synthetic launcher failure with private URL ' + args.at(-1)));
        else if (process.env.MARGIN_TEST_OPEN_RESULT === 'failed') child.emit('exit', 3, null);
        else {
          console.log('Synthetic launcher acknowledged');
          child.emit('exit', 0, null);
        }
      }, 20);
      return child;
    };
    syncBuiltinESMExports();
    if (process.env.MARGIN_TEST_VITE === 'never-ready') {
      globalThis.fetch = async () => ({ok: false});
      const later = globalThis.setTimeout;
      globalThis.setTimeout = (callback, ms, ...args) => later(callback, ms === 200 ? 0 : ms, ...args);
    }
    if (process.env.MARGIN_TEST_OPEN_ACK_LONG === '1') {
      const later = globalThis.setTimeout;
      globalThis.setTimeout = (callback, ms, ...args) => later(callback, ms === 500 ? 10000 : ms, ...args);
    }
  `;

function open(storage = 'browser', args: string[] = [], port?: string, outcome = 'success') {
  const capture = path.join(dir, 'opened.json');
  const result = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--import',
      `data:text/javascript,${encodeURIComponent(preload)}`,
      'server/open.mjs',
      ...args,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        MARGIN_STORAGE: storage,
        MARGIN_DATA_DIR: dir,
        MARGIN_PORT: port ?? '',
        MARGIN_TEST_OPEN_CAPTURE: capture,
        MARGIN_TEST_OPEN_RESULT: outcome,
      },
      encoding: 'utf8',
      timeout: 5_000,
    },
  );
  const launched = existsSync(capture)
    ? (JSON.parse(readFileSync(capture, 'utf8')) as { command: string; args: string[]; syntheticPid?: number })
    : null;
  return { ...result, launched };
}

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

async function start(storage: string, outcome = 'missing', vite = '', portOverride?: number, preview = false) {
  const port = portOverride ?? (await freePort()),
    apiPort = await freePort();
  const capture = path.join(dir, 'opened.json');
  const child = spawn(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--import',
      `data:text/javascript,${encodeURIComponent(preload)}`,
      'server/start.mjs',
      '--open',
      ...(preview ? ['--preview'] : []),
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        MARGIN_STORAGE: storage,
        MARGIN_DATA_DIR: path.join(dir, 'data'),
        MARGIN_SHARED_DIR: path.join(dir, 'rooms'),
        MARGIN_PORT: String(port),
        MARGIN_API_PORT: String(apiPort),
        MARGIN_TEST_OPEN_CAPTURE: capture,
        MARGIN_TEST_OPEN_RESULT: outcome,
        MARGIN_TEST_VITE: vite,
        // Make this test require cancellation, rather than merely waiting out
        // the normal 500 ms acknowledgement window before the server exits.
        MARGIN_TEST_OPEN_ACK_LONG: outcome === 'held' ? '1' : '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.on('data', chunk => (output += chunk));
  child.stderr.on('data', chunk => (output += chunk));
  const stopped = new Promise<void>(resolve => child.once('close', () => resolve()));
  return { child, port, capture, output: () => output, stopped };
}

function releaseSyntheticLauncher(capture: string) {
  if (!existsSync(capture)) return;
  const { syntheticPid } = JSON.parse(readFileSync(capture, 'utf8')) as { syntheticPid?: number };
  if (syntheticPid) process.kill(syntheticPid, 'SIGTERM');
}

describe('open Margin from the terminal', () => {
  it('opens browser storage without requiring or creating a database or key', () => {
    const result = open();
    expect(result.status).toBe(0);
    expect(result.launched?.args.at(-1)).toBe('http://127.0.0.1:5173/');
    expect(readdirSync(dir)).toEqual(['opened.json']);
    expect(result.stdout.indexOf('Requested Margin')).toBeGreaterThan(result.stdout.indexOf('Synthetic launcher acknowledged'));
  });

  it('opens the preview port and respects an explicitly chosen port', () => {
    expect(open('browser', ['--preview']).launched?.args.at(-1)).toBe('http://127.0.0.1:4178/');
    expect(open('browser', ['--preview'], '6123').launched?.args.at(-1)).toBe('http://127.0.0.1:6123/');
  });

  it('leaves existing data-file credentials untouched in browser mode', () => {
    writeFileSync(path.join(dir, 'margin.sqlite'), 'synthetic database marker');
    writeFileSync(path.join(dir, 'key'), 'synthetic-key\n');
    const result = open();
    expect(result.status).toBe(0);
    expect(result.launched?.args.at(-1)).toBe('http://127.0.0.1:5173/');
    expect(readFileSync(path.join(dir, 'key'), 'utf8')).toBe('synthetic-key\n');
    expect(readFileSync(path.join(dir, 'margin.sqlite'), 'utf8')).toBe('synthetic database marker');
  });

  it('passes the existing data-file key to the browser without printing it', () => {
    writeFileSync(path.join(dir, 'margin.sqlite'), 'synthetic database marker');
    writeFileSync(path.join(dir, 'key'), 'synthetic-key\n');
    const result = open('file', ['--preview']);
    expect(result.status).toBe(0);
    expect(result.launched?.args.at(-1)).toBe('http://127.0.0.1:4178/#key=synthetic-key');
    expect(result.stdout + result.stderr).not.toContain('synthetic-key');
  });

  it('explains how to start a missing data file without creating one', () => {
    const result = open('file');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('npm run dev -- --open');
    expect(readdirSync(dir)).toEqual([]);
  });

  it.each(['missing', 'failed'])('reports a %s launcher with a nonzero exit and a manual browser-storage fallback', outcome => {
    const result = open('browser', [], '6123', outcome);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain('Requested Margin');
    expect(result.stderr).toContain('Open http://127.0.0.1:6123/ manually');
    expect(result.stderr).toContain('npm run open');
    expect(result.stderr).not.toContain('#key=');
    expect(result.stderr).not.toContain('Unhandled');
  });

  it('gives private data-file access instructions without exposing the key on launch failure', () => {
    writeFileSync(path.join(dir, 'margin.sqlite'), 'synthetic database marker');
    writeFileSync(path.join(dir, 'key'), 'synthetic-key\n');
    const result = open('file', ['--preview'], undefined, 'missing');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Open http://127.0.0.1:4178/ manually');
    expect(result.stderr).toContain(path.join(dir, 'key'));
    expect(result.stderr).toContain('append #key= followed by its contents');
    expect(result.stderr).toContain('npm run open -- --preview');
    expect(result.stdout + result.stderr).not.toContain('synthetic-key');
  });

  it('finishes the CLI after a bounded acknowledgement without killing a long-lived launcher', () => {
    const result = open('browser', [], undefined, 'held');
    try {
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Requested Margin');
      expect(result.launched?.syntheticPid).toBeDefined();
      expect(() => process.kill(result.launched!.syntheticPid!, 0)).not.toThrow();
    } finally {
      releaseSyntheticLauncher(path.join(dir, 'opened.json'));
    }
  });

  it.each([
    ['browser', false],
    ['file', false],
    ['file', true],
  ] as const)(
    'keeps the %s-storage server running when its launcher fails (preview %s)',
    async (storage, preview) => {
      const { child, port, output, stopped } = await start(storage, 'missing', '', undefined, preview);
      try {
        await expect
          .poll(() => output().includes('Margin is still running, but its browser could not be opened.'), { timeout: 15_000 })
          .toBe(true);
        expect(child.exitCode).toBeNull();
        expect((await fetch(`http://127.0.0.1:${port}/`)).ok).toBe(true);
        expect(output()).toContain(`Open http://127.0.0.1:${port}/ manually`);
        if (storage === 'file') expect(output()).not.toContain(readFileSync(path.join(dir, 'data', 'key'), 'utf8').trim());
      } finally {
        child.kill('SIGTERM');
        await stopped;
      }
    },
    20_000,
  );

  it('stops promptly during browser acknowledgement without terminating the launcher', async () => {
    const { child, capture, stopped } = await start('browser', 'held');
    try {
      await expect.poll(() => existsSync(capture), { timeout: 15_000, interval: 10 }).toBe(true);
      child.kill('SIGTERM');
      await expect.poll(() => child.exitCode, { timeout: 1_500, interval: 10 }).not.toBeNull();
      await stopped;
      const { syntheticPid } = JSON.parse(readFileSync(capture, 'utf8')) as { syntheticPid: number };
      expect(() => process.kill(syntheticPid, 0)).not.toThrow();
    } finally {
      child.kill('SIGTERM');
      releaseSyntheticLauncher(capture);
      await stopped;
    }
  }, 20_000);

  it.each(['exit', 'hold', 'never-ready'])(
    'does not open a browser when Vite is %s during readiness',
    async vite => {
      const { child, capture, output, stopped } = await start('browser', 'success', vite);
      try {
        await expect.poll(() => existsSync(`${capture}.vite`), { timeout: 10_000 }).toBe(true);
        if (vite === 'hold') child.kill('SIGTERM');
        if (vite === 'never-ready') {
          await expect.poll(() => output().includes('did not become ready in time'), { timeout: 5_000 }).toBe(true);
          child.kill('SIGTERM');
        }
        await expect.poll(() => child.exitCode, { timeout: 1_500, interval: 10 }).not.toBeNull();
        await stopped;
        expect(existsSync(capture)).toBe(false);
      } finally {
        child.kill('SIGTERM');
        await stopped;
      }
    },
    20_000,
  );

  it.each([
    ['browser', false],
    ['file', false],
    ['file', true],
  ] as const)(
    'never opens another app occupying the UI port (%s storage, preview %s)',
    async (storage, preview) => {
      const unrelated = createHttpServer((_request, response) => {
        response.setHeader('X-Margin-Instance', 'a-different-server');
        response.end('An unrelated local app');
      });
      await new Promise<void>((resolve, reject) => {
        unrelated.once('error', reject);
        unrelated.listen(0, '127.0.0.1', resolve);
      });
      const port = (unrelated.address() as { port: number }).port;
      const { child, capture, stopped } = await start(storage, 'success', '', port, preview);
      try {
        await expect.poll(() => child.exitCode, { timeout: 5_000 }).toBe(1);
        await stopped;
        expect(existsSync(capture)).toBe(false);
      } finally {
        child.kill('SIGTERM');
        await stopped;
        await new Promise<void>(resolve => unrelated.close(() => resolve()));
      }
    },
    10_000,
  );
});
