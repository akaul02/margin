import { test, expect, type Page, type Browser, type BrowserContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { demoProject } from '../../src/demo';
import { now, uid, saveQuoteCard, type Project } from '../../src/model';
import { diffProject } from '../../shared/operations.mjs';
const headers={'X-Margin-Local':'1'};
function fixture(){
 const p=demoProject(),t=p.transcripts[0],turn=t.turns.find(t=>t.role==='participant')!;
 const q=saveQuoteCard(p,t.id,turn.id,turn.start,turn.end,t.text.slice(turn.start,turn.end));
 const date=now();p.comments=['First original note','Second original note'].map(body=>({id:uid(),quoteId:q.id,by:'Synthetic reader',body,author:'user' as const,createdAt:date,updatedAt:date}));return p;
}
async function join(page:Page,id:string){await page.goto('/');await page.getByRole('button',{name:'Join a local board',exact:true}).click();await page.getByLabel('Local room ID',{exact:true}).fill(id);await page.getByRole('button',{name:'Join board',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.sticky-card')).toHaveCount(1);}
async function pair(page:Page,browser:Browser){
 const project=fixture(),response=await page.request.post('/api/rooms',{headers,data:{project}});expect(response.ok()).toBe(true);const room=await response.json();
 await join(page,room.id);const otherContext=await browser.newContext(),other=await otherContext.newPage();await join(other,room.id);return {room,project,other,otherContext};
}
async function open(page:Page){await page.locator('.sticky-card').first().getByRole('button',{name:'Source & notes'}).click();}
async function edit(page:Page,index:number,text:string){await page.locator('.card-comment').nth(index).getByRole('button',{name:'Edit note',exact:true}).click();await page.getByLabel('Edit your note',{exact:true}).fill(text);}
async function save(page:Page,text:string){await page.getByRole('button',{name:'Save note',exact:true}).click();await expect(page.getByLabel('Your note',{exact:true})).toBeVisible();await expect(page.locator('.card-comment').filter({hasText:text})).toHaveCount(1);}
async function close(page:Page){await page.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}
async function head(page:Page,id:string):Promise<Project>{return (await(await page.request.get(`/api/rooms/${id}`)).json()).project;}
async function stored(page:Page):Promise<any>{return page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('ceal-margin-local');r.onsuccess=()=>{const db=r.result,tx=db.transaction('workspace'),q=tx.objectStore('workspace').get('current');q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close();tx.onabort=()=>reject(tx.error);};}));}
async function changeRemote(page:Page,id:string,mutate:(p:Project)=>void){const before=await head(page,id),after=structuredClone(before);mutate(after);const op={id:uid(),projectId:before.id,at:now(),label:'Synthetic remote test edit',changes:diffProject(before,after)};const r=await page.request.post(`/api/rooms/${id}/operations`,{headers,data:op});expect(r.ok()).toBe(true);return op;}

test('different existing notes save concurrently without a whole-project conflict',async({page,browser})=>{
 const {room,other,otherContext}=await pair(page,browser);try{
 await open(page);await open(other);await edit(page,0,'Reader A independently revised note one.');await edit(other,1,'Reader B independently revised note two.');
 await Promise.all([save(page,'Reader A independently revised note one.'),save(other,'Reader B independently revised note two.')]);
 expect((await head(page,room.id)).comments.map(c=>c.body)).toEqual(['Reader A independently revised note one.','Reader B independently revised note two.']);
 await close(page);await close(other);await expect(page.getByRole('button',{name:'Review conflicting save'})).toHaveCount(0);await page.reload();await open(page);await expect(page.locator('.card-comments')).toContainText('Reader B independently revised note two.');
 }finally{await otherContext.close();}
});

test('same existing note race preserves both versions and offers an accessible explicit resolution',async({page,browser})=>{
 const {room,other,otherContext}=await pair(page,browser);try{
 await open(page);await open(other);await edit(page,0,'First reader’s saved wording.');await edit(other,0,'Second reader’s competing wording.');
 await save(page,'First reader’s saved wording.');await save(other,'Second reader’s competing wording.');await close(other);
 await other.getByRole('button',{name:'Review conflicting save'}).focus();await other.keyboard.press('Enter');await expect(other.getByRole('dialog')).toContainText('First reader’s saved wording.');await expect(other.getByRole('dialog')).toContainText('Second reader’s competing wording.');
 expect((await new AxeBuilder({page:other}).analyze()).violations).toEqual([]);await other.screenshot({path:'screenshots/23-note-conflict-review.png',fullPage:false});
 await other.emulateMedia({reducedMotion:'reduce'});await other.setViewportSize({width:390,height:844});await other.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await other.screenshot({path:'screenshots/24-note-conflict-phone.png',fullPage:false,animations:'disabled'});await other.getByRole('button',{name:'Add my version as a separate note'}).scrollIntoViewIfNeeded();await other.screenshot({path:'screenshots/26-note-conflict-phone-actions.png',fullPage:false});expect(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await other.getByRole('button',{name:'Add my version as a separate note'}).click();await expect(other.getByRole('dialog')).toHaveCount(0);
 await expect.poll(async()=>(await head(page,room.id)).comments.map(c=>c.body)).toEqual(expect.arrayContaining(['First reader’s saved wording.','Second reader’s competing wording.']));const current=await head(page,room.id);expect(current.comments).toHaveLength(3);
 const local=await stored(other);expect(local.projects).toHaveLength(2);expect(local.projects.find((p:any)=>p.id!==current.id).comments[0].body).toBe('Second reader’s competing wording.');
 }finally{await otherContext.close();}
});

test('deleting an existing note while another edits it never resurrects or loses the rejected text',async({page,browser})=>{
 const {room,other,otherContext}=await pair(page,browser);try{
 await open(page);await open(other);await edit(other,0,'Writing that raced with deletion.');page.once('dialog',d=>d.accept());await page.locator('.card-comment').first().getByRole('button',{name:'Remove note'}).click();await expect(page.locator('.card-comment')).toHaveCount(1);
 await save(other,'Writing that raced with deletion.');await close(other);await other.getByRole('button',{name:'Review conflicting save'}).click();await expect(other.getByRole('dialog')).toContainText('Removed / absent');
 await other.getByRole('button',{name:'Keep local copy & use shared'}).click();await expect(other.getByRole('dialog')).toHaveCount(0);
 expect((await head(page,room.id)).comments).toHaveLength(1);const local=await stored(other);expect(local.projects.find((p:any)=>p.name.endsWith('(local copy)')).comments[0].body).toBe('Writing that raced with deletion.');
 }finally{await otherContext.close();}
});

test('lost successful response plus a later remote edit retries the stable operation after reload exactly once',async({page,browser})=>{
 test.setTimeout(60000);const {room,otherContext}=await pair(page,browser);try{
 let committed!:()=>void;const committedPromise=new Promise<void>(r=>committed=r);let release!:()=>void;const releasePromise=new Promise<void>(r=>release=r);let opId='';
 await page.route('**/api/rooms/*/operations',async route=>{opId=route.request().postDataJSON().id;await route.fetch();committed();await releasePromise;await route.abort('failed');},{times:1});
 await open(page);await edit(page,0,'Committed once despite a lost acknowledgement.');await page.getByRole('button',{name:'Save note',exact:true}).click();await committedPromise;
 await expect(page.getByLabel('Edit your note')).toBeDisabled();await changeRemote(page,room.id,p=>{p.comments[1].body='A newer change from somebody else.';p.comments[1].updatedAt=now();});release();
 await expect(page.getByLabel('Your note',{exact:true})).toBeVisible();const before=await stored(page);expect(before.connections[room.project.id].pending[0].id).toBe(opId);await close(page);await page.reload();
 await expect.poll(async()=> (await stored(page)).connections[room.project.id].dirty,{timeout:15000}).toBe(false);
 const current=await head(page,room.id);expect(current.comments.map(c=>c.body)).toEqual(['Committed once despite a lost acknowledgement.','A newer change from somebody else.']);
 const history=await(await page.request.get(`/api/rooms/${room.id}/history`)).json();expect(history.points).toHaveLength(3);
 }finally{await otherContext.close();}
});

test('unsaved existing-note text survives reload and a newer shared edit without overwriting it',async({page,browser})=>{
 const {room,otherContext}=await pair(page,browser);try{
 await open(page);await edit(page,0,'Unsubmitted human writing 🌱 with a second line.\nExactly as typed.');await expect(page.getByRole('status').filter({hasText:'Writing draft saved on this device.'})).toBeVisible();
 await changeRemote(page,room.id,p=>{p.comments[0].body='Someone else saved this during the draft.';p.comments[0].updatedAt=now();});
 page.once('dialog',d=>d.accept());await page.reload();await expect.poll(async()=> (await stored(page)).projects[0].comments[0].body,{timeout:15000}).toBe('Someone else saved this during the draft.');
 await page.getByRole('button',{name:'Review saved drafts'}).click();await expect(page.getByRole('dialog')).toContainText('Unsubmitted human writing 🌱 with a second line.');await page.getByRole('button',{name:'Restore saved writing'}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('This note changed or was removed');
 expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);await page.screenshot({path:'screenshots/25-recovered-writing.png',fullPage:false});await page.getByRole('button',{name:'Save as a separate note'}).click();await expect(page.getByRole('dialog')).toContainText('No saved writing drafts remain');
 expect((await head(page,room.id)).comments.map(c=>c.body)).toEqual(expect.arrayContaining(['Someone else saved this during the draft.','Unsubmitted human writing 🌱 with a second line.\nExactly as typed.']));
 }finally{await otherContext.close();}
});

test('new memo and orphaned card drafts remain recoverable after reload',async({page,browser})=>{
 const {room,otherContext}=await pair(page,browser);try{
 await open(page);await page.getByLabel('Your name',{exact:true}).fill('Synthetic writer');await page.getByLabel('Your note',{exact:true}).fill('An unfinished note on a removed card.');
 await changeRemote(page,room.id,p=>{p.quotes=[];p.comments=[];p.boardGroups.forEach(g=>g.quoteIds=[]);});page.once('dialog',d=>d.accept());await page.reload();await expect(page.locator('.sticky-card')).toHaveCount(0);
 await page.getByRole('button',{name:'Review saved drafts'}).click();await page.getByRole('button',{name:'Restore saved writing'}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('The source card was removed');await close(page);
 await page.getByRole('button',{name:'Memos',exact:true}).click();await page.getByRole('button',{name:'Write a memo',exact:true}).click();await page.getByLabel('Memo title',{exact:true}).fill('Unfinished reflection');await page.getByLabel('Your words',{exact:true}).fill('My own memo words remain after reload.');page.once('dialog',d=>d.accept());await page.reload();
 await page.getByRole('button',{name:'Review saved drafts'}).click();await page.locator('.recovery-draft').filter({hasText:'Unfinished reflection'}).getByRole('button',{name:'Restore saved writing'}).click();await expect.poll(async()=> (await head(page,room.id)).memos[0]?.body).toBe('My own memo words remain after reload.');
 expect(await page.locator('.recovery-draft').allTextContents()).toEqual([expect.stringContaining('An unfinished note on a removed card.')]);
 }finally{await otherContext.close();}
});

test('offline dependent edits survive reconnect while another reader edits a different note',async({page,context,browser})=>{
 const {room,otherContext}=await pair(page,browser);try{
 await open(page);await context.setOffline(true);await edit(page,0,'My first offline revision.');await save(page,'My first offline revision.');await edit(page,0,'My second offline revision.');await save(page,'My second offline revision.');
 const pending=(await stored(page)).connections[room.project.id].pending;expect(pending).toHaveLength(2);expect(pending[0].id).not.toBe(pending[1].id);
 await context.setOffline(false);await changeRemote(page,room.id,p=>{p.comments[1].body='Independent remote writing.';p.comments[1].updatedAt=now();});await close(page);await page.reload();
 await expect.poll(async()=> (await stored(page)).connections[room.project.id].dirty,{timeout:15000}).toBe(false);
 expect((await head(page,room.id)).comments.map(c=>c.body)).toEqual(['My second offline revision.','Independent remote writing.']);
 }finally{await otherContext.close();}
});

test('Undo touches only my records and stops if another reader changed the same note',async({page,browser})=>{
 const {room,otherContext}=await pair(page,browser);try{
 await open(page);await edit(page,0,'My saved edit.');await save(page,'My saved edit.');await close(page);await changeRemote(page,room.id,p=>{p.comments[1].body='Keep this unrelated contribution.';p.comments[1].updatedAt=now();});
 await expect.poll(async()=> (await stored(page)).projects[0].comments[1].body,{timeout:15000}).toBe('Keep this unrelated contribution.');await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect.poll(async()=> (await head(page,room.id)).comments.map(c=>c.body)).toEqual(['First original note','Keep this unrelated contribution.']);
 await open(page);await edit(page,0,'Another edit from me.');await save(page,'Another edit from me.');await close(page);await changeRemote(page,room.id,p=>{p.comments[0].body='A later revision of the same note.';p.comments[0].updatedAt=now();});
 await expect.poll(async()=> (await stored(page)).projects[0].comments[0].body,{timeout:15000}).toBe('A later revision of the same note.');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.locator('.global-error')).toContainText('Undo stopped');expect((await head(page,room.id)).comments[0].body).toBe('A later revision of the same note.');
 }finally{await otherContext.close();}
});

test('stale tab save keeps its writing draft and recovers without overwriting the newer workspace',async({page,context,browser})=>{
 const {room,otherContext}=await pair(page,browser);const tab=await context.newPage();try{
 await tab.goto('/');await open(tab);await edit(tab,1,'A draft from the stale tab.');await open(page);await edit(page,0,'A newer saved change in the first tab.');await save(page,'A newer saved change in the first tab.');await close(page);
 await tab.getByRole('button',{name:'Save note',exact:true}).click();await expect(tab.getByRole('dialog').getByRole('alert')).toContainText('Another tab changed this workspace');await expect(tab.getByLabel('Edit your note')).toHaveValue('A draft from the stale tab.');
 tab.once('dialog',d=>d.accept());await tab.reload();await tab.getByRole('button',{name:'Review saved drafts'}).click();await tab.getByRole('button',{name:'Restore saved writing'}).click();await expect.poll(async()=> (await head(page,room.id)).comments.map(c=>c.body)).toEqual(['A newer saved change in the first tab.','A draft from the stale tab.']);
 }finally{await tab.close();await otherContext.close();}
});

test('draft quota failure is visible and project-storage abort keeps draft and outbox intact',async({page,browser})=>{
 const {room,otherContext}=await pair(page,browser);try{
 await open(page);await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('margin-writing-v1:'))throw new DOMException('Synthetic quota failure','QuotaExceededError');return original.call(this,k,v);};});
 await edit(page,0,'Visible unsaved text after draft quota failure.');await expect(page.getByRole('dialog').getByRole('alert')).toContainText('This draft could not be stored');await expect(page.getByRole('button',{name:'Download this writing now'})).toBeVisible();expect((await head(page,room.id)).comments[0].body).toBe('First original note');
 page.once('dialog',d=>d.accept());await page.reload();await open(page);await edit(page,0,'Durable draft before project quota failure.');const before=await stored(page);
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,key){if(key==='current'){this.transaction.abort();throw new DOMException('Synthetic quota failure','QuotaExceededError');}return put.call(this,value,key);};});
 await page.getByRole('button',{name:'Save note',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Nothing was changed');expect(await stored(page)).toEqual(before);expect((await head(page,room.id)).comments[0].body).toBe('First original note');
 expect(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('margin-writing-v1:')&&localStorage.getItem(k)?.includes('Durable draft before project quota failure.')))).toBe(true);
 }finally{await otherContext.close();}
});

