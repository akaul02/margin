import { type Workspace, type Project, type QuarantinedProject, validateProject, exportProject, uid, now } from './model';
import { validateOperation } from '../shared/operations.mjs';
import { addRestorePoint, legacyArchives, validPoints } from '../shared/history.mjs';
export type RestorePoint = { id: string; createdAt: string; label: string; project: Project };
export type HistoryResult = { points: RestorePoint[]; migration: unknown | null; intermediate?: unknown; corrupt: boolean };
const check = (raw: unknown) => {
  const project = validateProject(raw);
  exportProject(project);
  return project;
};
/** Checks a stored workspace. Unreadable projects are set aside in `quarantined`, never dropped. */
function readWorkspace(data: any): Workspace {
  if (!data) return { projects: [], activeId: null, revision: '' };
  if (!Array.isArray(data.projects) || typeof data.revision !== 'string') throw new Error('Invalid local workspace.');
  const projects: Project[] = [];
  const quarantined: QuarantinedProject[] = Array.isArray(data.quarantined) ? data.quarantined : [];
  for (const raw of data.projects) {
    try {
      const project = validateProject(raw);
      exportProject(project);
      if (projects.some(p => p.id === project.id)) throw new Error('Duplicate project ID in local storage.');
      projects.push(project);
    } catch (e) {
      quarantined.push({ raw, reason: (e as Error).message });
    }
  }
  const connections = Object.fromEntries(
    Object.entries(data.connections ?? {}).filter(([key, value]) => {
      const c = value as { roomId?: unknown; revision?: unknown; dirty?: unknown };
      return (
        projects.some(p => p.id === key) &&
        c &&
        typeof c.roomId === 'string' &&
        /^[a-zA-Z0-9_-]{1,100}$/.test(c.roomId) &&
        typeof c.revision === 'string' &&
        typeof c.dirty === 'boolean'
      );
    }),
  );
  for (const [projectId, value] of Object.entries(connections)) {
    const c = value as NonNullable<Workspace['connections']>[string];
    if (c.pending !== undefined && (!Array.isArray(c.pending) || c.pending.some(op => validateOperation(op).projectId !== projectId)))
      throw new Error('A saved sharing queue could not be read. Download recovery data before making changes.');
    if (c.creating && validateProject(c.creating).id !== projectId)
      throw new Error('A pending room could not be read. Your saved data is unchanged.');
    if (c.conflict && validateProject(c.conflict.remote).id !== projectId)
      throw new Error('A saved conflict could not be read. Your saved data is unchanged.');
  }
  return {
    projects,
    connections: connections as Workspace['connections'],
    // null means the reader chose Home; only a missing or stale id falls back to the first project.
    activeId: data.activeId === null ? null : projects.some(p => p.id === data.activeId) ? data.activeId : (projects[0]?.id ?? null),
    revision: data.revision,
    quarantined,
  };
}
/** Projects in this browser's IndexedDB: the demo, hosted accounts, and MARGIN_STORAGE=browser. */
function createBrowserStorage(namespace = '') {
  const DB = namespace ? `ceal-margin-account:${encodeURIComponent(namespace)}` : 'ceal-margin-local';
  function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('workspace');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(new Error('Browser storage is unavailable. Try a regular browser window with site storage enabled.'));
      r.onblocked = () => reject(new Error('Another tab is blocking local storage. Close other Margin tabs and reload.'));
    });
  }
  async function loadWorkspace(): Promise<Workspace> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspace', 'readonly');
      const request = tx.objectStore('workspace').get('current');
      request.onsuccess = () => {
        try {
          resolve(readWorkspace(request.result));
        } catch (e) {
          reject(e);
        }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        reject(tx.error ?? new Error('The storage read was interrupted. Reload to try again.'));
      };
    });
  }
  /** Evidence, history, migration backups and revision checks commit together or not at all. */
  async function saveWorkspace(next: Workspace, expectedRevision: string, checkpoint?: { project: Project; label: string }): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      let conflict = false;
      const tx = db.transaction('workspace', 'readwrite');
      const store = tx.objectStore('workspace');
      const r = store.get('current');
      r.onsuccess = () => {
        if ((r.result?.revision ?? '') !== expectedRevision) {
          conflict = true;
          tx.abort();
          return;
        }
        // Preserve each legacy project before the first write upgrades the workspace.
        for (const [key, raw] of legacyArchives(r.result?.projects, validateProject)) {
          const previous = store.get(key);
          previous.onsuccess = () => {
            if (previous.result === undefined) store.put(raw, key);
          };
        }
        if (checkpoint) {
          const key = `history:${checkpoint.project.id}`;
          const h = store.get(key);
          h.onsuccess = () => {
            const { points, corrupt } = addRestorePoint(
              h.result,
              { id: uid(), createdAt: now(), label: checkpoint.label, project: checkpoint.project },
              check,
            );
            if (corrupt) store.put(h.result, `history-corrupt:${checkpoint.project.id}:${uid()}`);
            store.put(points, key);
          };
        }
        store.put(next, 'current');
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(
          new Error(
            conflict
              ? 'Another tab changed this workspace. Reload this tab before making more changes. Your previous work is safe.'
              : 'This change could not be saved to browser storage. Nothing was changed. Check available storage and export a backup.',
          ),
        );
      };
      tx.onerror = () => {};
    });
  }
  async function loadHistory(projectId: string): Promise<HistoryResult> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspace');
      const store = tx.objectStore('workspace');
      const h = store.get(`history:${projectId}`);
      const m = store.get(`v1:${projectId}`);
      const m2 = store.get(`v2:${projectId}`);
      const keys = store.getAllKeys();
      tx.oncomplete = () => {
        db.close();
        const points = validPoints(h.result, check).filter(x => x.project.id === projectId);
        resolve({
          points,
          migration: m.result ?? m2.result ?? null,
          intermediate: m.result && m2.result ? m2.result : undefined,
          corrupt:
            (h.result !== undefined && (!Array.isArray(h.result) || points.length !== h.result.length)) ||
            keys.result.some(k => String(k).startsWith(`history-corrupt:${projectId}:`)),
        });
      };
      tx.onabort = () => {
        db.close();
        reject(new Error('Could not read restore points. Your project is unchanged.'));
      };
    });
  }
  async function rawHistory(projectId: string): Promise<string> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspace');
      const store = tx.objectStore('workspace');
      const out: Record<string, unknown> = {};
      for (const key of [`history:${projectId}`, `v1:${projectId}`, `v2:${projectId}`]) {
        const read = store.get(key);
        read.onsuccess = () => {
          if (read.result !== undefined) out[key] = read.result;
        };
      }
      const prefix = `history-corrupt:${projectId}:`;
      const r = store.openCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'));
      r.onsuccess = () => {
        const cursor = r.result;
        if (!cursor) return;
        out[String(cursor.key)] = cursor.value;
        cursor.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve(JSON.stringify(out, null, 2));
      };
      tx.onabort = () => {
        db.close();
        reject(new Error('Recovery read was interrupted.'));
      };
    });
  }
  async function rawWorkspace(): Promise<string> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspace');
      const r = tx.objectStore('workspace').get('current');
      r.onsuccess = () => resolve(JSON.stringify(r.result ?? null, null, 2));
      r.onerror = () => {
        db.close();
        reject(r.error);
      };
      tx.oncomplete = () => db.close();
      tx.onabort = () => {
        db.close();
        reject(tx.error ?? new Error('Recovery read was interrupted. Retry the download.'));
      };
    });
  }

  /** Save a workspace without one project and drop that project's restore points and pre-upgrade archives in the same transaction. */
  async function deleteProjectStorage(next: Workspace, expectedRevision: string, projectId: string): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      let conflict = false;
      const tx = db.transaction('workspace', 'readwrite');
      const store = tx.objectStore('workspace');
      const r = store.get('current');
      r.onsuccess = () => {
        if ((r.result?.revision ?? '') !== expectedRevision) {
          conflict = true;
          tx.abort();
          return;
        }
        for (const key of [`history:${projectId}`, `v1:${projectId}`, `v2:${projectId}`]) store.delete(key);
        store.delete(IDBKeyRange.bound(`history-corrupt:${projectId}:`, `history-corrupt:${projectId}:\uffff`));
        store.put(next, 'current');
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(
          new Error(
            conflict
              ? 'Another tab changed this workspace. Reload this tab, then delete the project again. Nothing was deleted.'
              : 'The project could not be deleted from browser storage. Nothing was changed.',
          ),
        );
      };
      tx.onerror = () => {};
    });
  }

  /** Everything this browser has saved, for moving it into the data file. */
  async function allEntries(): Promise<Record<string, unknown>> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspace');
      const out: Record<string, unknown> = {};
      const r = tx.objectStore('workspace').openCursor();
      r.onsuccess = () => {
        const cursor = r.result;
        if (!cursor) return;
        out[String(cursor.key)] = cursor.value;
        cursor.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve(out);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    });
  }
  /** Remembers that this browser's projects went to the data file, so they are moved once. Clearing site data clears it too. */
  async function markMoved(): Promise<void> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('workspace', 'readwrite');
      tx.objectStore('workspace').put(now(), MOVED);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    });
  }

  return { loadWorkspace, saveWorkspace, deleteProjectStorage, loadHistory, rawHistory, rawWorkspace, allEntries, markMoved };
}
type BrowserStorage = ReturnType<typeof createBrowserStorage>;
const MOVED = 'moved-to-data-file';

