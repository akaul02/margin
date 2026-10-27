import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

async function demo(page: Page) { await page.goto('/'); await page.getByRole('button',{name:'Try the synthetic demo'}).click();await page.getByRole('button',{name:'Skip tutorial'}).click(); await page.getByRole('button', { name: 'Transcripts', exact: true }).click(); await expect(page.getByRole('heading', { name: 'A visit to the neighborhood library' })).toBeVisible(); }
async function code(page: Page, name: string) { await page.getByRole('button', { name: 'Create a code', exact: true }).first().click(); await page.getByLabel('Code name', { exact: true }).fill(name); await page.getByRole('button', { name: 'Create code', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); }
async function entireTurn(page: Page, name = 'A place to pause') { await page.getByRole('button', { name: 'Select passage', exact: true }).first().click(); await page.getByRole('button', { name: 'Use entire turn' }).click(); await code(page, name); await page.getByRole('button', { name: 'Save coded quote' }).click(); await expect(page.locator('.highlight').first()).toBeVisible(); }
async function backup(page: Page) { await page.getByRole('button', { name: 'Export', exact: true }).click(); const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Project backup Lossless' }).click()]); const file = await download.path(); const raw = await readFile(file!, 'utf8'); await page.getByRole('button', { name: 'Close dialog' }).click(); return raw; }
async function restore(page: Page, raw: string) { await page.getByRole('button',{name:'Open project menu'}).click(); await page.getByRole('button', { name: 'Import backup', exact: true }).click(); await page.getByLabel('Project backup file').setInputFiles({ name: 'test.margin.json', mimeType: 'application/json', buffer: Buffer.from(raw) }); }

test('welcome, empty project and accessible first steps', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Margin', exact: true })).toBeVisible();
  await page.screenshot({ path: 'screenshots/01-welcome-desktop.png', fullPage: true });
  const scan = await new AxeBuilder({ page }).analyze(); expect(scan.violations).toEqual([]);
  await page.getByRole('button', { name: 'Start a project' }).click(); await page.getByLabel('Project name').fill('Synthetic test workspace'); await page.getByRole('button', { name: 'Create project' }).click(); await expect(page.getByRole('heading', { name: 'Board', exact: true })).toBeVisible();
});

test('exact mouse selection, participant-only filtering, duplicate quote safety, refresh persistence and context', async ({ page }) => {
  await demo(page);
  // Real pointer drag through a text node, starting after the first three characters.
  const passage = page.locator('.participant .turn-text').first();
  const points = await passage.evaluate(el => { const text = el.firstChild!.firstChild!; const a = document.createRange(); a.setStart(text, 3); a.setEnd(text, 4); const b = document.createRange(); b.setStart(text, 24); b.setEnd(text, 25); const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect(); return { ax: ar.x, ay: ar.y + ar.height / 2, bx: br.x, by: br.y + br.height / 2 }; });
  await page.mouse.move(points.ax, points.ay); await page.mouse.down(); await page.mouse.move(points.bx, points.by, { steps: 12 }); await page.mouse.up();
  await expect(page.locator('.selection-card')).toBeVisible(); const exact = await page.locator('.selection-card blockquote').innerText(); expect(exact!.length).toBeGreaterThan(10);
  await code(page, 'My first observation'); await page.getByRole('button', { name: 'Save coded quote' }).click(); await expect(page.locator('mark.highlight').first()).toHaveText(exact!);
  await page.getByLabel('Show context turns').uncheck(); await expect(page.locator('.turn.interviewer')).toHaveCount(0); await expect(page.locator('.turn.participant')).toHaveCount(4);
  await page.reload(); await expect(page.locator('mark.highlight').first()).toHaveText(exact!);
  await page.getByRole('button',{name:'Board',exact:true}).click();await page.getByRole('button',{name:'All quotes',exact:true}).click(); await expect(page.locator('.quote-card blockquote')).toHaveText(exact!); await page.getByText('Show context', { exact: true }).click(); await expect(page.locator('.quote-context')).toContainText('Interviewer · Interviewer · context only');
  const raw = JSON.parse(await backup(page)); expect(raw.quotes[0].text).toBe(raw.transcripts[0].text.slice(raw.quotes[0].start, raw.quotes[0].end));
  await page.getByRole('button', { name: 'View in transcript' }).click(); await expect(page.locator('.turn:focus')).toHaveCount(1);
});

test('keyboard passage, rename, merge, undo and memo authorship', async ({ page }) => {
  await demo(page); await page.getByRole('button', { name: 'Select passage', exact: true }).first().focus(); await page.keyboard.press('Enter');
  const area = page.getByLabel('Participant passage'); await expect(area).toBeFocused(); await page.keyboard.press('ControlOrMeta+Home'); await page.keyboard.down('Shift'); for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight'); await page.keyboard.up('Shift');
  await page.getByRole('button', { name: 'Use selection', exact: true }).click(); await expect(page.locator('.selection-card blockquote')).toHaveText('I went');
  await code(page, 'First code'); await page.getByRole('button', { name: 'Save coded quote' }).click();
  await page.getByRole('button', { name: 'Edit code First code' }).click(); await page.getByLabel('Code name', { exact: true }).fill('Renamed code'); await page.getByRole('button', { name: 'Save changes' }).click();
  await code(page, 'Destination'); await page.getByRole('button', { name: 'Edit code Renamed code' }).click(); await page.getByText('Merge into another code', { exact: true }).click(); await page.getByLabel('Keep this code').selectOption({ label: 'Destination' }); await page.getByRole('button', { name: 'Merge “Renamed code”' }).click();
  await expect(page.getByRole('button', { name: 'Edit code Renamed code' })).toHaveCount(0); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.getByRole('button', { name: 'Edit code Renamed code' })).toBeVisible();
  await page.getByRole('button', {name:'Memos',exact:true}).click(); await page.getByRole('button', { name: 'Write a memo', exact: true }).click(); await page.getByLabel('Memo title').fill('My question'); await page.getByLabel('Your words').fill('I want to revisit this exact passage.'); await page.getByRole('button', { name: 'Save memo' }).click(); await expect(page.locator('.memo-card')).toContainText('My question');
  const raw = JSON.parse(await backup(page)); expect(raw.memos[0].author).toBe('user'); expect(raw.quotes[0].text).toBe('I went');
  await page.screenshot({ path: 'screenshots/05-memos-desktop.png', fullPage: true });
});