test('failed draft storage guards close, Escape, switching notes and source navigation',async({page,browser})=>{
 const {otherContext}=await pair(page,browser);try{
 await open(page);await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('margin-writing-v1:'))throw new DOMException('Synthetic denied storage','SecurityError');original.call(this,k,v);};});await edit(page,0,'Do not lose my unstoreable writing.');
 const actions=[()=>page.getByRole('button',{name:'Close dialog'}).click(),()=>page.keyboard.press('Escape'),()=>page.locator('.card-comment').nth(1).getByRole('button',{name:'Edit note',exact:true}).click(),()=>page.getByRole('button',{name:'View in transcript',exact:true}).click(),()=>page.getByRole('button',{name:'Close edit · keep draft'}).click()];
 for(const action of actions){page.once('dialog',async d=>{expect(d.message()).toContain('could not be stored');await d.dismiss();});await action();await expect(page.getByLabel('Edit your note')).toHaveValue('Do not lose my unstoreable writing.');}
 }finally{await otherContext.close();}
});

for(const draftKind of ['existing','new'] as const)test(`recovery in another tab removes only its submitted ${draftKind} draft generation`,async({page,context,browser})=>{
 const {otherContext}=await pair(page,browser);const tab=await context.newPage();try{
 await open(page);if(draftKind==='existing')await edit(page,0,'First generation submitted for recovery.');else {await page.getByLabel('Your name',{exact:true}).fill('Synthetic writer');await page.getByLabel('Your note',{exact:true}).fill('First generation submitted for recovery.');}await tab.goto('/');await tab.getByRole('button',{name:'Review saved drafts'}).click();
 let ready!:()=>void,release!:()=>void;const committed=new Promise<void>(r=>ready=r),hold=new Promise<void>(r=>release=r);
 await tab.route('**/api/rooms/*/operations',async route=>{const response=await route.fetch();ready();await hold;await route.fulfill({response});},{times:1});
 await tab.getByRole('button',{name:'Restore saved writing'}).click();await committed;await page.getByLabel(draftKind==='existing'?'Edit your note':'Your note',{exact:true}).fill('Newer typing must remain after the other tab finishes.');release();
 await expect(tab.locator('.recovery-draft')).toContainText('Newer typing must remain after the other tab finishes.');await expect(tab.getByRole('button',{name:'Restore saved writing'})).toBeEnabled();
 page.once('dialog',d=>d.accept());await page.reload();await page.getByRole('button',{name:'Review saved drafts'}).click();await expect(page.locator('.recovery-draft')).toContainText('Newer typing must remain after the other tab finishes.');await page.getByRole('button',{name:'Save as a separate note'}).click();await expect(page.locator('.recovery-draft')).toHaveCount(0);
 }finally{await tab.close();await otherContext.close();}
});

