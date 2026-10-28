import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeTranscript, newProject, type Project } from '../src/model';
import { ACTOR_A, ACTOR_B, ACTOR_C, testDatabase } from './support/pglite';

// These tests exercise real PostgreSQL statements, roles and transaction rollback.
// PGlite has one connection; inter-session lock scheduling requires hosted testing.
let database: Awaited<ReturnType<typeof testDatabase>>;
const HASH_A = 'a'.repeat(64),
  HASH_B = 'b'.repeat(64);
type Role = 'anon' | 'authenticated' | 'service_role';
type Room = { id: string; revision: string; project: Project; role: string };

async function asRole<T>(role: Role, work: () => Promise<T>, actor = ''): Promise<T> {
  await database.db.query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
  await database.db.exec(`set role ${role}`);
  try {
    return await work();
  } finally {
    await database.db.exec('reset role');
  }
}
async function rpc(name: string, args: Record<string, unknown>) {
  return asRole('service_role', () => database.rpc(name, args));
}
async function create(project = newProject('Synthetic SQL room', true), actor = ACTOR_A, id = randomUUID()): Promise<Room> {
  const room = await rpc('margin_create', { p_actor: actor, p_id: id, p_project: project, p_hash: HASH_A, p_revision: randomUUID() });
  expect(room.error).toBeUndefined();
  return room;
}
function commitArguments(room: Room, overrides: Record<string, unknown> = {}) {
  return {
    p_actor: ACTOR_A,
    p_id: room.id,
    p_expected: room.revision,
    p_operation: randomUUID(),
    p_hash: HASH_A,
    p_project: { ...room.project, name: 'Synthetic edited title' },
    p_revision: randomUUID(),
    p_label: 'Synthetic title edit',
    ...overrides,
  };
}
async function state(id: string) {
  const { rows } = await database.db.query<{
    project: Project;
    revision: string;
    updated_at: string;
    history: number;
    receipts: number;
    members: number;
  }>(
    `
    select project, revision::text, updated_at::text,
      (select count(*)::int from public.margin_history where room_id = $1::uuid) as history,
      (select count(*)::int from public.margin_receipts where room_id = $1::uuid) as receipts,
      (select count(*)::int from public.margin_members where room_id = $1::uuid) as members
    from public.margin_rooms where id = $1::uuid`,
    [id],
  );
  return rows[0];
}
async function membership(id: string, action: string | null, user?: string | null, actor = ACTOR_A) {
  return rpc('margin_membership', { p_actor: actor, p_id: id, p_action: action, ...(user === undefined ? {} : { p_user: user }) });
}

beforeAll(async () => {
  database = await testDatabase();
}, 30_000);
beforeEach(async () => {
  await database.db.exec('reset role; truncate public.margin_rooms restart identity cascade');
  await database.db.query('delete from auth.users where id <> all($1::uuid[])', [[ACTOR_A, ACTOR_B, ACTOR_C]]);
});
afterAll(async () => {
  await database?.db.close();
});