export type SavedIn = { kind: 'browser' } | { kind: 'file'; path: string; moved: number };
const LOCKED =
  "This browser doesn't have Margin's key yet. Your work is safe in Margin's data file on this computer. To open it here, run npm run open in the Margin folder.";
const NOT_RUNNING =
  "Margin's local server isn't answering. Your saved work is unchanged. Start Margin again (npm run dev) and reload this page.";

/**
 * Projects in margin.sqlite, through the local server (server/store.mjs). The server applies each save in one
 * transaction with the same rules as browser storage. A browser's existing projects are copied in once.
 */
function createFileStorage(key: string, path: string, browser: BrowserStorage) {
  const savedIn: Extract<SavedIn, { kind: 'file' }> = { kind: 'file', path, moved: 0 };
  async function call<T>(route: string, method = 'GET', body?: unknown): Promise<T | 'conflict'> {
    let r: Response;
    try {
      r = await fetch(`/api/store${route}`, {
        method,
        cache: 'no-store',
        headers: { 'X-Margin-Key': key, ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Margin-Local': '1' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error(NOT_RUNNING);
    }
    if (r.status === 409) return 'conflict';
    if (r.status === 401) throw new Error(LOCKED);
    if (!r.ok) throw new Error(`Margin's data file could not be used (error ${r.status}). Nothing was changed.`);
    return r.json();
  }
  const read = async <T>(route: string) => (await call<T>(route)) as T;
  async function moveBrowserProjects() {
    let entries: Record<string, unknown>;
    try {
      entries = await browser.allEntries();
    } catch {
      return; // No browser storage here, so nothing to move.
    }
    if (entries[MOVED] !== undefined) return;
    if (entries.current) {
      const result = (await call<{ added: number }>('/import', 'POST', { workspace: entries.current, entries })) as { added: number };
      savedIn.moved = result.added;
    }
    await browser.markMoved();
  }
  return {
    savedIn,
    async loadWorkspace(): Promise<Workspace> {
      await moveBrowserProjects();
      return readWorkspace((await read<{ workspace: unknown }>('/workspace')).workspace);
    },
    async saveWorkspace(next: Workspace, expectedRevision: string, checkpoint?: { project: Project; label: string }): Promise<void> {
      const point = checkpoint && { id: uid(), createdAt: now(), label: checkpoint.label, project: checkpoint.project };
      if ((await call('/workspace', 'PUT', { next, expectedRevision, point })) === 'conflict')
        throw new Error('Another tab changed this workspace. Reload this tab before making more changes. Your previous work is safe.');
    },
    async deleteProjectStorage(next: Workspace, expectedRevision: string, projectId: string): Promise<void> {
      if ((await call('/delete-project', 'POST', { next, expectedRevision, projectId })) === 'conflict')
        throw new Error('Another tab changed this workspace. Reload this tab, then delete the project again. Nothing was deleted.');
    },
    async loadHistory(projectId: string): Promise<HistoryResult> {
      const h = await read<{ history?: unknown; v1?: unknown; v2?: unknown; corrupt: Record<string, unknown> }>(
        `/history/${encodeURIComponent(projectId)}`,
      );
      const points = validPoints(h.history, check).filter(x => x.project.id === projectId);
      return {
        points,
        migration: h.v1 ?? h.v2 ?? null,
        intermediate: h.v1 && h.v2 ? h.v2 : undefined,
        corrupt:
          (h.history !== undefined && (!Array.isArray(h.history) || points.length !== h.history.length)) ||
          Object.keys(h.corrupt).length > 0,
      };
    },
    async rawHistory(projectId: string): Promise<string> {
      const h = await read<{ history?: unknown; v1?: unknown; v2?: unknown; corrupt: Record<string, unknown> }>(
        `/history/${encodeURIComponent(projectId)}`,
      );
      const out: Record<string, unknown> = {};
      if (h.history !== undefined) out[`history:${projectId}`] = h.history;
      if (h.v1 !== undefined) out[`v1:${projectId}`] = h.v1;
      if (h.v2 !== undefined) out[`v2:${projectId}`] = h.v2;
      return JSON.stringify({ ...out, ...h.corrupt }, null, 2);
    },
    async rawWorkspace(): Promise<string> {
      return JSON.stringify((await read<{ workspace: unknown }>('/workspace')).workspace, null, 2);
    },
  };
}

/** Takes the key from a link opened by npm run open (#key=…) and keeps it in this browser. */
function linkedKey() {
  const fromLink = /(?:^#|&)key=([\w-]{20,})/.exec(location.hash)?.[1];
  try {
    if (fromLink) {
      localStorage.setItem('margin-key', fromLink);
      history.replaceState(null, '', location.pathname + location.search);
    }
    return fromLink ?? localStorage.getItem('margin-key') ?? '';
  } catch {
    return fromLink ?? '';
  }
}

/** Asks the local server whether it keeps a data file. Without a Margin server (the demo), projects stay in the browser. */
async function chooseStorage(browser: BrowserStorage) {
  const key = linkedKey();
  let r: Response;
  try {
    r = await fetch('/api/store', { headers: key ? { 'X-Margin-Key': key } : {}, cache: 'no-store' });
  } catch {
    throw new Error(NOT_RUNNING);
  }
  const info = r.headers.get('content-type')?.includes('application/json') ? await r.json().catch(() => null) : null;
  if (info?.storage === 'file') {
    if (!info.unlocked) {
      // Opening the key link in this same tab only changes the hash, so start over when it arrives.
      addEventListener('hashchange', () => /key=/.test(location.hash) && location.reload());
      throw new Error(LOCKED);
    }
    return createFileStorage(key, info.path, browser);
  }
  if (r.status >= 500) throw new Error(NOT_RUNNING);
  // Ask the browser not to clear Margin's storage on its own. People can still clear it, so backups matter.
  void navigator.storage?.persist?.().catch(() => {});
  return { ...browser, savedIn: { kind: 'browser' } as SavedIn };
}

/** Where this copy of Margin saves projects: the local data file when Margin's server keeps one, otherwise the browser. */
export function createWorkspaceStorage(namespace = '') {
  const browser = createBrowserStorage(namespace);
  let chosen: ReturnType<typeof chooseStorage> | undefined;
  const use = () =>
    namespace ? Promise.resolve({ ...browser, savedIn: { kind: 'browser' } as SavedIn }) : (chosen ??= chooseStorage(browser));
  return {
    savedIn: async () => (await use()).savedIn,
    loadWorkspace: async () => (await use()).loadWorkspace(),
    saveWorkspace: async (next: Workspace, expectedRevision: string, checkpoint?: { project: Project; label: string }) =>
      (await use()).saveWorkspace(next, expectedRevision, checkpoint),
    deleteProjectStorage: async (next: Workspace, expectedRevision: string, projectId: string) =>
      (await use()).deleteProjectStorage(next, expectedRevision, projectId),
    loadHistory: async (projectId: string) => (await use()).loadHistory(projectId),
    rawHistory: async (projectId: string) => (await use()).rawHistory(projectId),
    rawWorkspace: async () => (await use()).rawWorkspace(),
  };
}
