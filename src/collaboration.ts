import { validateProject, type Project } from './model';
import { assertHostedProject, assertHostedOperation } from '../shared/hosted-limits';
import type { Operation } from '../shared/operations.mjs';
export type { SharedConnection } from './model';
export type SharedRoom = { id: string; revision: string; project: Project; updatedAt: string; role?: 'owner' | 'editor' };
export class SharedError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: any,
  ) {
    super(message);
  }
}
export type HostedIdentity = { id: string; token: () => Promise<string>; signal: AbortSignal };
export function createCollaboration(identity?: HostedIdentity) {
  async function request(path: string, method = 'GET', body?: unknown) {
    let response: Response;
    try {
      const token = identity ? await identity.token() : undefined;
      if (identity?.signal.aborted) throw new Error('Account changed.');
      response = await fetch(`/api${path}`, {
        method,
        headers: {
          ...(identity ? { Authorization: `Bearer ${token}` } : { 'X-Margin-Local': '1' }),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: identity ? AbortSignal.any([identity.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(12000),
      });
    } catch {
      throw new SharedError(
        identity
          ? 'Connection interrupted or your account changed. Your pending work stays in this account’s browser workspace.'
          : 'The local sharing server is unavailable. Your work is still saved in this browser.',
        0,
      );
    }
    let data: any;
    try {
      data = await response.json();
    } catch {
      throw new SharedError('Start Margin with npm run dev to enable local sharing.', response.status);
    }
    if (!response.ok) {
      const message =
        response.status === 401
          ? 'Sign in again to continue sharing. Your browser copy is kept.'
          : response.status === 403
            ? 'This account no longer has access to the shared project. Your existing browser copy is kept.'
            : (data.message ??
              (data.error === 'operation_ledger_full'
                ? 'This room has reached its operation limit. Your edits are kept here. Export a backup and start a new room.'
                : response.status === 409
                  ? 'Another editor changed an item you edited. Both versions are kept. Review the conflicting save.'
                  : data.error === 'invalid_project'
                    ? 'The shared project did not pass evidence validation.'
                    : 'The sharing service could not complete this request. Your browser copy is safe.'));
      throw new SharedError(message, response.status, data);
    }

    return data;
  }
  function room(data: any): SharedRoom {
    if (!data || typeof data.id !== 'string' || typeof data.revision !== 'string' || typeof data.updatedAt !== 'string')
      throw new Error('Invalid shared room response.');
    return { ...data, project: validateProject(data.project) };
  }
  async function sharingAvailable() {
    try {
      return (await request('/health')).scope === (identity ? 'hosted' : 'loopback');
    } catch {
      return false;
    }
  }
  const createRoom = async (project: Project, id?: string) => room(await request('/rooms', 'POST', { project, id }));
  const readRoom = async (id: string) => room(await request(`/rooms/${encodeURIComponent(id)}`));
  const writeRoom = async (id: string, revision: string, project: Project) =>
    room(await request(`/rooms/${encodeURIComponent(id)}`, 'PUT', { expectedRevision: revision, project }));
  const sendOperation = async (id: string, operation: Operation) => {
    const data = await request(`/rooms/${encodeURIComponent(id)}/operations`, 'POST', operation);
    if (data.receipt?.id !== operation.id) throw new Error('The server did not acknowledge this edit. Its retry remains saved here.');
    return room(data);
  };
  function watchRoom(id: string, onChange: () => void, onError: () => void) {
    if (identity) return () => {};
    const source = new EventSource(`/api/rooms/${encodeURIComponent(id)}/events`);
    source.onopen = onChange;
    source.onmessage = onChange;
    source.onerror = onError;
    return () => source.close();
  }

  const assertShareableProject = (value: Project) => {
    if (identity) assertHostedProject(value);
  };
  const assertShareableEdit = (value: Project, operation: Operation) => {
    if (identity) {
      assertHostedProject(value);
      assertHostedOperation(operation);
    } else if (new TextEncoder().encode(JSON.stringify(operation)).length > 16_500_000)
      throw new Error(
        'This edit is too large to share at once. Nothing was changed. Export a backup and split the edit into smaller steps.',
      );
  };
  const listRooms = async (after?: string) => request(`/rooms${after ? `?after=${encodeURIComponent(after)}` : ''}`);
  const members = async (id: string, method = 'GET', userId?: string) =>
    request(`/rooms/${encodeURIComponent(id)}/members`, method, userId ? { userId } : undefined);
  return {
    sharingAvailable,
    createRoom,
    readRoom,
    writeRoom,
    sendOperation,
    watchRoom,
    assertShareableProject,
    assertShareableEdit,
    listRooms,
    members,
  };
}
export const { sharingAvailable, createRoom, readRoom, writeRoom, sendOperation, watchRoom } = createCollaboration();
