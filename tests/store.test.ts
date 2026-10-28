import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { dataKey, openStore } from '../server/store.mjs';
import { startRoomServer } from '../server/room-server.mjs';
import { demoProject } from '../src/demo';
import { exportProject, renameProject, validateProject, type Project, type Workspace } from '../src/model';

const model = { validateProject, exportProject };
let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'margin-store-synthetic-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
const workspace = (projects: Project[], revision: string): Workspace => ({ projects, activeId: projects[0]?.id ?? null, revision });
const point = (project: Project, label: string) => ({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), label, project });

describe('data file', () => {
  it('saves, reopens and refuses a stale revision', () => {
    const store = openStore(dir, model);
    const p = demoProject();
    expect(store.save({ next: workspace([p], 'a'), expectedRevision: '' })).toBe(true);
    expect(store.save({ next: workspace([], 'b'), expectedRevision: '' })).toBe(false);
    store.close();
    const again = openStore(dir, model);
    expect((again.workspace() as Workspace).projects[0].id).toBe(p.id);
    expect((again.workspace() as Workspace).revision).toBe('a');
    again.close();
  });

  it('keeps the latest 20 restore points and sets aside an unreadable list', () => {
    const store = openStore(dir, model);
    const p = demoProject();
    let revision = '';
    for (let i = 0; i < 23; i++) {
      expect(store.save({ next: workspace([p], `r${i}`), expectedRevision: revision, point: point(p, `Change ${i}`) })).toBe(true);
      revision = `r${i}`;
    }
    const kept = store.history(p.id).history as { label: string }[];
    expect(kept).toHaveLength(20);
    expect(kept[0].label).toBe('Change 3');
    expect(Object.keys(store.history(p.id).corrupt)).toHaveLength(0);
    store.close();
  });

  it('archives a version 1 project once, before its first upgrade', () => {
    const store = openStore(dir, model);
    const legacy: any = demoProject();
    legacy.version = 1;
    delete legacy.themes;
    for (const c of legacy.codes) {
      delete c.inclusion;
      delete c.exclusion;
      delete c.exampleQuoteIds;
    }
    store.save({ next: workspace([legacy], 'old'), expectedRevision: '' });
    const upgraded = validateProject(structuredClone(legacy));
    store.save({ next: workspace([upgraded], 'new'), expectedRevision: 'old' });
    expect(store.history(legacy.id).v1).toEqual(legacy);
    renameProject(upgraded, 'Renamed');
    store.save({ next: workspace([upgraded], 'newer'), expectedRevision: 'new' });
    expect(store.history(legacy.id).v1).toEqual(legacy);
    store.close();
  });

  it('deletes a project with its restore points', () => {
    const store = openStore(dir, model);
    const p = demoProject();
    store.save({ next: workspace([p], 'a'), expectedRevision: '', point: point(p, 'First') });
    expect(store.deleteProject({ next: workspace([], 'b'), expectedRevision: 'stale', projectId: p.id })).toBe(false);
    expect(store.deleteProject({ next: workspace([], 'b'), expectedRevision: 'a', projectId: p.id })).toBe(true);
    expect(store.history(p.id).history).toBeUndefined();
    store.close();
  });

  it('adds a browser’s projects without overwriting the file', () => {
    const store = openStore(dir, model);
    const mine = demoProject(),
      theirs = demoProject();
    renameProject(theirs, 'From the browser');
    store.save({ next: workspace([mine], 'a'), expectedRevision: '' });
    const changedMine = structuredClone(mine);
    renameProject(changedMine, 'Stale copy');
    const entries = { current: workspace([changedMine, theirs], 'x'), [`history:${theirs.id}`]: [point(theirs, 'Old')] };
    expect(store.importBrowser({ workspace: entries.current, entries })).toBe(1);
    const saved = store.workspace() as Workspace;
    expect(saved.projects.map(p => p.name)).toEqual([mine.name, 'From the browser']);
    expect(store.history(theirs.id).history).toHaveLength(1);
    expect(store.importBrowser({ workspace: entries.current, entries })).toBe(0);
    store.close();
  });

  it('is readable only by this account', () => {
    openStore(dir, model).close();
    const key = dataKey(dir);
    expect(dataKey(dir)).toBe(key);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(dir, 'margin.sqlite')).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(dir, 'key')).mode & 0o777).toBe(0o600);
  });
});

describe('data file over the local server', () => {
  let service: Awaited<ReturnType<typeof startRoomServer>>, store: ReturnType<typeof openStore>, base: string, key: string;
  const origin = 'http://127.0.0.1:4178';
  beforeEach(async () => {
    store = openStore(path.join(dir, 'data'), model);
    key = dataKey(path.join(dir, 'data'));
    service = await startRoomServer({ dataDir: path.join(dir, 'rooms'), allowedOrigins: [origin], ...model, store, storeKey: key });
    base = `http://127.0.0.1:${(service.server.address() as any).port}`;
  });
  afterEach(async () => {
    await service.close();
    store.close();
  });
  const send = (route: string, init: RequestInit = {}, withKey = key) =>
    fetch(`${base}/api/store${route}`, {
      ...init,
      headers: { 'X-Margin-Key': withKey, 'Content-Type': 'application/json', 'X-Margin-Local': '1', ...init.headers },
    });

  it('says it keeps a data file, and where only with the key', async () => {
    expect(await (await fetch(`${base}/api/store`)).json()).toEqual({ storage: 'file', unlocked: false });
    expect(await (await send('')).json()).toEqual({ storage: 'file', unlocked: true, path: store.file });
  });

  it('needs the key for every read and write', async () => {
    expect((await send('/workspace', {}, '')).status).toBe(401);
    expect((await send('/workspace', {}, 'x'.repeat(key.length))).status).toBe(401);
    const body = JSON.stringify({ next: workspace([], 'a'), expectedRevision: '' });
    expect((await send('/workspace', { method: 'PUT', body }, '')).status).toBe(401);
    expect(store.workspace()).toBeNull();
  });

  it('saves with the key and reports a conflict', async () => {
    const p = demoProject();
    const save = (revision: string, expectedRevision: string) =>
      send('/workspace', { method: 'PUT', body: JSON.stringify({ next: workspace([p], revision), expectedRevision }) });
    expect((await save('a', '')).status).toBe(200);
    expect((await save('b', '')).status).toBe(409);
    expect((await (await send('/workspace')).json()).workspace.revision).toBe('a');
  });

  it('refuses other websites, other host names and writes without Margin’s header', async () => {
    expect((await send('/workspace', { headers: { Origin: 'https://example.com' } })).status).toBe(403);
    const plain = await fetch(`${base}/api/store/workspace`, {
      method: 'PUT',
      headers: { 'X-Margin-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ next: workspace([], 'a'), expectedRevision: '' }),
    });
    expect(plain.status).toBe(403);
    const status = await new Promise<number>(resolve =>
      http
        .get(`${base}/api/store/workspace`, { headers: { Host: 'margin.example.com', 'X-Margin-Key': key } }, r => {
          r.resume();
          resolve(r.statusCode!);
        })
        .on('error', () => resolve(0)),
    );
    expect(status).toBe(403);
    expect(store.workspace()).toBeNull();
  });

  it('has no data file routes when the server keeps none', async () => {
    const plain = await startRoomServer({ dataDir: path.join(dir, 'plain'), allowedOrigins: [origin], ...model });
    const r = await fetch(`http://127.0.0.1:${(plain.server.address() as any).port}/api/store`);
    expect(r.status).toBe(404);
    await plain.close();
  });
});