test('import review defaults safe, file errors, duplicate errors, exact source and raw-line mode', async ({ page }) => {
  await demo(page); await page.getByRole('button',{name:'Transcripts',exact:true}).click();await page.getByRole('button',{name:'Import transcript',exact:true}).click(); await page.getByLabel('This is fictional practice text.').check();
  const text = 'Researcher: A question?\r\nVisitor: My answer 🌱, exactly.\r\nResearcher: Another question?';
  await page.getByLabel('Choose transcript text file').setInputFiles({ name: 'Synthetic.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
  await page.getByRole('button', { name: 'Review speaker roles' }).click(); await expect(page.getByLabel('Role for Visitor')).toHaveValue('participant');
  await page.getByLabel('Role for Researcher').selectOption('interviewer'); await page.getByLabel('Role for Visitor').selectOption('participant'); await page.getByRole('button', { name: 'Import transcript', exact: true }).last().click(); await expect(page.getByRole('heading', { name: 'Synthetic', exact: true })).toBeVisible();
  const p = JSON.parse(await backup(page)); expect(p.transcripts[1].text).toBe(text);
  await page.getByRole('button',{name:'Transcripts',exact:true}).click();await page.getByRole('button',{name:'Import transcript',exact:true}).click(); await page.getByLabel('This is fictional practice text.').check(); await page.getByLabel('Transcript name').fill('Duplicate renamed'); await page.getByLabel('Transcript text', { exact: true }).fill(text); await page.getByRole('button', { name: 'Review speaker roles' }).click(); await expect(page.getByRole('alert')).toContainText('already in this project');
  page.once('dialog', d => d.accept()); await page.getByRole('button', { name: 'Close dialog' }).click(); await restore(page, '{bad-json'); await expect(page.getByRole('alert')).toContainText('not valid project JSON'); await expect(page.getByRole('button', { name: 'Import project', exact: true })).toBeDisabled();
});

test('project backup round-trip, duplicate import as separate copy, code CSV, protected roles and recoverable removal', async ({ page, browser }) => {
  await demo(page); await entireTurn(page); const raw = await backup(page);
  const otherContext = await browser.newContext(); const other = await otherContext.newPage(); await other.goto('/'); await other.getByRole('button', { name: 'Open a project backup' }).click(); await other.getByLabel('Project backup file').setInputFiles({ name: 'test.margin.json', mimeType: 'application/json', buffer: Buffer.from(raw) }); await other.getByRole('button', { name: 'Import project', exact: true }).click(); const roundTrip = await backup(other); expect(JSON.parse(roundTrip)).toEqual(JSON.parse(raw)); await otherContext.close();
  await restore(page, raw); await expect(page.getByRole('button', { name: 'Import separate copy' })).toBeEnabled(); await page.getByRole('button', { name: 'Import separate copy' }).click(); const copy = JSON.parse(await backup(page)); expect(copy.id).not.toBe(JSON.parse(raw).id); expect(copy.quotes).toEqual(JSON.parse(raw).quotes);
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click(); await page.getByRole('button', { name: 'Speaker roles', exact: true }).click(); await expect(page.getByLabel('Turn 2 · Participant')).toBeDisabled(); await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button',{name:'Board',exact:true}).click();await page.getByRole('button',{name:'All quotes',exact:true}).click(); await page.getByRole('button', { name: 'Remove quote' }).click(); await expect(page.locator('.quote-card')).toHaveCount(0); await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('.quote-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Export', exact: true }).click(); const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Quotes & codes CSV' }).click()]); expect(await readFile((await csv.path())!, 'utf8')).toContain('exact_quote');
});

