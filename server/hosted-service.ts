import { createHash, randomUUID } from 'node:crypto';
import { canonical, validateOperation, applyOperation, assertImmutableSources } from '../shared/operations.mjs';
import { validateProject, exportProject } from '../src/model';
import { assertHostedOperation, assertHostedProject, HOSTED_OPERATION_BYTES, HOSTED_PROJECT_BYTES } from '../shared/hosted-limits';

export type PublicConfig = { mode: 'hosted'; supabaseUrl: string; publishableKey: string; projectBytes: number };
export type HostedDependencies = {
  config: PublicConfig;
  verify: (token: string) => Promise<{ id: string } | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<any>;
};
const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
class HttpError extends Error { constructor(public status: number, public error: string, public extra: Record<string, unknown> = {}) { super(error); } }
function json(value: unknown, status = 200) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > 3_500_000) return json({ error: 'response_too_large' }, 500);
  return new Response(text, { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0', 'Vary': 'Authorization', 'X-Content-Type-Options': 'nosniff' } });
}
async function body(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'json_required');
  if (Number(request.headers.get('content-length')) > HOSTED_OPERATION_BYTES) throw new HttpError(413, 'payload_too_large');
  const reader = request.body?.getReader(); let bytes = 0; const chunks: Uint8Array[] = [];
  if (!reader) throw new HttpError(400, 'invalid_json');
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > HOSTED_OPERATION_BYTES) { await reader.cancel(); throw new HttpError(413, 'payload_too_large'); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'invalid_json'); }
}
function checked(result: any) {
  if (!result || typeof result !== 'object') throw new HttpError(503, 'storage_unavailable');
  if (result.error) {
    const status = result.error === 'forbidden' ? 403 : result.error === 'not_found' ? 404 : ['id_reused','room_limit','member_limit','owner_required','operation_ledger_full'].includes(result.error) ? 409 : 400;
    throw new HttpError(status, result.error);
  }
  return result;
}
function project(value: unknown) {
  try { const p = validateProject(value); exportProject(p); assertHostedProject(p); return p; }
  catch (error) { throw new HttpError(422, 'invalid_project', { message: (error as Error).message }); }
}

export function createHostedHandler(deps: HostedDependencies) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const path = '/' + (url.searchParams.get('route') ?? url.pathname.replace(/^\/api\/?/, '')).replace(/^\/+|\/+$/g, '');
      const method = request.method;
      if (path === '/config' && method === 'GET') return json(deps.config);
      // No browser cookies or query tokens authorize any research-data route.
      const authorization = request.headers.get('authorization');
      if (!authorization?.startsWith('Bearer ') || authorization.length > 16_000) throw new HttpError(401, 'sign_in_required');
      const user = await deps.verify(authorization.slice(7));
      if (!user || !uuid(user.id)) throw new HttpError(401, 'sign_in_required');
      const actor = user.id;
      if (path === '/health' && method === 'GET') return json({ ok: true, scope: 'hosted' });
      if (path === '/rooms' && method === 'GET') {
        const after = url.searchParams.get('after'); if (after && !uuid(after)) throw new HttpError(400, 'invalid_id');
        return json(checked(await deps.rpc('margin_list', { p_actor: actor, p_after: after })));
      }
      if (path === '/rooms' && method === 'POST') {
        const data = await body(request); if (!uuid(data?.id)) throw new HttpError(400, 'stable_room_id_required');
        const value = project(data.project);
        return json(checked(await deps.rpc('margin_create', { p_actor: actor, p_id: data.id, p_project: value, p_hash: hash(value), p_revision: randomUUID() })), 201);
      }
      const match = /^\/rooms\/([^/]+)(?:\/(operations|members|history)(?:\/([^/]+))?)?$/.exec(path);
      if (!match || !uuid(match[1])) throw new HttpError(404, 'not_found');
      const id = match[1];
      if (!match[2] && method === 'GET') return json(checked(await deps.rpc('margin_read', { p_actor: actor, p_id: id })));
      if (match[2] === 'members' && !match[3]) {
        if (!['GET','POST','DELETE'].includes(method)) throw new HttpError(405, 'method_not_allowed');
        const data = method === 'GET' ? {} : await body(request);
        if (method !== 'GET' && !uuid(data?.userId)) throw new HttpError(400, 'invalid_user_id');
        return json(checked(await deps.rpc('margin_membership', { p_actor: actor, p_id: id, p_action: method === 'GET' ? 'list' : method === 'POST' ? 'add' : 'remove', p_user: data.userId ?? null })));
      }
      if (match[2] === 'history' && method === 'GET') {
        if (match[3] && !/^\d{1,18}$/.test(match[3])) throw new HttpError(400, 'invalid_id');
        return json(checked(await deps.rpc('margin_history_read', { p_actor: actor, p_id: id, p_point: match[3] ?? null })));
      }
      if (match[2] !== 'operations' || match[3] || method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      const raw = await body(request);
      let operation;
      try { operation = validateOperation(raw); assertHostedOperation(operation); }
      catch (error) { throw new HttpError(422, 'invalid_operation', { message: (error as Error).message }); }
      const operationHash = hash(operation);
      for (let attempt = 0; attempt < 6; attempt++) {
        const head = checked(await deps.rpc('margin_read', { p_actor: actor, p_id: id, p_operation: operation.id, p_hash: operationHash }));
        if (head.receipt) return json(head);
        let next;
        try {
          const applied = applyOperation(head.project, operation);
          if (!applied.project) throw new Error('An edited record changed.');
          assertImmutableSources(head.project, applied.project); next = project(applied.project);
        } catch (error) {
          // Preserve the remote head for the existing review-and-copy UI.
          throw new HttpError(409, 'operation_conflict', { reason: (error as Error).message, room: head });
        }
        const committed = await deps.rpc('margin_commit', { p_actor: actor, p_id: id, p_expected: head.revision, p_operation: operation.id, p_hash: operationHash, p_project: next, p_revision: randomUUID(), p_label: operation.label });
        if (committed?.error === 'revision_changed') continue;
        return json(checked(committed));
      }
      throw new HttpError(503, 'busy_retry_saved_edit');
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.error, ...error.extra }, error.status);
      // Do not echo SDK/SQL errors, credentials, request bodies or transcripts.
      return json({ error: 'storage_unavailable' }, 503);
    }
  };
}
export { HOSTED_PROJECT_BYTES };
