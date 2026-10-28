// margin-room-server.mjs
//
// Bounded, LOCAL-ONLY collaboration server for the Margin quote board.
// Binds 127.0.0.1 only. Node built-ins only. No analytics, no CORS, no
// outbound requests, no accounts, no credentials, no deployment affordances.
//
// Persistence: one JSON document per room, {id, revision, project, updatedAt, history}.
// Writes are temp-file + rename (create uses temp-file + link, which fails if the
// room already exists). A failed write never advances the in-memory/live revision
// and never notifies SSE listeners.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { applyOperation, assertImmutableSources, canonical, validateOperation } from '../shared/operations.mjs';

const MAX_BODY_BYTES = 17_000_000; // UTF-8 bytes on the wire
const MAX_PROJECT_BYTES = 16_000_000; // canonical export per snapshot
const MAX_HISTORY_POINTS = 20;
const MAX_HISTORY_BYTES = 20_000_000;
const MAX_ROOMS = 100;
const HEARTBEAT_MS = 15000;
// Never evict receipts: an old retry must never become a new write. A full
// ledger refuses new operations; export the room and start a new one explicitly.
const MAX_RECEIPTS = 50_000;
const MAX_RECEIPT_BYTES = 12_000_000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const isPlainObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);

const isUuid = v => typeof v === 'string' && UUID_RE.test(v);

const isNonEmptyString = v => typeof v === 'string' && v.length > 0;

/** Strip the port (and IPv6 brackets) from a Host header value. */
function hostnameOf(hostHeader) {
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return null;
  if (hostHeader.length > 255) return null;
  let h = hostHeader.trim();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    if (end === -1) return null;
    return h.slice(1, end).toLowerCase();
  }
  const colon = h.indexOf(':');
  if (colon !== -1) h = h.slice(0, colon);
  return h.toLowerCase();
}

function isLoopbackAddress(addr) {
  if (typeof addr !== 'string') return false;
  const a = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  return a === '127.0.0.1' || a === '::1' || a.startsWith('127.');
}

function baseHeaders(extra) {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extra,
  };
}

function sendJson(res, status, payload) {
  if (res.writableEnded || res.headersSent) return;
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(
    status,
    baseHeaders({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(body.length),
    }),
  );
  res.end(body);
}

/** Errors are always short, generic codes: never project/source content. */
function sendError(res, status, code) {
  sendJson(res, status, { error: code });
}

/**
 * Read a request body with a hard byte cap. Always settles: on overflow the
 * request socket is destroyed and the promise resolves with an error result,
 * so no caller can hang waiting for a body that will never arrive.
 */
