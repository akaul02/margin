// The local data file: Margin's workspace, restore points and archives in one SQLite database.
// It uses the same keys and the same rules as browser storage, so the two stay interchangeable.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { addRestorePoint, legacyArchives } from '../shared/history.mjs';

/** Where Margin keeps its data when MARGIN_DATA_DIR is not set. */
export function defaultDataDir() {
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Margin');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Margin');
  return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'margin');
}

/** The key a browser needs before it can read or write the data file. Only this account can read it. */
export function dataKey(dir) {
  const file = path.join(dir, 'key');
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64url') + '\n', { mode: 0o600 });
  return readFileSync(file, 'utf8').trim();
}

export function sameKey(a, b) {
  const x = Buffer.from(String(a)),
    y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Opens (or creates) margin.sqlite in `dir`, checking projects with the model's validateProject and exportProject.
 * Every write checks the workspace revision inside the same transaction, like browser storage does.
 */
export function openStore(dir, { validateProject, exportProject }) {
  const check = raw => {
    const project = validateProject(raw);
    exportProject(project);
    return project;
  };
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = path.join(dir, 'margin.sqlite');
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
  `);
  const selectOne = db.prepare('SELECT value FROM entries WHERE key = ?');
  const selectRange = db.prepare('SELECT key, value FROM entries WHERE key >= ? AND key < ? ORDER BY key');
  const selectRevision = db.prepare("SELECT json_extract(value, '$.revision') AS revision FROM entries WHERE key = 'current'");
  const upsert = db.prepare('INSERT INTO entries (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');
  const remove = db.prepare('DELETE FROM entries WHERE key = ?');
  const removeRange = db.prepare('DELETE FROM entries WHERE key >= ? AND key < ?');

  const read = key => {
    const row = selectOne.get(key);
    return row ? JSON.parse(row.value) : undefined;
  };
  const write = (key, value) => upsert.run(key, JSON.stringify(value));
  const range = prefix => selectRange.all(prefix, prefix + '￿');
  const revision = () => selectRevision.get()?.revision ?? '';

  /** Runs `body` in one write transaction. A false result rolls it back. */
  function transaction(body) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const ok = body();
      db.exec(ok ? 'COMMIT' : 'ROLLBACK');
      return ok;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  return {
    file,
    /** The stored workspace as saved, or null before the first save. */
    workspace: () => read('current') ?? null,

    /** Saves the workspace, archiving legacy projects and adding a restore point. False means another tab saved first. */
    save({ next, expectedRevision, point }) {
      return transaction(() => {
        if (revision() !== expectedRevision) return false;
        for (const [key, raw] of legacyArchives(read('current')?.projects, validateProject)) if (!selectOne.get(key)) write(key, raw);
        if (point) {
          const key = `history:${point.project.id}`,
            raw = read(key);
          const { points, corrupt } = addRestorePoint(raw, point, check);
          if (corrupt) write(`history-corrupt:${point.project.id}:${randomUUID()}`, raw);
          write(key, points);
        }
        write('current', next);
        return true;
      });
    },

    /** Saves the workspace without one project and drops that project's restore points and archives. */
    deleteProject({ next, expectedRevision, projectId }) {
      return transaction(() => {
        if (revision() !== expectedRevision) return false;
        for (const key of [`history:${projectId}`, `v1:${projectId}`, `v2:${projectId}`]) remove.run(key);
        const prefix = `history-corrupt:${projectId}:`;
        removeRange.run(prefix, prefix + '￿');
        write('current', next);
        return true;
      });
    },

    /** A project's stored restore points and archives, unvalidated. */
    history(projectId) {
      const corrupt = range(`history-corrupt:${projectId}:`);
      return {
        history: read(`history:${projectId}`),
        v1: read(`v1:${projectId}`),
        v2: read(`v2:${projectId}`),
        corrupt: Object.fromEntries(corrupt.map(row => [row.key, JSON.parse(row.value)])),
      };
    },

    /**
     * Adds a browser's saved projects that the file does not have yet, with their restore points and archives.
     * Projects already in the file are never overwritten. Returns how many projects were added.
     */
    importBrowser({ workspace, entries }) {
      let added = 0;
      transaction(() => {
        const current = read('current') ?? { projects: [], activeId: null, revision: '' };
        const known = new Set(current.projects.map(p => p?.id));
        const incoming = (Array.isArray(workspace?.projects) ? workspace.projects : []).filter(
          p => typeof p?.id === 'string' && !known.has(p.id),
        );
        if (!incoming.length) return false;
        const ids = new Set(incoming.map(p => p.id));
        for (const [key, value] of Object.entries(entries ?? {})) {
          const id = /^(?:history|v1|v2):(.+)$/.exec(key)?.[1] ?? /^history-corrupt:([^:]+):/.exec(key)?.[1];
          if (id && ids.has(id) && !selectOne.get(key)) write(key, value);
        }
        const connections = Object.fromEntries(Object.entries(workspace.connections ?? {}).filter(([id]) => ids.has(id)));
        write('current', {
          ...current,
          projects: [...current.projects, ...incoming],
          connections: { ...current.connections, ...connections },
          activeId: current.activeId ?? (incoming.some(p => p.id === workspace.activeId) ? workspace.activeId : incoming[0].id),
          revision: randomUUID(),
        });
        added = incoming.length;
        return true;
      });
      return added;
    },

    close: () => db.close(),
  };
}
