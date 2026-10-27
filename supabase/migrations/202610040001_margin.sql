-- Margin's tables and functions only. Run once through Supabase migrations.
-- Browser roles can read their memberships/rooms; every mutation is server-only.
begin;
create table public.margin_rooms (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  project jsonb not null check (jsonb_typeof(project) = 'object'),
  revision uuid not null,
  creation_hash text not null check (length(creation_hash) = 64),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (octet_length(project::text) <= 1800000)
);
create table public.margin_members (
  room_id uuid not null references public.margin_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner', 'editor')),
  primary key (room_id, user_id)
);
create index margin_members_user on public.margin_members(user_id, room_id);
create table public.margin_receipts (
  room_id uuid not null references public.margin_rooms(id) on delete cascade,
  operation_id uuid not null,
  actor_id uuid not null references auth.users(id),
  operation_hash text not null check (length(operation_hash) = 64),
  revision uuid not null,
  created_at timestamptz not null default now(),
  primary key (room_id, operation_id)
);
create table public.margin_history (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.margin_rooms(id) on delete cascade,
  revision uuid not null,
  project jsonb not null,
  label text not null check (length(label) <= 300),
  actor_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index margin_history_room on public.margin_history(room_id, id desc);

alter table public.margin_rooms enable row level security;
alter table public.margin_members enable row level security;
alter table public.margin_receipts enable row level security;
alter table public.margin_history enable row level security;
revoke all on public.margin_rooms, public.margin_members, public.margin_receipts, public.margin_history from public, anon, authenticated;
revoke all on sequence public.margin_history_id_seq from public, anon, authenticated;
grant select on public.margin_rooms, public.margin_members to authenticated;
create policy margin_own_membership on public.margin_members for select to authenticated
  using (user_id = (select auth.uid()));
create policy margin_member_room on public.margin_rooms for select to authenticated
  using (exists (select 1 from public.margin_members m where m.room_id = id and m.user_id = (select auth.uid())));

-- All entry points are SECURITY DEFINER with an empty search path and are
-- executable only by service_role. The API verifies the bearer before supplying
-- p_actor. Membership changes and edits acquire the same room row lock.
create function public.margin_create(p_actor uuid, p_id uuid, p_project jsonb, p_hash text, p_revision uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.margin_rooms;
begin
  if p_actor is null or p_id is null or p_project is null or p_revision is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error','invalid_argument'); end if;
  -- Serialize owner quota checks without an account-wide application lock.
  perform 1 from auth.users where id = p_actor for no key update;
  if not found then return jsonb_build_object('error','forbidden'); end if;
  select * into r from public.margin_rooms where id = p_id for update;
  if found then
    if r.owner_id <> p_actor or not exists (select 1 from public.margin_members where room_id = p_id and user_id = p_actor) then
      return jsonb_build_object('error','forbidden');
    end if;
    if r.creation_hash is distinct from p_hash then return jsonb_build_object('error','id_reused'); end if;
  else
    if (select count(*) from public.margin_rooms where owner_id = p_actor) >= 50 then return jsonb_build_object('error','room_limit'); end if;
    insert into public.margin_rooms(id,owner_id,project,revision,creation_hash) values(p_id,p_actor,p_project,p_revision,p_hash) returning * into r;
    insert into public.margin_members values(p_id,p_actor,'owner');
  end if;
  return jsonb_build_object('id',r.id,'revision',r.revision,'project',r.project,'updatedAt',r.updated_at,'role','owner');
end $$;

-- This authorized preparation read checks receipts BEFORE the API attempts to
-- apply a retry against a changed head. Commit checks again under its own lock.
create function public.margin_read(p_actor uuid, p_id uuid, p_operation uuid default null, p_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.margin_rooms; receipt public.margin_receipts; member_role text; answer jsonb;
begin
  if p_actor is null or p_id is null then return jsonb_build_object('error','invalid_argument'); end if;
  select * into r from public.margin_rooms where id = p_id for update;
  select role into member_role from public.margin_members where room_id = p_id and user_id = p_actor;
  if r.id is null or member_role is null then return jsonb_build_object('error','forbidden'); end if;
  answer := jsonb_build_object('id',r.id,'revision',r.revision,'project',r.project,'updatedAt',r.updated_at,'role',member_role);
  if p_operation is not null then
    select * into receipt from public.margin_receipts where room_id = p_id and operation_id = p_operation;
    if found then
      if receipt.operation_hash is distinct from p_hash or receipt.actor_id is distinct from p_actor then return jsonb_build_object('error','id_reused'); end if;
      answer := answer || jsonb_build_object('receipt',jsonb_build_object('id',receipt.operation_id,'revision',receipt.revision));
    end if;
  end if;
  return answer;
end $$;

create function public.margin_commit(p_actor uuid, p_id uuid, p_expected uuid, p_operation uuid, p_hash text, p_project jsonb, p_revision uuid, p_label text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.margin_rooms; receipt public.margin_receipts; member_role text; answer jsonb;
begin
  if p_expected is null or p_operation is null or p_project is null or p_revision is null or p_label is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error','invalid_argument'); end if;
  if p_actor is null or p_id is null then return jsonb_build_object('error','invalid_argument'); end if;
  select * into r from public.margin_rooms where id = p_id for update;
  select role into member_role from public.margin_members where room_id = p_id and user_id = p_actor;
  if r.id is null or member_role is null then return jsonb_build_object('error','forbidden'); end if;
  answer := jsonb_build_object('id',r.id,'revision',r.revision,'project',r.project,'updatedAt',r.updated_at,'role',member_role);
  select * into receipt from public.margin_receipts where room_id = p_id and operation_id = p_operation;
  if found then
    if receipt.operation_hash is distinct from p_hash or receipt.actor_id is distinct from p_actor then return jsonb_build_object('error','id_reused'); end if;
    return answer || jsonb_build_object('receipt',jsonb_build_object('id',receipt.operation_id,'revision',receipt.revision));
  end if;
  if r.revision is distinct from p_expected then return jsonb_build_object('error','revision_changed'); end if;
  if (select count(*) from public.margin_receipts where room_id = p_id) >= 50000 then return jsonb_build_object('error','operation_ledger_full'); end if;
  if p_project->>'id' is distinct from r.project->>'id' then return jsonb_build_object('error','invalid_project'); end if;
  insert into public.margin_history(room_id,revision,project,label,actor_id) values(p_id,r.revision,r.project,p_label,p_actor);
  update public.margin_rooms set project = p_project, revision = p_revision, updated_at = now() where id = p_id returning * into r;
  insert into public.margin_receipts(room_id,operation_id,actor_id,operation_hash,revision) values(p_id,p_operation,p_actor,p_hash,p_revision);
  -- Bound retained snapshots by count AND encoded size. Receipts are never
  -- pruned: a delayed retry must not silently become a second edit.
  delete from public.margin_history where id in (
    select id from (
      select id, row_number() over (order by id desc) as n,
        sum(octet_length(project::text)) over (order by id desc) as bytes
      from public.margin_history where room_id = p_id
    ) retained where n > 20 or bytes > 20000000
  );
  return jsonb_build_object('id',r.id,'revision',r.revision,'project',r.project,'updatedAt',r.updated_at,'role',member_role,
    'receipt',jsonb_build_object('id',p_operation,'revision',p_revision));
end $$;

create function public.margin_list(p_actor uuid, p_after uuid default null)
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('rooms',coalesce(jsonb_agg(item order by id),'[]'::jsonb)) from (
    select r.id, jsonb_build_object('id',r.id,'name',r.project->>'name','updatedAt',r.updated_at,'role',m.role) item
    from public.margin_rooms r join public.margin_members m on m.room_id=r.id
    where m.user_id=p_actor and (p_after is null or r.id>p_after) order by r.id limit 50
  ) items;
$$;

create function public.margin_membership(p_actor uuid, p_id uuid, p_action text, p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.margin_rooms; members jsonb;
begin
  if p_actor is null or p_id is null or p_action is null or (p_action in ('add','remove') and p_user is null) then return jsonb_build_object('error','invalid_argument'); end if;
  select * into r from public.margin_rooms where id = p_id for update;
  if r.id is null or r.owner_id <> p_actor or not exists(select 1 from public.margin_members where room_id=p_id and user_id=p_actor and role='owner') then return jsonb_build_object('error','forbidden'); end if;
  if p_action = 'add' then
    if not exists(select 1 from auth.users where id=p_user) then return jsonb_build_object('error','member_unavailable'); end if;
    if not exists(select 1 from public.margin_members where room_id=p_id and user_id=p_user) and (select count(*) from public.margin_members where room_id=p_id)>=50 then return jsonb_build_object('error','member_limit'); end if;
    insert into public.margin_members values(p_id,p_user,'editor') on conflict do nothing;
  elsif p_action = 'remove' then
    if p_user = r.owner_id then return jsonb_build_object('error','owner_required'); end if;
    delete from public.margin_members where room_id=p_id and user_id=p_user;
  elsif p_action <> 'list' then return jsonb_build_object('error','invalid_action'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'role',role) order by role,user_id),'[]'::jsonb) into members from public.margin_members where room_id=p_id;
  return jsonb_build_object('members',members);
end $$;

-- History lists contain metadata only; each snapshot is fetched separately.
create function public.margin_history_read(p_actor uuid, p_id uuid, p_point bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.margin_rooms; answer jsonb;
begin
  select * into r from public.margin_rooms where id=p_id for update;
  if r.id is null or not exists(select 1 from public.margin_members where room_id=p_id and user_id=p_actor) then return jsonb_build_object('error','forbidden'); end if;
  if p_point is null then
    select jsonb_build_object('points',coalesce(jsonb_agg(jsonb_build_object('id',id::text,'revision',revision,'label',label,'createdAt',created_at) order by id desc),'[]'::jsonb)) into answer from public.margin_history where room_id=p_id;
  else
    select jsonb_build_object('id',id::text,'revision',revision,'label',label,'createdAt',created_at,'project',project) into answer from public.margin_history where room_id=p_id and id=p_point;
  end if;
  return coalesce(answer,jsonb_build_object('error','not_found'));
end $$;

revoke all on function public.margin_create(uuid,uuid,jsonb,text,uuid), public.margin_read(uuid,uuid,uuid,text), public.margin_commit(uuid,uuid,uuid,uuid,text,jsonb,uuid,text), public.margin_list(uuid,uuid), public.margin_membership(uuid,uuid,text,uuid), public.margin_history_read(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.margin_create(uuid,uuid,jsonb,text,uuid), public.margin_read(uuid,uuid,uuid,text), public.margin_commit(uuid,uuid,uuid,uuid,text,jsonb,uuid,text), public.margin_list(uuid,uuid), public.margin_membership(uuid,uuid,text,uuid), public.margin_history_read(uuid,uuid,bigint) to service_role;
commit;
