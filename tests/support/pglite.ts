import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export const ACTOR_A = '00000000-0000-4000-8000-000000000001';
export const ACTOR_B = '00000000-0000-4000-8000-000000000002';
export const ACTOR_C = '00000000-0000-4000-8000-000000000003';
const argumentsByFunction: Record<string, Record<string,string>> = {
  margin_create: { p_actor:'uuid',p_id:'uuid',p_project:'jsonb',p_hash:'text',p_revision:'uuid' },
  margin_read: { p_actor:'uuid',p_id:'uuid',p_operation:'uuid',p_hash:'text' },
  margin_commit: { p_actor:'uuid',p_id:'uuid',p_expected:'uuid',p_operation:'uuid',p_hash:'text',p_project:'jsonb',p_revision:'uuid',p_label:'text' },
  margin_list: { p_actor:'uuid',p_after:'uuid' },
  margin_membership: { p_actor:'uuid',p_id:'uuid',p_action:'text',p_user:'uuid' },
  margin_history_read: { p_actor:'uuid',p_id:'uuid',p_point:'bigint' },
};
export function databaseRpc(db: PGlite) {
  return async (name: string, args: Record<string,unknown>) => {
    if(!Object.hasOwn(argumentsByFunction,name))throw new Error('Unknown test RPC.');
    const types = argumentsByFunction[name], entries = Object.entries(args);
    const parameters = entries.map(([key],i)=>{if(!Object.hasOwn(types,key))throw new Error('Unknown test argument.');return `${key} => $${i+1}::${types[key]}`;});
    const values = entries.map(([key,value])=>types[key]==='jsonb'?JSON.stringify(value):value);
    const result = await db.query<{ value: any }>(`select public.${name}(${parameters.join(',')}) as value`,values);
    return result.rows[0].value;
  };
}
export async function testDatabase(directory?:string) {
  const db = new PGlite(directory);
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    -- Reproduce broad default grants so the migration must explicitly revoke.
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    insert into auth.users values ('${ACTOR_A}'),('${ACTOR_B}'),('${ACTOR_C}');
  `);
  await db.exec(await readFile(resolve('supabase/migrations/202610040001_margin.sql'),'utf8'));
  return { db, rpc: databaseRpc(db) };
}
