import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { createHostedHandler } from '../server/hosted-service';
import { publicConfiguration } from '../server/supabase';
import { demoProject } from '../src/demo';
import { newProject, makeTranscript, saveQuoteCard, type Project } from '../src/model';
import { diffProject, type Operation } from '../shared/operations.mjs';
import { assertHostedProject, HOSTED_PROJECT_BYTES, HOSTED_OPERATION_BYTES } from '../shared/hosted-limits';
import { ACTOR_A, ACTOR_B, ACTOR_C, testDatabase, databaseRpc } from './support/pglite';

const config = { mode:'hosted' as const,supabaseUrl:'https://synthetic.invalid',publishableKey:'sb_publishable_synthetic_fixture',projectBytes:HOSTED_PROJECT_BYTES };
const actors:Record<string,string> = { alpha:ACTOR_A,beta:ACTOR_B,gamma:ACTOR_C };
const verify = async (token:string) => actors[token] ? {id:actors[token]} : null;
let database: Awaited<ReturnType<typeof testDatabase>>;
let handle: ReturnType<typeof createHostedHandler>;
async function request(path:string,method='GET',data?:unknown,token='alpha',handler=handle) {
  const response = await handler(new Request(`https://margin.invalid/api${path}`,{ method, headers:{Authorization:`Bearer ${token}`,...(data!==undefined?{'Content-Type':'application/json'}:{})}, body:data===undefined?undefined:JSON.stringify(data) }));
  return {status:response.status,data:await response.json(),headers:response.headers};
}
function syntheticProject() { const p=demoProject(),t=p.transcripts[0],turn=t.turns.find(x=>x.role==='participant')!; saveQuoteCard(p,t.id,turn.id,turn.start,Math.min(turn.end,turn.start+35),t.text.slice(turn.start,Math.min(turn.end,turn.start+35))); return p; }
async function create(project=syntheticProject()) { const id=randomUUID(); const response=await request('/rooms','POST',{id,project}); expect(response.status).toBe(201); return response.data; }
function note(project:Project,body:string):Operation { const next=structuredClone(project),at=new Date().toISOString();next.comments.push({id:randomUUID(),quoteId:project.quotes[0].id,by:'Synthetic tester',body,author:'user',createdAt:at,updatedAt:at});return{id:randomUUID(),projectId:project.id,at,label:'Synthetic note',changes:diffProject(project,next)}; }