function readBody(req, limit) {
  return new Promise(resolve => {
    let total = 0;
    const chunks = [];
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
      req.off('close', onClose);
    };
    const finish = result => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onData = chunk => {
      total += chunk.length;
      if (total > limit) {
        finish({ ok: false, code: 'payload_too_large', status: 413 });
        try {
          req.destroy();
        } catch {
          /* ignore */
        }
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish({ ok: true, buf: Buffer.concat(chunks) });
    const onError = () => finish({ ok: false, code: 'bad_request', status: 400 });
    const onAborted = () => finish({ ok: false, code: 'bad_request', status: 400 });
    const onClose = () => finish({ ok: false, code: 'bad_request', status: 400 });

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
    req.on('close', onClose);
  });
}

export async function startRoomServer({ port = 0, dataDir, allowedOrigins, validateProject, exportProject } = {}) {
  if (!isNonEmptyString(dataDir)) throw new TypeError('dataDir is required');
  if (typeof validateProject !== 'function') throw new TypeError('validateProject is required');
  if (typeof exportProject !== 'function') throw new TypeError('exportProject is required');

  // Explicit allow-list only; no wildcards are honoured.
  const origins = new Set(allowedOrigins instanceof Set ? [...allowedOrigins] : Array.isArray(allowedOrigins) ? allowedOrigins : []);
  for (const o of origins) {
    if (typeof o !== 'string' || o === '*') {
      throw new TypeError('allowedOrigins must be explicit origin strings');
    }
  }

  const root = path.resolve(dataDir);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });

  /** @type {Map<string, {revision: string|null, queue: Promise<any>, clients: Set<{res: import('node:http').ServerResponse, timer: NodeJS.Timeout}>}>} */
  const rooms = new Map();
  const sockets = new Set();
  let createQueue = Promise.resolve();
  let closing = false;

  // ---------------------------------------------------------------- paths --

  function roomFile(id) {
    if (!isUuid(id)) throw new HttpError(404, 'not_found');
    const file = path.join(root, `${id}.json`);
    // Defence in depth: the UUID check already forbids separators.
    if (path.dirname(path.resolve(file)) !== root) {
      throw new HttpError(404, 'not_found');
    }
    return file;
  }

  function entryFor(id) {
    let entry = rooms.get(id);
    if (!entry) {
      entry = { revision: null, queue: Promise.resolve(), clients: new Set() };
      rooms.set(id, entry);
    }
    return entry;
  }

  /** Serialize all work for a room so revision checks and writes are atomic. */
  function enqueue(entry, fn) {
    const run = entry.queue.then(() => fn());
    entry.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  // ----------------------------------------------------------- validation --

  async function canonicalBytes(project) {
    let out;
    try {
      out = await exportProject(project);
    } catch {
      throw new HttpError(400, 'invalid_project');
    }
    const text = typeof out === 'string' ? out : JSON.stringify(out ?? null);
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > MAX_PROJECT_BYTES) throw new HttpError(413, 'project_too_large');
    return bytes;
  }

  async function acceptProject(raw, badStatus = 400) {
    let project;
    try {
      project = await validateProject(raw);
    } catch {
      throw new HttpError(badStatus, 'invalid_project');
    }
    if (!isPlainObject(project) || !isNonEmptyString(project.id)) {
      throw new HttpError(badStatus, 'invalid_project');
    }
    await canonicalBytes(project);
    return project;
  }

  /**
   * Validate a document loaded from disk. Any failure means the file is left
   * untouched and the request is answered 503 — we never silently repair.
   */
  async function validateDoc(id, raw) {
    const bad = () => new HttpError(503, 'room_unreadable');
    if (!isPlainObject(raw)) throw bad();
    if (raw.id !== id) throw bad();
    if (!isUuid(raw.revision)) throw bad();
    if (!isNonEmptyString(raw.updatedAt)) throw bad();
    if (!Array.isArray(raw.history)) throw bad();
    if (raw.history.length === 0 || raw.history.length > MAX_HISTORY_POINTS) throw bad();

    let project;
    try {
      project = await acceptProject(raw.project, 503);
    } catch {
      throw bad();
    }

    const history = [];
    for (const point of raw.history) {
      if (!isPlainObject(point)) throw bad();
      if (!isUuid(point.revision) || !isNonEmptyString(point.updatedAt)) throw bad();
      let p;
      try {
        p = await acceptProject(point.project, 503);
      } catch {
        throw bad();
      }
      if (p.id !== project.id) throw bad(); // source invariant
      history.push({ revision: point.revision, project: p, updatedAt: point.updatedAt });
    }
    // The newest history point must be the live state.
    const head = history[history.length - 1];
    if (head.revision !== raw.revision || head.updatedAt !== raw.updatedAt || JSON.stringify(head.project) !== JSON.stringify(project))
      throw bad();

    const receipts = raw.receipts ?? [];
    if (
      !Array.isArray(receipts) ||
      receipts.length > MAX_RECEIPTS ||
      new Set(receipts.map(r => r?.id)).size !== receipts.length ||
      receipts.some(r => !r || !isUuid(r.id) || !isUuid(r.revision) || !/^[a-f0-9]{64}$/.test(r.hash))
    )
      throw bad();
    if (raw.creationHash !== undefined && !/^[a-f0-9]{64}$/.test(raw.creationHash)) throw bad();

    return {
      id,
      revision: raw.revision,
      project,
      updatedAt: raw.updatedAt,
      history,
      receipts,
      ...(raw.creationHash ? { creationHash: raw.creationHash } : {}),
    };
  }

  async function readDoc(id) {
    const file = roomFile(id);
    let text;
    try {
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.size > MAX_BODY_BYTES + MAX_HISTORY_BYTES + MAX_RECEIPT_BYTES) throw new Error('invalid_room_file');
      text = await fs.readFile(file, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') throw new HttpError(404, 'not_found');
      throw new HttpError(503, 'room_unreadable');
    }
    if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES + MAX_HISTORY_BYTES + MAX_RECEIPT_BYTES) {
      throw new HttpError(503, 'room_unreadable');
    }
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(503, 'room_unreadable');
    }
    return validateDoc(id, raw);
  }

  // ---------------------------------------------------------------- writes --

  function trimHistory(history) {
    let points = history.slice(-MAX_HISTORY_POINTS);
    let bytes = Buffer.byteLength(JSON.stringify(points), 'utf8');
    while (points.length > 1 && bytes > MAX_HISTORY_BYTES) {
      points = points.slice(1);
      bytes = Buffer.byteLength(JSON.stringify(points), 'utf8');
    }
    return points;
  }

  async function writeDocAtomic(id, doc, { create }) {
    const file = roomFile(id);
    const tmp = path.join(root, `.${id}.${crypto.randomUUID()}.tmp`);
    const text = JSON.stringify(doc);
    let handle;
    try {
      handle = await fs.open(tmp, 'wx', 0o600);
      await handle.writeFile(text, 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      if (create) {
        // link() fails with EEXIST if the room already exists: atomic create.
        await fs.link(tmp, file);
        await fs.unlink(tmp).catch(() => {});
      } else {
        await fs.rename(tmp, file);
      }
    } catch (err) {
      if (handle) await handle.close().catch(() => {});
      await fs.unlink(tmp).catch(() => {});
      if (err && err.code === 'EEXIST') throw new HttpError(409, 'conflict');
      throw new HttpError(503, 'write_failed');
    }
  }

  async function countRooms() {
    let names;
    try {
      names = await fs.readdir(root);
    } catch {
      throw new HttpError(503, 'storage_unavailable');
    }
    let n = 0;
    for (const name of names) {
      if (name.endsWith('.json') && !name.startsWith('.')) n += 1;
    }
    return n;
  }

  const publicShape = doc => ({
    id: doc.id,
    revision: doc.revision,
    project: doc.project,
    updatedAt: doc.updatedAt,
  });

  // ------------------------------------------------------------------- SSE --

  function notify(entry, revision) {
    const frame = `data: ${JSON.stringify({ revision })}\n\n`;
    for (const client of entry.clients) {
      try {
        client.res.write(frame);
      } catch {
        /* a dead client must never break a commit */
      }
    }
  }

  function dropClient(entry, client) {
    if (!entry.clients.delete(client)) return;
    clearInterval(client.timer);
    try {
      client.res.end();
    } catch {
      /* ignore */
    }
  }

  async function handleEvents(req, res, id) {
    const doc = await readDoc(id); // 404 / 503 before we commit to streaming
    const entry = entryFor(id);
    entry.revision = doc.revision;

    res.writeHead(
      200,
      baseHeaders({
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      }),
    );
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    if (req.socket && typeof req.socket.setNoDelay === 'function') {
      req.socket.setNoDelay(true);
    }

    const client = { res, timer: null };
    client.timer = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        dropClient(entry, client);
      }
    }, HEARTBEAT_MS);
    // Keepalive must never hold the event loop or delay close().
    if (typeof client.timer.unref === 'function') client.timer.unref();

    entry.clients.add(client);
    res.write(`data: ${JSON.stringify({ revision: doc.revision })}\n\n`);

    const onDone = () => dropClient(entry, client);
    res.on('close', onDone);
    res.on('error', onDone);
    req.on('error', onDone);
  }

  // ---------------------------------------------------------------- routes --

  async function handleCreate(req, res, body) {
    if (!isPlainObject(body) || !('project' in body)) {
      throw new HttpError(400, 'invalid_body');
    }
    const project = await acceptProject(body.project);
    if (body.id !== undefined && !isUuid(body.id)) throw new HttpError(400, 'invalid_body');
    const creationHash = crypto.createHash('sha256').update(canonical(project)).digest('hex');

    const doc = await (createQueue = createQueue
      .then(
        async () => {
          if (body.id) {
            try {
              const existing = await readDoc(body.id);
              if (existing.creationHash !== creationHash) throw new HttpError(409, 'creation_id_reused');
              return existing;
            } catch (err) {
              if (!(err instanceof HttpError) || err.status !== 404) throw err;
            }
          }
          if ((await countRooms()) >= MAX_ROOMS) {
            throw new HttpError(429, 'room_limit_reached');
          }
          const now = new Date().toISOString();
          for (let attempt = 0; attempt < 5; attempt += 1) {
            const id = body.id ?? crypto.randomUUID();
            if (rooms.has(id)) continue;
            const revision = crypto.randomUUID();
            const next = {
              id,
              revision,
              project,
              updatedAt: now,
              history: [{ revision, project, updatedAt: now }],
              receipts: [],
              creationHash,
            };
            try {
              await writeDocAtomic(id, next, { create: true });
            } catch (err) {
              if (err instanceof HttpError && err.code === 'conflict') continue;
              throw err;
            }
            entryFor(id).revision = revision;
            return next;
          }
          throw new HttpError(503, 'write_failed');
        },
        // keep the chain alive after a rejection
      )
      .catch(err => {
        createQueue = Promise.resolve();
        throw err;
      }));

    sendJson(res, 201, publicShape(doc));
  }

  async function handleGet(res, id) {
    const doc = await readDoc(id);
    entryFor(id).revision = doc.revision;
    sendJson(res, 200, publicShape(doc));
  }

  async function handleHistory(res, id) {
    const doc = await readDoc(id);
    sendJson(res, 200, {
      points: doc.history.map(p => ({
        revision: p.revision,
        project: p.project,
        updatedAt: p.updatedAt,
      })),
    });
  }

  async function handlePut(res, id, body) {
    if (!isPlainObject(body)) throw new HttpError(400, 'invalid_body');
    const { expectedRevision } = body;
    if (!isUuid(expectedRevision)) throw new HttpError(400, 'invalid_body');
    if (!('project' in body)) throw new HttpError(400, 'invalid_body');

    const entry = entryFor(id);
    const result = await enqueue(entry, async () => {
      const current = await readDoc(id);
      if (current.revision !== expectedRevision) {
        return { conflict: true, revision: current.revision };
      }
      const project = await acceptProject(body.project);
      if (project.id !== current.project.id) {
        throw new HttpError(409, 'project_mismatch');
      }

      try {
        assertImmutableSources(current.project, project);
      } catch {
        throw new HttpError(400, 'source_changed');
      }
      const revision = crypto.randomUUID();
      const updatedAt = new Date().toISOString();
      const history = trimHistory([...current.history, { revision, project, updatedAt }]);
      const next = { ...current, id, revision, project, updatedAt, history };

      // Only after the bytes are durably in place do we advance live state.
      await writeDocAtomic(id, next, { create: false });
      entry.revision = revision;
      notify(entry, revision);
      return { doc: next };
    });

    if (result.conflict) {
      sendJson(res, 409, { error: 'conflict', revision: result.revision });
      return;
    }
    sendJson(res, 200, publicShape(result.doc));
  }

  async function handleOperation(res, id, body) {
    let operation;
    try {
      operation = validateOperation(body);
    } catch {
      throw new HttpError(400, 'invalid_operation');
    }
    const hash = crypto.createHash('sha256').update(canonical(operation)).digest('hex');
    const entry = entryFor(id);
    const result = await enqueue(entry, async () => {
      const current = await readDoc(id);
      const previousReceipt = current.receipts.find(r => r.id === operation.id);
      if (previousReceipt) {
        if (previousReceipt.hash !== hash) throw new HttpError(409, 'operation_id_reused');
        // Return today's head, never an old receipt snapshot which could undo
        // intervening work. The receipt proves exactly which edit committed.
        return { doc: current, receipt: previousReceipt, duplicate: true };
      }
      if (current.receipts.length >= MAX_RECEIPTS) throw new HttpError(507, 'operation_ledger_full');
      if (operation.projectId !== current.project.id) throw new HttpError(409, 'project_mismatch');
      const applied = applyOperation(current.project, operation);
      if (applied.conflicts.length) return { conflict: true, doc: current, reason: 'records_changed' };
      let project;
      try {
        assertImmutableSources(current.project, applied.project);
      } catch {
        throw new HttpError(400, 'source_changed');
      }
      try {
        project = await acceptProject(applied.project);
      } catch {
        return { conflict: true, doc: current, reason: 'references_changed' };
      }
      const revision = crypto.randomUUID(),
        updatedAt = new Date().toISOString();
      project.updatedAt = updatedAt;
      const receipt = { id: operation.id, hash, revision };
      const next = {
        ...current,
        revision,
        updatedAt,
        project,
        receipts: [...current.receipts, receipt],
        history: trimHistory([...current.history, { revision, project, updatedAt }]),
      };
      await writeDocAtomic(id, next, { create: false });
      entry.revision = revision;
      notify(entry, revision);
      return { doc: next, receipt, duplicate: false };
    });
    if (result.conflict)
      return sendJson(res, 409, {
        error: 'operation_conflict',
        reason: result.reason,
        operationId: operation.id,
        room: publicShape(result.doc),
      });
    sendJson(res, 200, { ...publicShape(result.doc), receipt: result.receipt, duplicate: result.duplicate });
  }

  // --------------------------------------------------------------- guards --

  function assertLoopback(req) {
    if (!isLoopbackAddress(req.socket && req.socket.remoteAddress)) {
      throw new HttpError(403, 'forbidden');
    }
    const host = hostnameOf(req.headers.host);
    if (!host || !LOOPBACK_HOSTNAMES.has(host)) {
      throw new HttpError(403, 'forbidden');
    }
  }

  /**
   * Origin policy. A supplied Origin must match the explicit allow-list
   * exactly (this blocks SSE and fetch from any external origin). Same-origin
   * browser GETs and EventSource connections send no Origin and cannot set
   * custom headers, so safe (non-mutating) methods are allowed without either;
   * the loopback bind + Host check is the boundary there, and GET never writes.
   * Every mutation requires JSON content-type plus X-Margin-Local: 1, which
   * only a same-origin/local caller can set — that is what gates no-Origin CLI
   * requests.
   */
  function assertOriginAndIntent(req, isMutation) {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin.length > 0) {
      if (!origins.has(origin)) throw new HttpError(403, 'forbidden');
    }
    if (isMutation) {
      if (req.headers['x-margin-local'] !== '1') {
        throw new HttpError(403, 'forbidden');
      }
      const ct = String(req.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase();
      if (ct !== 'application/json') {
        throw new HttpError(415, 'unsupported_media_type');
      }
    }
  }

  async function parseJsonBody(req) {
    const body = await readBody(req, MAX_BODY_BYTES);
    if (!body.ok) throw new HttpError(body.status, body.code);
    if (body.buf.length === 0) throw new HttpError(400, 'invalid_json');
    try {
      return JSON.parse(body.buf.toString('utf8'));
    } catch {
      throw new HttpError(400, 'invalid_json');
    }
  }

  // -------------------------------------------------------------- dispatch --

  async function route(req, res) {
    if (closing) throw new HttpError(503, 'shutting_down');
    assertLoopback(req);

    const method = req.method || 'GET';
    if (method === 'OPTIONS') {
      // No CORS preflight support, by design.
      res.writeHead(405, baseHeaders({ Allow: 'GET, POST, PUT' }));
      res.end();
      return;
    }

    let url;
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      throw new HttpError(400, 'bad_request');
    }
    const segments = url.pathname.split('/').filter(Boolean);
    const isMutation = method === 'POST' || method === 'PUT';
    assertOriginAndIntent(req, isMutation);

    if (segments[0] !== 'api') throw new HttpError(404, 'not_found');

    // GET /api/health
    if (segments.length === 2 && segments[1] === 'health') {
      if (method !== 'GET') throw new HttpError(405, 'method_not_allowed');
      sendJson(res, 200, { ok: true, scope: 'loopback' });
      return;
    }

    if (segments[1] !== 'rooms') throw new HttpError(404, 'not_found');

    // POST /api/rooms
    if (segments.length === 2) {
      if (method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      await handleCreate(req, res, await parseJsonBody(req));
      return;
    }

    const id = segments[2];
    if (!isUuid(id)) throw new HttpError(404, 'not_found');

    // /api/rooms/:id
    if (segments.length === 3) {
      if (method === 'GET') return handleGet(res, id);
      if (method === 'PUT') return handlePut(res, id, await parseJsonBody(req));
      throw new HttpError(405, 'method_not_allowed');
    }

    // /api/rooms/:id/{events,history}
    if (segments.length === 4) {
      if (segments[3] === 'operations' && method === 'POST') return handleOperation(res, id, await parseJsonBody(req));
      if (method !== 'GET') throw new HttpError(405, 'method_not_allowed');
      if (segments[3] === 'events') return handleEvents(req, res, id);
      if (segments[3] === 'history') return handleHistory(res, id);
    }

    throw new HttpError(404, 'not_found');
  }

  const server = http.createServer((req, res) => {
    req.on('error', () => {
      /* client aborts must not crash the process */
    });
    res.on('error', () => {});
    Promise.resolve()
      .then(() => route(req, res))
      .catch(err => {
        const status = err instanceof HttpError ? err.status : 500;
        const code = err instanceof HttpError ? err.code : 'internal_error';
        try {
          if (!res.headersSent) sendError(res, status, code);
          else res.end();
        } catch {
          /* ignore */
        }
      });
  });

  server.on('clientError', (_err, socket) => {
    try {
      if (socket.writable) {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      }
      socket.destroy();
    } catch {
      /* ignore */
    }
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('error', () => {
    /* surfaced via listen() rejection below; never crash afterwards */
  });

  await new Promise((resolve, reject) => {
    const onError = err => reject(err);
    server.once('error', onError);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.off('error', onError);
      resolve();
    });
  });

  async function close() {
    if (closing) return;
    closing = true;

    for (const entry of rooms.values()) {
      for (const client of [...entry.clients]) dropClient(entry, client);
      entry.clients.clear();
    }

    const closed = new Promise(resolve => server.close(() => resolve()));
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }
    // Do not wait on keep-alive sockets: tear them down immediately.
    for (const socket of [...sockets]) {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
    sockets.clear();
    await closed;
    rooms.clear();
  }

  return { server, close };
}

export default startRoomServer;