async function importLocal(page:Page,p:Project){await page.goto('/');await page.getByRole('button',{name:'Open a project backup'}).click();await page.getByLabel('Project backup file').setInputFiles({name:'synthetic.margin.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(p))});await page.getByRole('button',{name:'Import project',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);}

test('late creation acknowledgement cannot roll back another tab’s newer committed note',async({page,context})=>{
 const p=fixture();await importLocal(page,p);let ready!:()=>void,release!:()=>void;const committed=new Promise<void>(r=>ready=r),hold=new Promise<void>(r=>release=r);let roomId='';
 await page.route('**/api/rooms',async route=>{roomId=route.request().postDataJSON().id;const response=await route.fetch();ready();await hold;await route.fulfill({response});},{times:1});
 await page.getByRole('button',{name:'Work together',exact:true}).click();await page.getByRole('button',{name:'Start local live session'}).click();await committed;
 const tab=await context.newPage();try{
 await tab.goto('/');await expect.poll(async()=> (await stored(tab)).connections[p.id].creating).toBeUndefined();await open(tab);await edit(tab,0,'Newer note after room creation.');await save(tab,'Newer note after room creation.');release();
 await expect(page.getByLabel('Local room ID',{exact:true})).toHaveValue(roomId);await expect.poll(async()=> (await stored(page)).projects[0].comments[0].body).toBe('Newer note after room creation.');await close(page);await open(page);await expect(page.locator('.card-comment').first()).toContainText('Newer note after room creation.');
 }finally{release();await tab.close();}
});

test('failed room creation resumes with its original ID after reload',async({page})=>{
 const p=fixture();await importLocal(page,p);let requestedId='';await page.route('**/api/rooms',async route=>{requestedId=route.request().postDataJSON().id;await route.abort('failed');},{times:1});
 await page.getByRole('button',{name:'Work together',exact:true}).click();await page.getByRole('button',{name:'Start local live session'}).click();await expect.poll(()=>requestedId).not.toBe('');await expect(page.getByLabel('Local room ID',{exact:true})).toHaveValue(requestedId);await close(page);await page.reload();
 await expect.poll(async()=> (await stored(page)).connections[p.id].creating).toBeUndefined();expect((await stored(page)).connections[p.id].roomId).toBe(requestedId);expect((await head(page,requestedId)).id).toBe(p.id);
});

test('an unchanged edit keeps sharing clean and incoming updates continue',async({page,browser})=>{
 const {room,otherContext}=await pair(page,browser);try{
 await page.getByRole('button',{name:'Transcripts',exact:true}).click();await page.getByRole('button',{name:'Speaker roles',exact:true}).click();await page.getByRole('button',{name:'Save roles',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
 expect((await stored(page)).connections[room.project.id].dirty).toBe(false);await changeRemote(page,room.id,p=>{p.comments[1].body='Still receiving updates.';p.comments[1].updatedAt=now();});await expect.poll(async()=> (await stored(page)).projects[0].comments[1].body,{timeout:15000}).toBe('Still receiving updates.');
 }finally{await otherContext.close();}
});

test('leaving the shared session in another tab stops a delayed retry acknowledgement',async({page,context,browser})=>{
 const {room,otherContext}=await pair(page,browser);const tab=await context.newPage();try{
 let ready!:()=>void,release!:()=>void;const committed=new Promise<void>(r=>ready=r),hold=new Promise<void>(r=>release=r);let posts=0;
 await page.route('**/api/rooms/*/operations',async route=>{posts++;const response=await route.fetch();ready();await hold;await route.fulfill({response});});
 await open(page);await edit(page,0,'Saved before leaving the session.');await page.getByRole('button',{name:'Save note',exact:true}).click();await committed;
 await tab.goto('/');await tab.getByRole('button',{name:'Leave shared session'}).click();await expect(tab.locator('.shared-banner')).toHaveCount(0);release();await expect(page.getByLabel('Your note',{exact:true})).toBeVisible();await close(page);await expect(page.locator('.shared-banner')).toHaveCount(0);expect(posts).toBe(1);expect((await head(page,room.id)).comments[0].body).toBe('Saved before leaving the session.');
 }finally{await tab.close();await otherContext.close();}
});
