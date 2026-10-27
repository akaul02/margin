import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AddressInfo } from 'node:net';
import { startRoomServer } from '../server/room-server.mjs';
import { diffProject, inverseOperation } from '../shared/operations.mjs';
import type { Operation } from '../shared/operations.mjs';
import { exportProject, makeTranscript, newProject, removeQuote, saveQuoteCard, validateProject } from '../src/model';
import type { BoardComment, Project } from '../src/model';

type Room = { id: string; revision: string; project: Project; updatedAt: string };
const AT = '2026-10-04T12:00:00.000Z';
const headers = { 'content-type': 'application/json', 'X-Margin-Local': '1' };
let service: Awaited<ReturnType<typeof startRoomServer>>;
let dir: string;
let base: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'margin-operations-synthetic-'));
  await start();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await service?.close();
  await fs.rm(dir, { recursive: true, force: true });
});

async function start() {
  service = await startRoomServer({ dataDir: dir, allowedOrigins: ['http://127.0.0.1:4178'], validateProject, exportProject });
  base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
}

function fixture(withNote = false): Project {
  const project = newProject('Synthetic operation server practice', true);
  const source = makeTranscript('Synthetic source', 'Interviewer: What helped?\r\nParticipant: A green 🌱 sign helped.\r\nIt pointed toward the library.');
  source.turns[0].role = 'interviewer';
  source.turns[1].role = 'participant';
  project.transcripts.push(source);
  const turn = source.turns[1];
  saveQuoteCard(project, source.id, turn.id, turn.start, turn.end, source.text.slice(turn.start, turn.end));
  if (withNote) project.comments.push(note(project, 'existing-note', 'Original manually written note.'));
  return validateProject(project);
}

function note(project: Project, id: string, body: string): BoardComment {
  return { id, quoteId: project.quotes[0].id, by: 'Synthetic reviewer', body, author: 'user', createdAt: AT, updatedAt: AT };
}

function operation(before: Project, edit: (after: Project) => void): Operation {
  const after = structuredClone(before);
  edit(after);
  return { id: crypto.randomUUID(), projectId: before.id, at: AT, label: 'Synthetic manual edit', changes: diffProject(before, after) };
}