test('desktop, dark mode, phone, reduced motion, keyboard focus and automated accessibility', async ({ page }) => {
  const external: string[] = []; page.on('request', req => { if (!new URL(req.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) external.push(req.url()); });
  await demo(page); await entireTurn(page); expect(await page.locator('.tip').evaluate(el => getComputedStyle(el).animationName)).toBe('arrive'); await page.emulateMedia({ reducedMotion: 'reduce' }); expect(await page.locator('.tip').evaluate(el => getComputedStyle(el).animationName)).toBe('none'); await page.getByRole('button', { name: 'Dismiss tip' }).click();
  await page.screenshot({ path: 'screenshots/02-reading-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Select passage', exact: true }).first().click(); await page.getByRole('button', { name: 'Use entire turn' }).click(); await page.screenshot({ path: 'screenshots/08-active-coding-desktop.png', fullPage: true }); await page.getByRole('button', { name: 'Clear selected passage' }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button',{name:'Board',exact:true}).click();await page.getByRole('button',{name:'All quotes',exact:true}).click(); await page.getByText('Show context', { exact: true }).click(); await page.screenshot({ path: 'screenshots/04-quote-context-desktop.png', fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Transcripts' }).click(); await page.getByRole('button',{name:'Display settings'}).click();await page.getByRole('radio',{name:'Dark'}).check();await page.keyboard.press('Escape'); await page.screenshot({ path: 'screenshots/03-reading-dark.png', fullPage: true }); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'reduce' }); expect(await page.locator('.turn').first().evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByRole('heading', { name: 'A visit to the neighborhood library' })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.screenshot({ path: 'screenshots/06-reading-phone-dark.png', fullPage: true });
  await page.getByRole('button',{name:'Display settings'}).click();await page.getByRole('radio',{name:'Light'}).check();await page.keyboard.press('Escape'); await page.screenshot({ path: 'screenshots/07-reading-phone-light.png', fullPage: true }); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Help and keyboard guide' }).focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'Help and keyboard guide' })).toBeFocused();
  await page.setViewportSize({width:320,height:800}); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await page.setViewportSize({width:720,height:540}); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(external).toEqual([]);
});

test('two tabs cannot silently overwrite changes', async ({ page, context }) => {
  await demo(page); const second = await context.newPage(); await second.goto('/'); await expect(second.getByRole('heading', { name: 'A visit to the neighborhood library' })).toBeVisible();
  await code(page, 'Saved in tab one'); await second.getByRole('button', { name: 'Create a code', exact: true }).click(); await second.getByLabel('Code name', { exact: true }).fill('Conflicting change'); await second.getByRole('button', { name: 'Create code', exact: true }).click(); await expect(second.getByRole('dialog').getByRole('alert')).toContainText('Another tab changed');
  await page.reload(); await expect(page.getByRole('button', { name: 'Edit code Saved in tab one' })).toBeVisible();
});


