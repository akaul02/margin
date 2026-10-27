import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { unlink } from 'node:fs/promises';
const compiled='tests/hosted-fixture/.compiled.mjs';
await build({entryPoints:['tests/hosted-fixture/service.ts'],outfile:compiled,bundle:true,packages:'external',format:'esm',platform:'node'});
const env={...process.env,VITE_MARGIN_MODE:'hosted',MARGIN_BUILD_OUTDIR:'dist-hosted-test',MARGIN_SYNTHETIC_TEST:'1',SUPABASE_URL:'http://127.0.0.1:5391',MARGIN_API_ORIGIN:'http://127.0.0.1:5391'};
const service=spawn(process.execPath,[compiled],{stdio:'inherit',env});
for(let i=0;i<150;i++){try{const response=await fetch('http://127.0.0.1:5391/fixture/health');if(response.ok)break;}catch{}if(i===149)throw new Error('Fixture did not start.');await new Promise(r=>setTimeout(r,100));}
const buildApp=spawn(process.execPath,['node_modules/vite/bin/vite.js','build'],{stdio:'inherit',env});
const buildCode=await new Promise(resolve=>buildApp.on('exit',resolve));if(buildCode!==0){service.kill();process.exit(1);}
const vite=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5390','--strictPort'],{stdio:'inherit',env});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;vite.kill();service.kill();await unlink(compiled).catch(()=>{});}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());vite.on('exit',()=>void stop());service.on('exit',()=>void stop());