async function request(url: string, method: string, body: unknown) {
  const response = await fetch(`${base}${url}`, { method, headers, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}

async function create(project = fixture(), id?: string): Promise<Room> {
  const result = await request('/api/rooms', 'POST', { project, ...(id ? { id } : {}) });
  expect(result.status).toBe(201);
  return result.body;
}

async function post(room: Room, op: unknown) {
  return request(`/api/rooms/${room.id}/operations`, 'POST', op);
}

async function head(room: Room): Promise<Room> {
  const response = await fetch(`${base}/api/rooms/${room.id}`);
  expect(response.status).toBe(200);
  return response.json();
}

async function disk(room: Room) {
  return fs.readFile(path.join(dir, `${room.id}.json`), 'utf8');
}

it('commits concurrent disjoint notes exactly once without losing either note', async () => {
  const room = await create();
  const ops = [
    operation(room.project, p => p.comments.push(note(p, 'note-a', 'First independent note.'))),
    operation(room.project, p => p.comments.push(note(p, 'note-b', 'Second independent note.'))),
  ];
  const results = await Promise.all(ops.map(op => post(room, op)));
  expect(results.map(r => r.status)).toEqual([200, 200]);
  expect(results.every(r => r.body.duplicate === false)).toBe(true);
  const current = await head(room);
  expect(current.project.comments.map(c => c.id).sort()).toEqual(['note-a', 'note-b']);
  expect(current.project.quotes).toEqual(room.project.quotes);
  expect(current.project.transcripts).toEqual(room.project.transcripts);
  const stored = JSON.parse(await disk(room));
  expect(stored.receipts.map((r: { id: string }) => r.id).sort()).toEqual(ops.map(op => op.id).sort());
  expect(stored.history).toHaveLength(3);
});

it('returns the winning head to a same-note race loser and never partially commits its other records', async () => {
  const room = await create(fixture(true));
  const ops = ['First competing edit.', 'Second competing edit.'].map((body, index) => operation(room.project, p => {
    p.comments[0].body = body;
    p.name = `Synthetic name from writer ${index}`;
  }));
  const results = await Promise.all(ops.map(op => post(room, op)));
  expect(results.map(r => r.status).sort()).toEqual([200, 409]);
  const winner = results.findIndex(r => r.status === 200);
  const loser = results[1 - winner];
  const current = await head(room);
  expect(loser.body).toMatchObject({ error: 'operation_conflict', reason: 'records_changed', operationId: ops[1 - winner].id, room: current });
  expect(current.project.name).toBe(`Synthetic name from writer ${winner}`);
  expect(current.project.comments[0].body).toBe(ops[winner].changes.find(c => c.collection === 'comments')!.after.body);
  const stored = JSON.parse(await disk(room));
  expect(stored.receipts).toHaveLength(1);
  expect(stored.history).toHaveLength(2);
});

it.each(['delete-first', 'edit-first'] as const)('preserves the winner of note deletion versus edit: %s', async order => {
  const room = await create(fixture(true));
  const deletion = operation(room.project, p => { p.comments = []; });
  const edit = operation(room.project, p => { p.comments[0].body = 'A later human-authored edit.'; });
  const [first, second] = order === 'delete-first' ? [deletion, edit] : [edit, deletion];
  expect((await post(room, first)).status).toBe(200);
  const before = await disk(room);
  const rejected = await post(room, second);
  expect(rejected.status).toBe(409);
  expect(rejected.body).toMatchObject({ error: 'operation_conflict', reason: 'records_changed' });
  expect(await disk(room)).toBe(before);
  const current = await head(room);
  expect(rejected.body.room).toEqual(current);
  expect(current.project.comments).toHaveLength(order === 'delete-first' ? 0 : 1);
  if (order === 'edit-first') expect(current.project.comments[0].body).toBe('A later human-authored edit.');
});

it.each(['delete-first', 'note-first'] as const)('atomically rejects a dangling graph in quote deletion versus new note: %s', async order => {
  const room = await create();
  const deletion = operation(room.project, p => removeQuote(p, p.quotes[0].id));
  const add = operation(room.project, p => p.comments.push(note(p, 'new-note', 'A manually added note.')));
  const [first, second] = order === 'delete-first' ? [deletion, add] : [add, deletion];
  expect((await post(room, first)).status).toBe(200);
  const before = await disk(room);
  const rejected = await post(room, second);
  expect(rejected.status).toBe(409);
  expect(rejected.body).toMatchObject({ error: 'operation_conflict', reason: 'references_changed' });
  expect(await disk(room)).toBe(before);
  const current = await head(room);
  expect(rejected.body.room).toEqual(current);
  expect(() => validateProject(current.project)).not.toThrow();
  expect(current.project.quotes).toHaveLength(order === 'delete-first' ? 0 : 1);
  expect(current.project.comments).toHaveLength(order === 'delete-first' ? 0 : 1);
});

it('returns the current head for a lost-response retry after later work and server restart', async () => {
  const room = await create();
  const original = operation(room.project, p => p.comments.push(note(p, 'lost-ack-note', 'Committed before the lost response.')));
  // Consume but deliberately discard the successful response, as if its acknowledgment was lost.
  const lost = await fetch(`${base}/api/rooms/${room.id}/operations`, { method: 'POST', headers, body: JSON.stringify(original) });
  expect(lost.status).toBe(200);
  await lost.arrayBuffer();
  const afterOriginal = await head(room);
  const later = operation(afterOriginal.project, p => p.comments.push(note(p, 'later-note', 'Must survive the older retry.')));
  expect((await post(room, later)).status).toBe(200);
  const latest = await head(room);
  const bytesBeforeRetry = await disk(room);
  await service.close();
  await start();
  const retried = await post(room, original);
  expect(retried.status).toBe(200);
  expect(retried.body).toMatchObject({ ...latest, duplicate: true, receipt: { id: original.id, revision: afterOriginal.revision } });
  expect(retried.body.receipt.revision).not.toBe(latest.revision);
  expect(retried.body.receipt.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(retried.body.project.comments.map((c: BoardComment) => c.id).sort()).toEqual(['later-note', 'lost-ack-note']);
  expect(await disk(room)).toBe(bytesBeforeRetry);
  expect(JSON.parse(await disk(room)).receipts).toHaveLength(2);
});

it('deduplicates simultaneous retries using the same operation ID', async () => {
  const room = await create();
  const op = operation(room.project, p => p.comments.push(note(p, 'single-note', 'Only one copy.')));
  const results = await Promise.all([post(room, op), post(room, op)]);
  expect(results.map(r => r.status)).toEqual([200, 200]);
  expect(results.map(r => r.body.duplicate).sort()).toEqual([false, true]);
  expect(results[0].body.receipt).toEqual(results[1].body.receipt);
  const stored = JSON.parse(await disk(room));
  expect(stored.receipts).toHaveLength(1);
  expect(stored.history).toHaveLength(2);
  expect(stored.project.comments).toHaveLength(1);
});

it('rejects a reused operation ID with different content without changing the ledger or head', async () => {
  const room = await create();
  const op = operation(room.project, p => p.comments.push(note(p, 'note-a', 'Original operation payload.')));
  expect((await post(room, op)).status).toBe(200);
  const before = await disk(room);
  const reused = structuredClone(op);
  reused.changes[0].after.body = 'A different payload under the same ID.';
  const result = await post(room, reused);
  expect(result.status).toBe(409);
  expect(result.body.error).toBe('operation_id_reused');
  expect(await disk(room)).toBe(before);
  expect((await post(room, op)).body.duplicate).toBe(true);
});

it('leaves both receipt and state unchanged on rename failure, then accepts the original retry', async () => {
  const room = await create();
  const op = operation(room.project, p => p.comments.push(note(p, 'retry-note', 'Persist only when the atomic write succeeds.')));
  const before = await disk(room);
  vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('Synthetic ENOSPC during atomic rename'));
  expect((await post(room, op)).status).toBe(503);
  expect(await disk(room)).toBe(before);
  expect(await head(room)).toEqual(room);
  const retried = await post(room, op);
  expect(retried.status).toBe(200);
  expect(retried.body.duplicate).toBe(false);
  const stored = JSON.parse(await disk(room));
  expect(stored.receipts).toHaveLength(1);
  expect(stored.receipts[0].id).toBe(op.id);
  expect(stored.history).toHaveLength(2);
  expect(stored.project.comments).toHaveLength(1);
});

const malformed: [string, (op: Operation) => void][] = [
  ['non-UUID operation ID', op => { op.id = '-'.repeat(36); }],
  ['duplicate changes', op => { op.changes.push(structuredClone(op.changes[0])); }],
  ['mismatched record ID', op => { op.changes[0].after.id = 'different-note'; }],
  ['unknown collection', op => { (op.changes[0] as { collection: string }).collection = 'unknown'; }],
];
it.each(malformed)('rejects %s before touching persisted state', async (_name, corrupt) => {
  const room = await create();
  const op = operation(room.project, p => p.comments.push(note(p, 'new-note', 'This malformed operation must not persist.')));
  corrupt(op);
  const before = await disk(room);
  const result = await post(room, op);
  expect(result.status).toBe(400);
  expect(result.body.error).toBe('invalid_operation');
  expect(await disk(room)).toBe(before);
  expect(await head(room)).toEqual(room);
});

it('rejects changing source text even when the replacement quote and offsets form a valid new graph', async () => {
  const room = await create();
  const op = operation(room.project, p => {
    p.transcripts[0].text = p.transcripts[0].text.replace('green', 'amber');
    p.quotes[0].text = p.quotes[0].text.replace('green', 'amber');
  });
  const before = await disk(room);
  const result = await post(room, op);
  expect(result.status).toBe(400);
  expect(result.body.error).toBe('source_changed');
  expect(await disk(room)).toBe(before);
});

it('rejects turning interviewer context into participant evidence', async () => {
  const room = await create();
  const op = operation(room.project, p => {
    const transcript = p.transcripts[0], turn = transcript.turns[0];
    p.quotes.push({ id: 'interviewer-quote', transcriptId: transcript.id, turnId: turn.id, start: turn.start, end: turn.end, text: transcript.text.slice(turn.start, turn.end), codeIds: [], createdAt: AT });
  });
  const before = await disk(room);
  const result = await post(room, op);
  expect(result.status).toBe(409);
  expect(result.body).toMatchObject({ error: 'operation_conflict', reason: 'references_changed' });
  expect(await disk(room)).toBe(before);
});

it('rejects a non-user-authored note at the graph-validation boundary', async () => {
  const room = await create();
  const op = operation(room.project, p => p.comments.push(note(p, 'new-note', 'Synthetic invalid authorship.')));
  op.changes[0].after.author = 'model';
  const before = await disk(room);
  const result = await post(room, op);
  expect(result.status).toBe(409);
  expect(result.body.reason).toBe('references_changed');
  expect(await disk(room)).toBe(before);
});

it('scoped inverse undo preserves a later independent note', async () => {
  const room = await create(fixture(true));
  const local = operation(room.project, p => { p.comments[0].body = 'My local edit.'; });
  const remote = operation(room.project, p => p.comments.push(note(p, 'remote-note', 'Another person\'s later note.')));
  expect((await post(room, local)).status).toBe(200);
  expect((await post(room, remote)).status).toBe(200);
  const undo = inverseOperation(local, crypto.randomUUID(), '2026-10-04T12:02:00.000Z');
  expect((await post(room, undo)).status).toBe(200);
  const current = await head(room);
  expect(current.project.comments.find(c => c.id === 'existing-note')).toEqual(room.project.comments[0]);
  expect(current.project.comments.find(c => c.id === 'remote-note')?.body).toBe('Another person\'s later note.');
  expect(current.project.quotes).toEqual(room.project.quotes);
  expect(JSON.parse(await disk(room)).receipts).toHaveLength(3);
});

it('scoped inverse undo conflicts with a later edit of the same note', async () => {
  const room = await create(fixture(true));
  const local = operation(room.project, p => { p.comments[0].body = 'My local edit.'; });
  const first = await post(room, local);
  expect(first.status).toBe(200);
  const remote = operation(first.body.project, p => { p.comments[0].body = 'Another person\'s later edit.'; });
  expect((await post(room, remote)).status).toBe(200);
  const before = await disk(room);
  const undo = inverseOperation(local, crypto.randomUUID(), '2026-10-04T12:02:00.000Z');
  const rejected = await post(room, undo);
  expect(rejected.status).toBe(409);
  expect(rejected.body.reason).toBe('records_changed');
  expect(rejected.body.room.project.comments[0].body).toBe('Another person\'s later edit.');
  expect(await disk(room)).toBe(before);
});

it('retries stable-ID room creation after restart without replacing later edits', async () => {
  const project = fixture();
  const stableId = crypto.randomUUID();
  const room = await create(project, stableId);
  const op = operation(room.project, p => p.comments.push(note(p, 'later-note', 'Work after initial creation.')));
  expect((await post(room, op)).status).toBe(200);
  const current = await head(room);
  const before = await disk(room);
  await service.close();
  await start();
  const retried = await create(project, stableId);
  expect(retried).toEqual(current);
  expect(await disk(room)).toBe(before);
  const differentProject = structuredClone(project);
  differentProject.name = 'Different initial payload';
  const rejected = await request('/api/rooms', 'POST', { id: stableId, project: differentProject });
  expect(rejected.status).toBe(409);
  expect(rejected.body.error).toBe('creation_id_reused');
  expect(await disk(room)).toBe(before);
});

it('never evicts old receipts at the ledger cap and still answers retries after restart', async () => {
  const room = await create();
  const original = operation(room.project, p => p.comments.push(note(p, 'original-note', 'The oldest receipt must remain valid.')));
  const first = await post(room, original);
  expect(first.status).toBe(200);
  const stored = JSON.parse(await disk(room));
  // Only this test's synthetic temporary file is seeded to avoid 50,000 HTTP writes.
  while (stored.receipts.length < 49_999) {
    stored.receipts.push({ id: crypto.randomUUID(), hash: 'a'.repeat(64), revision: crypto.randomUUID() });
  }
  await fs.writeFile(path.join(dir, `${room.id}.json`), JSON.stringify(stored));
  const finalAllowed = operation(first.body.project, p => { p.name = 'Synthetic final allowed operation'; });
  expect((await post(room, finalAllowed)).status).toBe(200);
  const current = await head(room);
  const bytesAtCap = await disk(room);
  const full = JSON.parse(bytesAtCap);
  expect(full.receipts).toHaveLength(50_000);
  expect(full.receipts[0]).toEqual(first.body.receipt);
  const overCap = operation(current.project, p => { p.name = 'Must not evict a receipt'; });
  const rejected = await post(room, overCap);
  expect(rejected.status).toBe(507);
  expect(rejected.body.error).toBe('operation_ledger_full');
  expect(await disk(room)).toBe(bytesAtCap);
  await service.close();
  await start();
  const retried = await post(room, original);
  expect(retried.status).toBe(200);
  expect(retried.body).toMatchObject({ ...current, duplicate: true, receipt: first.body.receipt });
  expect(await disk(room)).toBe(bytesAtCap);
});