test('keyboard selection after CRLF keeps exact offsets and rejects interviewer selections', async ({ page }) => {
 await demo(page); await page.getByRole('button',{name:'Transcripts',exact:true}).click();await page.getByRole('button',{name:'Import transcript',exact:true}).click(); await page.getByLabel('This is fictional practice text.').check();
 const source = 'Researcher: A question?\r\nVisitor: First line\r\nSecond line 🌱\r\nResearcher: End question?';
 await page.getByLabel('Choose transcript text file').setInputFiles({ name: 'Line endings.txt', mimeType: 'text/plain', buffer: Buffer.from(source) });
 await page.getByRole('button', { name: 'Review speaker roles' }).click(); await page.getByLabel('Role for Researcher').selectOption('interviewer'); await page.getByLabel('Role for Visitor').selectOption('participant'); await page.getByRole('button', { name: 'Import transcript', exact: true }).last().click();
 await expect(page.getByRole('heading',{name:'Line endings',exact:true})).toBeVisible(); await page.getByRole('button', { name: 'Select passage', exact: true }).click(); const area = page.getByLabel('Participant passage'); await expect(area).toBeFocused();
 await area.press('ControlOrMeta+Home'); for(let i=0;i<11;i++) await area.press('ArrowRight'); await area.press('Shift+ArrowRight'); await area.press('Shift+ArrowRight'); await area.press('Shift+ArrowRight'); await area.press('Shift+ArrowRight'); await area.press('Shift+ArrowRight'); await area.press('Shift+ArrowRight');
 await page.getByRole('button', { name: 'Use selection', exact: true }).click(); await expect(page.locator('.selection-card blockquote')).toHaveText('Second'); await code(page,'Exact second line'); await page.getByRole('button',{name:'Save coded quote'}).click();
 const data = JSON.parse(await backup(page)); expect(data.quotes[0].text).toBe('Second'); expect(source.slice(data.quotes[0].start,data.quotes[0].end)).toBe('Second');
 const interviewer = page.locator('.turn.interviewer .turn-text').first(); await interviewer.evaluate(el => { const r=document.createRange();r.selectNodeContents(el);const s=getSelection()!;s.removeAllRanges();s.addRange(r);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); });
 await expect(page.getByRole('alert')).toContainText('Only participant'); await expect(page.locator('.selection-card')).toHaveCount(0);
});

test('unassigned import and one-turn-per-line mode keep prose intact',async({page})=>{
 await demo(page); await page.getByRole('button',{name:'Transcripts',exact:true}).click();await page.getByRole('button',{name:'Import transcript',exact:true}).click(); await page.getByLabel('This is fictional practice text.').check(); await page.getByLabel('Transcript name').fill('Colon prose'); await page.getByLabel('Transcript text',{exact:true}).fill('I was told: wait longer\nThen I came back.'); await page.getByLabel('How should turns be separated?').selectOption('lines'); await page.getByRole('button',{name:'Review speaker roles'}).click(); await page.getByRole('button',{name:'Import transcript',exact:true}).last().click();
 await expect(page.getByRole('button',{name:'Select passage',exact:true})).toHaveCount(0); await expect(page.locator('.turn-text').first()).toHaveText('I was told: wait longer');
 await page.getByRole('button',{name:'Speaker roles',exact:true}).click(); await page.getByLabel('Turn 1 · Unlabeled').selectOption('participant'); await page.getByLabel('Turn 2 · Unlabeled').selectOption('interviewer'); await page.getByRole('button',{name:'Save roles'}).click(); await expect(page.getByRole('button',{name:'Select passage',exact:true})).toHaveCount(1);
});

test('malformed evidence backup leaves current project intact',async({page})=>{
 await demo(page); await entireTurn(page); const data=JSON.parse(await backup(page)); data.quotes[0].text='A fabricated paraphrase'; await restore(page,JSON.stringify(data)); await expect(page.getByRole('alert')).toContainText('quote does not match'); await expect(page.getByRole('button',{name:'Import project',exact:true})).toBeDisabled(); await page.getByRole('button',{name:'Close dialog'}).click(); await page.reload(); await expect(page.locator('mark.highlight')).toHaveCount(1);
});


test('an unsaved memo can be kept when closing is accidental',async({page})=>{
 await demo(page);await page.getByRole('button',{name:'Memos',exact:true}).click();await page.getByRole('button',{name:'Write a memo',exact:true}).click();await page.getByLabel('Memo title').fill('Keep my draft');await page.getByLabel('Your words').fill('My own unsaved thought.');page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');await expect(page.getByLabel('Your words')).toHaveValue('My own unsaved thought.');await page.getByRole('button',{name:'Save memo'}).click();await expect(page.locator('.memo-card')).toContainText('My own unsaved thought.');
});