describe('hosted SQL authorization and transactional integrity', () => {
  it('revokes inherited browser grants, including history sequence access and PUBLIC RPC execution', async () => {
    const functions = await database.db.query<{
      name: string;
      definer: boolean;
      config: string[];
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(`select p.proname as name, p.prosecdef as definer, p.proconfig as config,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
      has_function_privilege('service_role', p.oid, 'EXECUTE') as service
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like 'margin_%' order by p.proname`);
    expect(functions.rows.map(f => f.name)).toEqual([
      'margin_commit',
      'margin_create',
      'margin_history_read',
      'margin_list',
      'margin_membership',
      'margin_read',
    ]);
    for (const f of functions.rows) {
      expect(f, f.name).toMatchObject({ definer: true, anon: false, authenticated: false, service: true });
      expect(f.config).toContain('search_path=""');
    }
    const tables = await database.db.query<{ name: string; rls: boolean; anon: boolean; read: boolean; write: boolean }>(`
      select c.relname as name, c.relrowsecurity as rls,
        has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon,
        has_table_privilege('authenticated', c.oid, 'SELECT') as read,
        has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as write
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'margin_%' order by c.relname`);
    expect(tables.rows).toHaveLength(4);
    for (const table of tables.rows) {
      expect(table, table.name).toMatchObject({ rls: true, anon: false, write: false });
      expect(table.read).toBe(['margin_rooms', 'margin_members'].includes(table.name));
    }
    for (const role of ['anon', 'authenticated']) {
      const { rows } = await database.db.query<{ allowed: boolean }>(
        "select has_sequence_privilege($1, 'public.margin_history_id_seq', 'USAGE,SELECT,UPDATE') as allowed",
        [role],
      );
      expect(rows[0].allowed, role).toBe(false);
    }
    await expect(asRole('authenticated', () => database.rpc('margin_list', { p_actor: ACTOR_A }), ACTOR_A)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asRole('anon', () => database.db.query('select * from public.margin_rooms'))).rejects.toThrow(/permission denied/i);
  });

  it('allows direct authenticated reads only for the signed-in member and never allows direct writes', async () => {
    const room = await create();
    await membership(room.id, 'add', ACTOR_B);
    for (const [actor, expected] of [
      [ACTOR_A, 1],
      [ACTOR_B, 1],
      [ACTOR_C, 0],
      ['', 0],
    ] as const) {
      const rows = await asRole(
        'authenticated',
        async () => ({
          rooms: (await database.db.query<{ id: string }>('select id::text from public.margin_rooms')).rows,
          members: (await database.db.query<{ user_id: string }>('select user_id::text from public.margin_members')).rows,
        }),
        actor,
      );
      expect(rows.rooms).toHaveLength(expected);
      expect(rows.members).toHaveLength(expected);
      if (expected) expect(rows.members[0].user_id).toBe(actor);
    }
    await expect(
      asRole(
        'authenticated',
        () => database.db.query('update public.margin_rooms set revision = $1::uuid where id = $2::uuid', [randomUUID(), room.id]),
        ACTOR_A,
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(asRole('authenticated', () => database.db.query('select * from public.margin_receipts'), ACTOR_A)).rejects.toThrow(
      /permission denied/i,
    );
    await expect(
      asRole('authenticated', () => database.db.query("select nextval('public.margin_history_id_seq')"), ACTOR_A),
    ).rejects.toThrow(/permission denied/i);
    expect((await state(room.id)).revision).toBe(room.revision);
  });

  it('rejects null required arguments before accepting or changing any room', async () => {
    const project = newProject('Synthetic null guards', true),
      id = randomUUID();
    const createArgs = { p_actor: ACTOR_A, p_id: id, p_project: project, p_hash: HASH_A, p_revision: randomUUID() };
    for (const key of ['p_actor', 'p_id', 'p_hash', 'p_revision']) {
      expect(await rpc('margin_create', { ...createArgs, [key]: null }), key).toEqual({ error: 'invalid_argument' });
    }
    // Pass SQL NULL directly: the reusable RPC adapter encodes JSON null as jsonb null.
    const emptyCreate = await asRole('service_role', () =>
      database.db.query<{ result: unknown }>('select public.margin_create($1::uuid,$2::uuid,null::jsonb,$3::text,$4::uuid) as result', [
        ACTOR_A,
        id,
        HASH_A,
        randomUUID(),
      ]),
    );
    expect(emptyCreate.rows[0].result).toEqual({ error: 'invalid_argument' });
    expect((await database.db.query<{ n: number }>('select count(*)::int as n from public.margin_rooms')).rows[0].n).toBe(0);

    const room = await create(project),
      before = await state(room.id),
      args = commitArguments(room);
    for (const key of ['p_actor', 'p_id', 'p_expected', 'p_operation', 'p_hash', 'p_revision', 'p_label']) {
      expect(await rpc('margin_commit', { ...args, [key]: null }), key).toEqual({ error: 'invalid_argument' });
    }
    const emptyCommit = await asRole('service_role', () =>
      database.db.query<{ result: unknown }>(
        'select public.margin_commit($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,null::jsonb,$6::uuid,$7::text) as result',
        [ACTOR_A, room.id, room.revision, args.p_operation, HASH_A, args.p_revision, args.p_label],
      ),
    );
    expect(emptyCommit.rows[0].result).toEqual({ error: 'invalid_argument' });
    for (const p_hash of ['', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
      expect(await rpc('margin_commit', { ...args, p_hash })).toEqual({ error: 'invalid_argument' });
    }
    expect(await membership(room.id, null)).toEqual({ error: 'invalid_argument' });
    expect(await membership(room.id, 'add', null)).toEqual({ error: 'invalid_argument' });
    expect(await membership(room.id, 'remove', null)).toEqual({ error: 'invalid_argument' });
    expect(await state(room.id)).toEqual(before);
  });

  it('keeps stable create retries bound to the original owner and hash without reverting later edits', async () => {
    const room = await create(),
      edited = await rpc('margin_commit', commitArguments(room));
    const args = { p_actor: ACTOR_A, p_id: room.id, p_project: room.project, p_hash: HASH_A, p_revision: randomUUID() };
    const retry = await rpc('margin_create', args);
    expect(retry.project).toEqual(edited.project);
    expect(retry.revision).toBe(edited.revision);
    expect(await rpc('margin_create', { ...args, p_hash: HASH_B })).toEqual({ error: 'id_reused' });
    await membership(room.id, 'add', ACTOR_B);
    expect(await rpc('margin_create', { ...args, p_actor: ACTOR_B })).toEqual({ error: 'forbidden' });
    expect(await rpc('margin_create', { ...args, p_actor: ACTOR_C })).toEqual({ error: 'forbidden' });
    expect((await state(room.id)).revision).toBe(edited.revision);
  });

  it('allows only owners to manage existing users and preserves the owner membership', async () => {
    const room = await create();
    expect(await membership(room.id, 'add', ACTOR_C, ACTOR_C)).toEqual({ error: 'forbidden' });
    expect(await membership(room.id, 'add', randomUUID())).toEqual({ error: 'member_unavailable' });
    expect(await membership(room.id, 'other', ACTOR_B)).toEqual({ error: 'invalid_action' });
    await membership(room.id, 'add', ACTOR_B);
    for (const action of ['list', 'add', 'remove']) {
      expect(await membership(room.id, action, ACTOR_C, ACTOR_B)).toEqual({ error: 'forbidden' });
    }
    expect(await membership(room.id, 'remove', ACTOR_A)).toEqual({ error: 'owner_required' });
    const members = await membership(room.id, 'add', ACTOR_A);
    expect(members.members).toEqual(
      expect.arrayContaining([
        { userId: ACTOR_A, role: 'owner' },
        { userId: ACTOR_B, role: 'editor' },
      ]),
    );
    expect(members.members).toHaveLength(2);
    expect((await membership(room.id, 'add', ACTOR_B)).members).toHaveLength(2);
  });

  it('checks current membership before exposing head, history or a previously valid receipt', async () => {
    const room = await create();
    await membership(room.id, 'add', ACTOR_B);
    const args = commitArguments(room, { p_actor: ACTOR_B });
    const committed = await rpc('margin_commit', args);
    expect(committed.receipt.id).toBe(args.p_operation);
    const history = await rpc('margin_history_read', { p_actor: ACTOR_B, p_id: room.id });
    const point = history.points[0].id;
    await membership(room.id, 'remove', ACTOR_B);
    const before = await state(room.id);
    expect(await rpc('margin_read', { p_actor: ACTOR_B, p_id: room.id, p_operation: args.p_operation, p_hash: HASH_A })).toEqual({
      error: 'forbidden',
    });
    expect(await rpc('margin_commit', args)).toEqual({ error: 'forbidden' });
    expect(await rpc('margin_history_read', { p_actor: ACTOR_B, p_id: room.id })).toEqual({ error: 'forbidden' });
    expect(await rpc('margin_history_read', { p_actor: ACTOR_B, p_id: room.id, p_point: point })).toEqual({ error: 'forbidden' });
    expect(await rpc('margin_list', { p_actor: ACTOR_B })).toEqual({ rooms: [] });
    const visible = await asRole('authenticated', () => database.db.query('select id from public.margin_rooms'), ACTOR_B);
    expect(visible.rows).toEqual([]);
    expect(await state(room.id)).toEqual(before);
  });

  it('rejects stale compare-and-swap and project identity changes without creating history or receipts', async () => {
    const room = await create(),
      before = await state(room.id);
    expect(await rpc('margin_commit', commitArguments(room, { p_expected: randomUUID() }))).toEqual({ error: 'revision_changed' });
    expect(await rpc('margin_commit', commitArguments(room, { p_project: { ...room.project, id: randomUUID() } }))).toEqual({
      error: 'invalid_project',
    });
    expect(await state(room.id)).toEqual(before);
  });

  it('rolls back an already-inserted history point if the subsequent room update violates its size constraint', async () => {
    const room = await create(),
      before = await state(room.id);
    const oversized = { ...room.project, syntheticOversizeFixture: 'x'.repeat(1_800_000) };
    await expect(rpc('margin_commit', commitArguments(room, { p_project: oversized }))).rejects.toThrow(/check constraint/i);
    expect(await state(room.id)).toEqual(before);
    const accepted = await rpc('margin_commit', commitArguments(room));
    expect(accepted.error).toBeUndefined();
    expect(await state(room.id)).toMatchObject({ history: 1, receipts: 1 });
  });

  it('binds receipts to their actor and payload while returning the current head on delayed retries', async () => {
    const room = await create();
    await membership(room.id, 'add', ACTOR_B);
    const firstArgs = commitArguments(room),
      first = await rpc('margin_commit', firstArgs);
    const second = await rpc('margin_commit', commitArguments(first, { p_project: { ...first.project, name: 'Synthetic newer head' } }));
    const before = await state(room.id);
    const expectedReceipt = { id: firstArgs.p_operation, revision: first.revision };
    const retry = await rpc('margin_commit', firstArgs);
    expect(retry).toMatchObject({ revision: second.revision, project: second.project, receipt: expectedReceipt });
    const preparation = await rpc('margin_read', { p_actor: ACTOR_A, p_id: room.id, p_operation: firstArgs.p_operation, p_hash: HASH_A });
    expect(preparation).toMatchObject({ revision: second.revision, receipt: expectedReceipt });
    for (const overrides of [{ p_hash: HASH_B }, { p_actor: ACTOR_B }]) {
      expect(await rpc('margin_commit', { ...firstArgs, ...overrides })).toEqual({ error: 'id_reused' });
      expect(
        await rpc('margin_read', { p_actor: ACTOR_A, p_id: room.id, p_operation: firstArgs.p_operation, p_hash: HASH_A, ...overrides }),
      ).toEqual({ error: 'id_reused' });
    }
    expect(await rpc('margin_read', { p_actor: ACTOR_A, p_id: room.id, p_operation: firstArgs.p_operation, p_hash: null })).toEqual({
      error: 'id_reused',
    });
    expect(await state(room.id)).toEqual(before);
  });

  it('keeps the newest twenty history points per room and lists metadata without source text', async () => {
    let room = await create();
    const other = await create(newProject('Synthetic other room', true));
    await rpc('margin_commit', commitArguments(other));
    const otherHistory = await rpc('margin_history_read', { p_actor: ACTOR_A, p_id: other.id });
    for (let i = 1; i <= 24; i++) {
      room = await rpc(
        'margin_commit',
        commitArguments(room, { p_project: { ...room.project, name: `Synthetic revision ${i}` }, p_label: `Synthetic edit ${i}` }),
      );
    }
    const history = await rpc('margin_history_read', { p_actor: ACTOR_A, p_id: room.id });
    expect(history.points).toHaveLength(20);
    expect(history.points[0].label).toBe('Synthetic edit 24');
    expect(history.points.at(-1).label).toBe('Synthetic edit 5');
    for (const point of history.points) expect(Object.keys(point).sort()).toEqual(['createdAt', 'id', 'label', 'revision']);
    const snapshot = await rpc('margin_history_read', { p_actor: ACTOR_A, p_id: room.id, p_point: history.points[0].id });
    expect(snapshot.project.name).toBe('Synthetic revision 23');
    expect(await rpc('margin_history_read', { p_actor: ACTOR_A, p_id: room.id, p_point: otherHistory.points[0].id })).toEqual({
      error: 'not_found',
    });
    expect(await rpc('margin_history_read', { p_actor: ACTOR_A, p_id: other.id })).toEqual(otherHistory);
    expect(await state(room.id)).toMatchObject({ history: 20, receipts: 24 });
  });

  it('prunes large history by encoded byte size without pruning durable receipts', async () => {
    const project = newProject('Synthetic large history', true);
    project.transcripts = [
      makeTranscript('Synthetic source A', `Participant: ${'a'.repeat(560_000)}`),
      makeTranscript('Synthetic source B', `Participant: ${'b'.repeat(560_000)}`),
    ];
    let room = await create(project);
    for (let i = 1; i <= 21; i++)
      room = await rpc('margin_commit', commitArguments(room, { p_project: { ...room.project, name: `Synthetic large version ${i}` } }));
    const { rows } = await database.db.query<{ count: number; bytes: number }>(
      'select count(*)::int as count, sum(octet_length(project::text))::int as bytes from public.margin_history where room_id = $1::uuid',
      [room.id],
    );
    expect(rows[0].count).toBeGreaterThan(0);
    expect(rows[0].count).toBeLessThan(20);
    expect(rows[0].bytes).toBeLessThanOrEqual(20_000_000);
    expect(await state(room.id)).toMatchObject({ receipts: 21 });
    const history = await rpc('margin_history_read', { p_actor: ACTOR_A, p_id: room.id });
    const latest = await rpc('margin_history_read', { p_actor: ACTOR_A, p_id: room.id, p_point: history.points[0].id });
    expect(latest.project.name).toBe('Synthetic large version 20');
  }, 30_000);

  it('refuses new edits when the durable receipt ledger is full but still acknowledges old retries', async () => {
    const room = await create(),
      args = commitArguments(room),
      first = await rpc('margin_commit', args);
    // Seed synthetic receipts directly to reach the quota without 50,000 API calls.
    await database.db.query(
      `insert into public.margin_receipts(room_id,operation_id,actor_id,operation_hash,revision)
      select $1::uuid, md5('margin-synthetic-receipt-' || i::text)::uuid, $2::uuid, $3::text, $4::uuid
      from generate_series(1, 49999) i`,
      [room.id, ACTOR_A, HASH_A, first.revision],
    );
    const before = await state(room.id);
    expect(before.receipts).toBe(50_000);
    expect(await rpc('margin_commit', commitArguments(first))).toEqual({ error: 'operation_ledger_full' });
    expect(await rpc('margin_commit', args)).toMatchObject({
      revision: first.revision,
      receipt: { id: args.p_operation, revision: first.revision },
    });
    expect(await state(room.id)).toEqual(before);
  }, 30_000);

  it('enforces room and member quotas while permitting idempotent retries at the limit', async () => {
    const room = await create();
    await database.db.query(
      `insert into public.margin_rooms(id,owner_id,project,revision,creation_hash)
      select md5('margin-synthetic-room-' || i::text)::uuid, $1::uuid, $2::jsonb, $3::uuid, $4::text
      from generate_series(1,49) i`,
      [ACTOR_A, JSON.stringify(room.project), randomUUID(), HASH_A],
    );
    await database.db.query(
      `insert into public.margin_members(room_id,user_id,role)
      select id, owner_id, 'owner' from public.margin_rooms where id <> $1::uuid`,
      [room.id],
    );
    expect(
      await rpc('margin_create', {
        p_actor: ACTOR_A,
        p_id: randomUUID(),
        p_project: room.project,
        p_revision: randomUUID(),
        p_hash: HASH_A,
      }),
    ).toEqual({ error: 'room_limit' });
    expect(
      (await rpc('margin_create', { p_actor: ACTOR_A, p_id: room.id, p_project: room.project, p_revision: randomUUID(), p_hash: HASH_A }))
        .revision,
    ).toBe(room.revision);
    await database.db.exec(
      `insert into auth.users(id) select md5('margin-synthetic-member-' || i::text)::uuid from generate_series(1,48) i`,
    );
    await database.db.query(
      `insert into public.margin_members(room_id,user_id,role)
      select $1::uuid, md5('margin-synthetic-member-' || i::text)::uuid, 'editor' from generate_series(1,48) i`,
      [room.id],
    );
    expect((await membership(room.id, 'add', ACTOR_B)).members).toHaveLength(50);
    expect(await membership(room.id, 'add', ACTOR_C)).toEqual({ error: 'member_limit' });
    expect((await membership(room.id, 'add', ACTOR_B)).members).toHaveLength(50);
    expect((await membership(room.id, 'add', ACTOR_A)).members).toContainEqual({ userId: ACTOR_A, role: 'owner' });
  });

  it('paginates a member’s room metadata without returning project bodies or other users’ rooms', async () => {
    await database.db.query(
      `insert into public.margin_rooms(id,owner_id,project,revision,creation_hash)
      select md5('margin-synthetic-page-' || i::text)::uuid, $1::uuid, $2::jsonb, $3::uuid, $4::text
      from generate_series(1,51) i`,
      [ACTOR_A, JSON.stringify(newProject('Synthetic pagination', true)), randomUUID(), HASH_A],
    );
    await database.db.exec(`insert into public.margin_members(room_id,user_id,role) select id, owner_id, 'owner' from public.margin_rooms`);
    await create(newProject('Synthetic private other account', true), ACTOR_B);
    const first = await rpc('margin_list', { p_actor: ACTOR_A });
    expect(first.rooms).toHaveLength(50);
    const second = await rpc('margin_list', { p_actor: ACTOR_A, p_after: first.rooms.at(-1).id });
    expect(second.rooms).toHaveLength(1);
    const all = [...first.rooms, ...second.rooms];
    expect(new Set(all.map(r => r.id)).size).toBe(51);
    for (const room of all) expect(Object.keys(room).sort()).toEqual(['id', 'name', 'role', 'updatedAt']);
    expect(await rpc('margin_list', { p_actor: ACTOR_C })).toEqual({ rooms: [] });
    expect(await rpc('margin_list', { p_actor: null })).toEqual({ rooms: [] });
  });
});
