// SYNTHETIC TEST FIXTURE ONLY. This file is excluded from deployment.
// It simulates Supabase Auth while executing the real migration in PostgreSQL.
import { createServer } from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { createHostedHandler, HOSTED_PROJECT_BYTES } from '../../server/hosted-service';
import { testDatabase, ACTOR_A, ACTOR_B, ACTOR_C } from '../support/pglite';
const port=5391, origin='http://127.0.0.1:5390', authOrigin=`http://127.0.0.1:${port}`;
const identities=[ACTOR_A,ACTOR_B,ACTOR_C];
const emails=['reader-a@example.invalid','reader-b@example.invalid','reader-c@example.invalid'];
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
const tokens=identities.map(id=>`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+86400})}.synthetic_signature_not_valid_for_any_real_service`);
const user=(i:number)=>({id:identities[i],aud:'authenticated',role:'authenticated',email:emails[i],email_confirmed_at:'2026-01-01T00:00:00Z',app_metadata:{provider:'email',providers:['email']},user_metadata:{},created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z',identities:[]});
const session=(i:number)=>({access_token:tokens[i],token_type:'bearer',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,refresh_token:`synthetic-refresh-${i}`,user:user(i)});
const database=await testDatabase();
const auth=createClient(authOrigin,'sb_publishable_synthetic_fixture',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const handle=createHostedHandler({config:{mode:'hosted',supabaseUrl:authOrigin,publishableKey:'sb_publishable_synthetic_fixture',projectBytes:HOSTED_PROJECT_BYTES},verify:async token=>{const {data,error}=await auth.auth.getUser(token);return error?null:data.user;},rpc:database.rpc});
const server=createServer(async(req,res)=>{
  const url=new URL(req.url??'/',authOrigin);
  if(req.headers.origin && req.headers.origin!==origin){res.writeHead(403);res.end();return;}
  if(req.headers.origin===origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info,x-supabase-api-version');res.setHeader('Access-Control-Allow-Methods','GET,POST,DELETE,OPTIONS');}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  try{
    if(url.pathname==='/fixture/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"synthetic":true}');return;}
    let content='';for await(const chunk of req){content+=chunk;if(Buffer.byteLength(content)>3_200_000){res.writeHead(413);res.end();return;}}
    if(url.pathname.startsWith('/auth/v1/')){
      res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
      const token=req.headers.authorization?.replace(/^Bearer /,''),index=tokens.indexOf(token??'');
      if(url.pathname==='/auth/v1/token'){
        const data=JSON.parse(content||'{}');let i=-1;
        if(url.searchParams.get('grant_type')==='password' && data.password==='synthetic-only-password')i=emails.indexOf(data.email);
        if(url.searchParams.get('grant_type')==='refresh_token')i=['synthetic-refresh-0','synthetic-refresh-1','synthetic-refresh-2'].indexOf(data.refresh_token);
        if(i>=0){res.end(JSON.stringify(session(i)));return;}
      }else if(url.pathname==='/auth/v1/user' && index>=0){res.end(JSON.stringify(user(index)));return;}
      else if(url.pathname==='/auth/v1/logout'){res.writeHead(204);res.end();return;}
      res.writeHead(401);res.end('{"message":"Invalid synthetic sign-in","error_code":"invalid_credentials"}');return;
    }
    const headers=new Headers();for(const[key,value]of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
    const response=await handle(new Request(authOrigin+(req.url??'/'),{method:req.method,headers,body:['GET','HEAD'].includes(req.method??'GET')?undefined:content}));
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  }catch{res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"synthetic_fixture_error"}');}
});
server.listen(port,'127.0.0.1',()=>process.stdout.write('Synthetic hosted fixture ready on loopback.\n'));
const close=()=>server.close(()=>{void database.db.close().then(()=>process.exit(0));});process.on('SIGTERM',close);process.on('SIGINT',close);
