import { type Workspace, type Project, type QuarantinedProject, validateProject, exportProject, byteLength, uid, now } from './model';
import { validateOperation } from '../shared/operations.mjs';
export type RestorePoint = { id: string; createdAt: string; label: string; project: Project };
export type HistoryResult = { points: RestorePoint[]; migration: unknown | null; intermediate?: unknown; corrupt: boolean };
export function createWorkspaceStorage(namespace = '') {
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
          const data = request.result;
          if (!data) {
            resolve({ projects: [], activeId: null, revision: '' });
            return;
          }
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
            if (
              c.pending !== undefined &&
              (!Array.isArray(c.pending) || c.pending.some(op => validateOperation(op).projectId !== projectId))
            )
              throw new Error('A saved sharing queue could not be read. Download recovery data before making changes.');
            if (c.creating && validateProject(c.creating).id !== projectId)
              throw new Error('A pending room could not be read. Your saved data is unchanged.');
            if (c.conflict && validateProject(c.conflict.remote).id !== projectId)
              throw new Error('A saved conflict could not be read. Your saved data is unchanged.');
          }
          resolve({
            projects,
            connections: connections as Workspace['connections'],
            // null means the reader chose Home; only a missing or stale id falls back to the first project.
            activeId: data.activeId === null ? null : projects.some(p => p.id === data.activeId) ? data.activeId : (projects[0]?.id ?? null),
            revision: data.revision,
            quarantined,
          });
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
  function validPoints(raw: unknown): RestorePoint[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap(point => {
      try {
        if (
          typeof point.id !== 'string' ||
          typeof point.label !== 'string' ||
          typeof point.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(point.createdAt))
        )
          return [];
        const project = validateProject(point.project);
        exportProject(project);
        return [{ id: point.id, label: point.label.slice(0, 300), createdAt: point.createdAt, project }];
      } catch {
        return [];
      }
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
        const archivedIds = new Set<string>();
        for (const raw of r.result?.projects ?? []) {
          if (![1, 2].includes(raw?.version) || typeof raw.id !== 'string' || archivedIds.has(raw.id)) continue;
          try {
            validateProject(raw);
          } catch {
            continue;
          }
          archivedIds.add(raw.id);
          const key = `v${raw.version}:${raw.id}`,
            previous = store.get(key);
          previous.onsuccess = () => {
            if (previous.result === undefined) store.put(raw, key);
          };
        }
        if (checkpoint) {
          const key = `history:${checkpoint.project.id}`;
          const h = store.get(key);
          h.onsuccess = () => {
            const points = validPoints(h.result).filter(x => x.project.id === checkpoint.project.id);
            if (h.result !== undefined && (!Array.isArray(h.result) || points.length !== h.result.length))
              store.put(h.result, `history-corrupt:${checkpoint.project.id}:${uid()}`);
            points.push({ id: uid(), createdAt: now(), label: checkpoint.label, project: checkpoint.project });
            // Keep the latest 20 restore points, bounded to 20 MB per project.
            const sizes = points.map(point => byteLength(JSON.stringify(point)) + 1);
            let total = sizes.reduce((sum, size) => sum + size, 1);
            while (points.length > 20 || (points.length > 1 && total > 20_000_000)) {
              points.shift();
              total -= sizes.shift()!;
            }
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
        const points = validPoints(h.result).filter(x => x.project.id === projectId);
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

  return { loadWorkspace, saveWorkspace, deleteProjectStorage, loadHistory, rawHistory, rawWorkspace };
}
export const { loadWorkspace, saveWorkspace, deleteProjectStorage, loadHistory, rawHistory, rawWorkspace } = createWorkspaceStorage();