test('one damaged project is quarantined while healthy projects stay usable',async({page})=>{
 await demo(page); await page.evaluate(async()=>{
   await new Promise<void>((resolve,reject)=>{const r=indexedDB.open('ceal-margin-local',1);r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const tx=db.transaction('workspace','readwrite');const store=tx.objectStore('workspace');const read=store.get('current');read.onsuccess=()=>{const data=read.result;data.projects.push({id:'damaged',name:'Damaged synthetic project',version:99});store.put(data,'current');};tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});
 }); await page.reload(); await expect(page.getByRole('alert')).toContainText('1 project(s) could not be opened'); await expect(page.getByRole('heading',{name:'A visit to the neighborhood library'})).toBeVisible(); await code(page,'Healthy project still works');
 const [dl]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download recovery data'}).click()]); const recovery=JSON.parse(await readFile((await dl.path())!,'utf8'));expect(recovery.quarantined[0].raw.id).toBe('damaged');await page.reload();await expect(page.getByRole('alert')).toContainText('1 project(s) could not be opened');await expect(page.getByRole('button',{name:'Edit code Healthy project still works'})).toBeVisible();
});

test('source selection guard handles a single letter following CRLF whitespace',async({page})=>{
 await demo(page);await page.getByRole('button',{name:'Transcripts',exact:true}).click();await page.getByRole('button',{name:'Import transcript',exact:true}).click();await page.getByLabel('This is fictional practice text.').check();await page.getByLabel('Choose transcript text file').setInputFiles({name:'Single letter.txt',mimeType:'text/plain',buffer:Buffer.from('Visitor: A\r\n B')});await page.getByRole('button',{name:'Review speaker roles'}).click();await page.getByLabel('Role for Visitor').selectOption('participant');await page.getByRole('button',{name:'Import transcript',exact:true}).last().click();await expect(page.getByRole('heading',{name:'Single letter',exact:true})).toBeVisible();await page.getByRole('button',{name:'Select passage',exact:true}).click();const area=page.getByLabel('Participant passage');await expect(area).toBeFocused();for(let i=0;i<3;i++)await area.press('ArrowRight');await area.press('Shift+ArrowRight');await expect(page.getByRole('button',{name:'Use selection',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Use selection',exact:true}).click();await expect(page.locator('.selection-card blockquote')).toHaveText('B');
});

test('a project can be deleted with its restore points after an optional backup', async ({ page }) => {
  const dump = () => page.evaluate(() => new Promise<any>(resolve => { const r = indexedDB.open('ceal-margin-local'); r.onsuccess = () => { const s = r.result.transaction('workspace').objectStore('workspace'); const keys = s.getAllKeys(); const cur = s.get('current'); cur.onsuccess = () => { r.result.close(); resolve({ keys: keys.result.map(String), current: cur.result }); }; }; }));
  await page.goto('/');
  for (const name of ['Synthetic keep', 'Synthetic delete me']) {
    if (name !== 'Synthetic keep') await page.getByRole('link', { name: 'Margin home' }).click();
    await page.getByRole('button', { name: 'Start a project' }).click(); await page.getByLabel('Project name').fill(name); await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByRole('heading', { name: 'Board', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'New group', exact: true }).click(); await page.getByLabel('Group name', { exact: true }).fill('A group'); await page.getByRole('button', { name: 'Create group', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  const before = await dump(); const doomed = before.current.projects.find((p: any) => p.name === 'Synthetic delete me').id;
  expect(before.keys).toContain(`history:${doomed}`);
  await page.getByRole('link', { name: 'Margin home' }).click();
  await page.getByRole('button', { name: 'Delete project Synthetic delete me' }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('cannot be undone'); await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const [file] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download a backup first' }).click()]);
  expect(file.suggestedFilename()).toBe('synthetic-delete-me.margin.json'); expect(JSON.parse(await readFile((await file.path())!, 'utf8')).id).toBe(doomed);
  await dialog.getByRole('button', { name: 'Delete project', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Synthetic delete me/ })).toHaveCount(0); await expect(page.getByRole('button', { name: /^Synthetic keep/ })).toBeVisible();
  const after = await dump(); expect(after.current.projects.map((p: any) => p.name)).toEqual(['Synthetic keep']); expect(after.keys.some((k: string) => k.includes(doomed))).toBe(false);
  await page.reload(); await expect(page.getByRole('button', { name: /^Synthetic keep/ })).toBeVisible(); await expect(page.getByRole('button', { name: /^Synthetic delete me/ })).toHaveCount(0);
});

test('the demo tutorial walks through the core loop with Ceal and moves on by itself', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Try the synthetic demo' }).click();
  const coach = page.locator('.driver-popover');
  await expect(coach).toContainText('Step 1 of 15'); await expect(coach).toContainText('Ceal'); await expect(coach.locator('.seal-guide')).toHaveCount(1);
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
  await expect(coach).toContainText('Step 2 of 15');
  await page.getByRole('button', { name: 'Select passage', exact: true }).first().click(); await page.getByRole('button', { name: 'Use entire turn' }).click();
  await expect(coach).toContainText('Step 3 of 15');
  await page.keyboard.press('0');
  await expect(coach).toContainText('Step 4 of 15');
  await page.getByRole('button', { name: 'New group', exact: true }).first().click(); await page.getByLabel('Group name', { exact: true }).fill('Feeling welcome'); await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(coach).toContainText('Step 5 of 15');
  await page.getByRole('button', { name: 'Select passage', exact: true }).nth(1).click(); await page.getByRole('button', { name: 'Use entire turn' }).click(); await page.keyboard.press('1');
  await expect(coach).toContainText('Step 6 of 15');
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(coach).toContainText('Step 7 of 15'); await expect(page.locator('.board-group').filter({ hasText: 'Feeling welcome' }).locator('.group-count')).toHaveText('1');
  await coach.getByRole('button', { name: 'Next' }).click(); await expect(coach).toContainText('Step 8 of 15');
  await page.getByRole('button', { name: 'Add note to Feeling welcome' }).click(); await page.keyboard.type('Being recognised matters.'); await page.keyboard.press('Enter');
  await expect(coach).toContainText('Step 9 of 15'); await expect(page.locator('.board-note .note-words')).toHaveText('Being recognised matters.');
  for (const [step, title] of [[9, 'Group labels'], [10, 'Find and share'], [11, 'Memos'], [12, 'Codes'], [13, 'Safe to experiment'], [14, 'Keep a copy']] as const) {
    await expect(coach).toContainText(`Step ${step} of 15`); await expect(coach).toContainText(title); await coach.getByRole('button', { name: 'Next' }).click();
  }
  await expect(coach).toContainText('Step 15 of 15'); await page.getByRole('button', { name: 'Finish' }).click(); await expect(coach).toHaveCount(0); await expect(page.locator('.seal-guide')).toHaveCount(0);
});
test('Ceal says hello once on a first visit and can start the tour', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/');
  const hello = page.getByRole('region', { name: 'Tour guide' });
  await expect(hello).toContainText('Hi, I’m Ceal!'); expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await hello.getByRole('button', { name: 'No thanks' }).click(); await expect(hello).toHaveCount(0);
  await page.reload(); await expect(page.getByRole('button', { name: 'Start a project' })).toBeVisible(); await expect(hello).toHaveCount(0);
  await page.evaluate(() => localStorage.removeItem('margin-seal-hello')); await page.reload();
  await hello.getByRole('button', { name: 'Show me around' }).click(); await expect(page.locator('.driver-popover')).toContainText('Step 1 of 15');
  await page.getByRole('button', { name: 'Skip tutorial' }).click(); await expect(page.locator('.driver-popover')).toHaveCount(0); await expect(page.locator('.seal-guide')).toHaveCount(0);
  await page.goto('/'); await expect(hello).toHaveCount(0);
});
test('display settings: light, dark or the system theme, and a remembered text size', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' }); await page.goto('/');
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  await page.getByRole('button', { name: 'Display settings' }).click();
  await expect(page.getByRole('radio', { name: 'System' })).toBeChecked(); expect(await theme()).toBe('light');
  await page.emulateMedia({ colorScheme: 'dark' }); await expect.poll(theme).toBe('dark');
  await page.getByRole('radio', { name: 'Light' }).check(); expect(await theme()).toBe('light');
  await page.getByRole('button', { name: 'Larger text' }).click(); await page.getByRole('button', { name: 'Larger text' }).click();
  await expect(page.getByRole('group', { name: 'Display settings' })).toContainText('125%');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape'); await expect(page.getByRole('group', { name: 'Display settings' })).toHaveCount(0);
  await page.reload(); expect(await theme()).toBe('light');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#main')!).zoom)).toBe('1.25');
  await page.getByRole('button', { name: 'Display settings' }).click(); await page.getByRole('button', { name: 'Reset' }).click();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('#main')!).zoom)).toBe('1');
});
