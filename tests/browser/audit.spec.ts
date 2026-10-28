import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { demoProject } from '../../src/demo';

test('pasted transcripts keep exact text when Escape or Cancel is declined, including role review', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a project' }).click();
  await page.getByLabel('Project name').fill('Synthetic import guard');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
  await page.getByRole('button', { name: 'Import transcript', exact: true }).click();
  const text = 'Interviewer: What helped?\r\nParticipant: A quiet corner 🌱.\r\nExactly as written.';
  await page.getByLabel('Transcript name').fill('Unsubmitted synthetic source');
  await page.getByLabel('Transcript text', { exact: true }).fill(text);
  for (const action of [() => page.keyboard.press('Escape'), () => page.getByRole('button', { name: 'Cancel', exact: true }).click()]) {
    page.once('dialog', async d => {
      expect(d.type()).toBe('confirm');
      await d.dismiss();
    });
    await action();
    await expect(page.getByLabel('Transcript text', { exact: true })).toHaveValue(text.replaceAll('\r\n', '\n'));
  }
  await page.getByRole('button', { name: 'Review speaker roles' }).click();
  await page.getByLabel('Role for Participant').selectOption('participant');
  page.once('dialog', d => d.dismiss());
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByLabel('Role for Participant')).toHaveValue('participant');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByLabel('Transcript text', { exact: true })).toHaveValue(text.replaceAll('\r\n', '\n'));
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.transcript-link')).toHaveCount(0);
});

test('shared transcript submission locks its editor until the exact submitted source is saved', async ({ page }) => {
  const project = demoProject(),
    r = await page.request.post('/api/rooms', { headers: { 'X-Margin-Local': '1' }, data: { project } }),
    room = await r.json();
  await page.goto('/');
  await page.getByRole('button', { name: 'Join a local board', exact: true }).click();
  await page.getByLabel('Local room ID', { exact: true }).fill(room.id);
  await page.getByRole('button', { name: 'Join board', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
  await page.getByRole('button', { name: 'Import transcript', exact: true }).click();
  await page.getByLabel('This is fictional practice text.').check();
  const text = 'Researcher: Which path?\nVisitor: The garden path by the green sign.';
  await page.getByLabel('Transcript name').fill('Synthetic delayed source');
  await page.getByLabel('Transcript text', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Review speaker roles' }).click();
  await page.getByLabel('Role for Visitor').selectOption('participant');
  let release!: () => void;
  const gate = new Promise<void>(resolve => (release = resolve));
  let requested!: () => void;
  const sent = new Promise<void>(resolve => (requested = resolve));
  await page.route(
    '**/api/rooms/*/operations',
    async route => {
      requested();
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Import transcript', exact: true }).click();
  await sent;
  try {
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeDisabled();
    await expect(page.getByLabel('Role for Visitor')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = await (await page.request.get(`/api/rooms/${room.id}`)).json();
  expect(saved.project.transcripts.find((t: any) => t.name === 'Synthetic delayed source').text).toBe(text);
});

test('damaged writing drafts cannot hide healthy writing and remain downloadable unchanged', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the synthetic demo' }).click();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  const originals = await page.evaluate(async () => {
    const projectId = await new Promise<string>(resolve => {
      const r = indexedDB.open('ceal-margin-local');
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction('workspace'),
          q = tx.objectStore('workspace').get('current');
        q.onsuccess = () => resolve(q.result.activeId);
        tx.oncomplete = () => db.close();
      };
    });
    const valid = {
      id: crypto.randomUUID(),
      projectId,
      kind: 'memo',
      label: 'Recovered synthetic memo',
      updatedAt: new Date().toISOString(),
      data: { title: 'A saved question', body: 'These are my exact unfinished words.\nSecond line.' },
    };
    const records = {
      'margin-writing-v1:healthy': JSON.stringify(valid),
      'margin-writing-v1:damaged-label': JSON.stringify({ ...valid, id: 'damaged-label', label: { broken: true } }),
      'margin-writing-v1:damaged-json': '{damaged synthetic JSON',
    };
    for (const [key, value] of Object.entries(records)) localStorage.setItem(key, value);
    return records;
  });
  await page.reload();
  await page.getByRole('button', { name: 'Review saved drafts' }).click();
  await expect(page.getByRole('dialog')).toContainText('2 draft record(s) could not be opened');
  await expect(page.locator('.recovery-draft')).toHaveCount(1);
  await expect(page.locator('.recovery-draft')).toContainText('These are my exact unfinished words.');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'screenshots/27-damaged-draft-recovery.png', fullPage: false });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download all draft recovery data' }).click(),
  ]);
  expect(JSON.parse(await readFile((await download.path())!, 'utf8'))).toEqual(originals);
  await page.getByRole('button', { name: 'Restore saved writing' }).click();
  await expect(page.locator('.recovery-draft')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toContainText('2 draft record(s) could not be opened');
  expect(await page.evaluate(() => localStorage.getItem('margin-writing-v1:damaged-json'))).toBe(
    originals['margin-writing-v1:damaged-json'],
  );
});