beforeAll(async()=>{database=await testDatabase();handle=createHostedHandler({config,verify,rpc:database.rpc});},30000);
afterAll(async()=>{await database?.db.close();});
describe('hosted API against real local PostgreSQL',()=>{
  it('requires a verified bearer and never trusts actor/body/cookie/query identity',async()=>{
    const room=await create();
    const anonymous=await handle(new Request(`https://margin.invalid/api/rooms/${room.id}?token=alpha`,{headers:{Cookie:'session=alpha'}}));
    expect(anonymous.status).toBe(401);
    expect((await request(`/rooms/${room.id}`,'GET',undefined,'expired')).status).toBe(401);
    const outsider=await request(`/rooms/${room.id}`,'GET',undefined,'gamma');expect(outsider.status).toBe(403);expect(outsider.data.project).toBeUndefined();
    const forged=await request(`/rooms/${room.id}/members`,'POST',{userId:ACTOR_C,p_actor:ACTOR_A},'gamma');expect(forged.status).toBe(403);
    expect((await request(`/rooms/${room.id}`)).headers.get('cache-control')).toContain('no-store');
  });
  it('creates once with a durable stable ID and rejects changed or foreign retries',async()=>{
    const project=demoProject(),id=randomUUID();const first=await request('/rooms','POST',{id,project});
    expect((await request('/rooms','POST',{id,project})).data.revision).toBe(first.data.revision);
    expect((await request('/rooms','POST',{id,project:{...project,name:'Changed retry'}})).status).toBe(409);
    const foreign=await request('/rooms','POST',{id,project},'beta');expect(foreign.status).toBe(403);expect(foreign.data.project).toBeUndefined();
  });
  it('checks duplicate receipts before applying a retry, returning today’s head',async()=>{
    const room=await create(),first=note(room.project,'First exact synthetic note');
    expect((await request(`/rooms/${room.id}/operations`,'POST',first)).status).toBe(200);
    const current=(await request(`/rooms/${room.id}`)).data,second=note(current.project,'Later independent note');
    const latest=await request(`/rooms/${room.id}/operations`,'POST',second);
    const retry=await request(`/rooms/${room.id}/operations`,'POST',first);
    expect(retry.status).toBe(200);expect(retry.data.revision).toBe(latest.data.revision);expect(retry.data.receipt.id).toBe(first.id);
    expect(retry.data.project.comments.filter((x:any)=>x.body==='First exact synthetic note')).toHaveLength(1);
    expect((await request(`/rooms/${room.id}/operations`,'POST',{...first,label:'Different payload same ID'})).status).toBe(409);
  });
  it('reapplies disjoint record edits after an intervening commit without losing either',async()=>{
    const room=await create(),first=note(room.project,'Editor A'),second=note(room.project,'Editor B');
    let injected=false;
    const interleaved=createHostedHandler({config,verify,rpc:async(name,args)=>{
      if(name==='margin_commit'&&!injected){injected=true;expect((await request(`/rooms/${room.id}/operations`,'POST',second)).status).toBe(200);}
      return database.rpc(name,args);
    }});
    const saved=await request(`/rooms/${room.id}/operations`,'POST',first,'alpha',interleaved);
    expect(saved.status).toBe(200);expect(saved.data.project.comments.map((x:any)=>x.body)).toEqual(expect.arrayContaining(['Editor A','Editor B']));
  });
  it('preserves a competing record edit as an explicit conflict with remote context',async()=>{
    const room=await create(),a=structuredClone(room.project),b=structuredClone(room.project);a.name='Reader A title';b.name='Reader B title';
    const op=(p:Project):Operation=>({id:randomUUID(),projectId:p.id,at:new Date().toISOString(),label:'Title edit',changes:diffProject(room.project,p)});
    expect((await request(`/rooms/${room.id}/operations`,'POST',op(a))).status).toBe(200);
    const conflict=await request(`/rooms/${room.id}/operations`,'POST',op(b));expect(conflict.status).toBe(409);expect(conflict.data.error).toBe('operation_conflict');expect(conflict.data.room.project.name).toBe('Reader A title');
  });
  it('rejects invented quote text and source mutation at the server boundary',async()=>{
    const room=await create(),changed=structuredClone(room.project);changed.quotes[0].text='Not in the original source';
    const invalid:Operation={id:randomUUID(),projectId:changed.id,at:new Date().toISOString(),label:'Invalid synthetic edit',changes:diffProject(room.project,changed)};
    expect((await request(`/rooms/${room.id}/operations`,'POST',invalid)).status).toBe(409);
    expect((await request(`/rooms/${room.id}`)).data.project).toEqual(room.project);
  });
  it('revocation denies saved-operation retries and keeps history responses bounded',async()=>{
    const room=await create();expect((await request(`/rooms/${room.id}/members`,'POST',{userId:ACTOR_B})).status).toBe(200);
    const edit=note(room.project,'Synthetic editor note');expect((await request(`/rooms/${room.id}/operations`,'POST',edit,'beta')).status).toBe(200);
    const history=(await request(`/rooms/${room.id}/history`)).data;expect(history.points).toHaveLength(1);expect(history.points[0].project).toBeUndefined();
    expect((await request(`/rooms/${room.id}/history/${history.points[0].id}`)).data.project).toEqual(room.project);
    await request(`/rooms/${room.id}/members`,'DELETE',{userId:ACTOR_B});
    const revoked=await request(`/rooms/${room.id}/operations`,'POST',edit,'beta');expect(revoked.status).toBe(403);expect(revoked.data.project).toBeUndefined();
    expect((await request('/rooms','GET',undefined,'beta')).data.rooms).not.toContainEqual(expect.objectContaining({id:room.id}));
  });
  it('rejects oversized and unsupported hosted text before storage without normalizing it',async()=>{
    expect(()=>assertHostedProject({text:'x'.repeat(HOSTED_PROJECT_BYTES)})).toThrow('1.5 MB');
    expect(()=>assertHostedProject({text:'before\u0000after'})).toThrow('cannot preserve');
    expect(()=>assertHostedProject({text:'\ud800'})).toThrow('cannot preserve');
    expect(()=>assertHostedProject({text:'😀\r\n original'})).not.toThrow();
    const oversized=await request('/rooms','POST',{id:randomUUID(),project:'x'.repeat(HOSTED_OPERATION_BYTES)});expect(oversized.status).toBe(413);
    const project=newProject('Large synthetic project');project.transcripts=[makeTranscript('A','Participant: '+ 'a'.repeat(790000),[],'labels'),makeTranscript('B','Participant: '+'b'.repeat(790000),[],'labels')];
    expect((await request('/rooms','POST',{id:randomUUID(),project})).status).toBe(422);
    const unsupported=demoProject();unsupported.memos.push({id:randomUUID(),title:'Synthetic',body:'Exact\u0000writing',author:'user',quoteIds:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});const response=await request('/rooms','POST',{id:randomUUID(),project:unsupported});expect(response.status).toBe(422);expect(response.data.message).toContain('cannot preserve');expect(unsupported.memos[0].body).toBe('Exact\u0000writing');
  });
  it('never returns a service secret from public configuration',()=>{
    const env={SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',SUPABASE_SECRET_KEY:'sb_secret_DO_NOT_RETURN'};
    expect(JSON.stringify(publicConfiguration(env))).not.toContain('DO_NOT_RETURN');
    expect(()=>publicConfiguration({...env,SUPABASE_PUBLISHABLE_KEY:'sb_secret_synthetic'})).toThrow();
    const jwt=(role:string)=>`header.${Buffer.from(JSON.stringify({role})).toString('base64url')}.synthetic-signature`;
    expect(()=>publicConfiguration({...env,SUPABASE_PUBLISHABLE_KEY:jwt('service_role')})).toThrow();
    expect(()=>publicConfiguration({...env,SUPABASE_PUBLISHABLE_KEY:jwt('anon')})).not.toThrow();
    expect(()=>publicConfiguration({...env,SUPABASE_URL:'https://user:secret@synthetic.supabase.co'})).toThrow();
  });
});

it('keeps room data and idempotency receipts across a PostgreSQL restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'margin-hosted-synthetic-'));let db:PGlite|undefined;
  try{
    const first=await testDatabase(dir);db=first.db;const firstHandler=createHostedHandler({config,verify,rpc:first.rpc});
    const id=randomUUID(),project=syntheticProject();const created=await request('/rooms','POST',{id,project},'alpha',firstHandler);const edit=note(created.data.project,'Durable retry');
    const committed=await request(`/rooms/${id}/operations`,'POST',edit,'alpha',firstHandler);expect(committed.status).toBe(200);await db.close();
    db=new PGlite(dir);const restarted=createHostedHandler({config,verify,rpc:databaseRpc(db)});const retry=await request(`/rooms/${id}/operations`,'POST',edit,'alpha',restarted);
    expect(retry.status).toBe(200);expect(retry.data.revision).toBe(committed.data.revision);expect(retry.data.project).toEqual(committed.data.project);
  }finally{await db?.close();await rm(dir,{recursive:true,force:true});}
},30000);
