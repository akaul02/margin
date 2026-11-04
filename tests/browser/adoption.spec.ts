import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { demoProject } from '../../src/demo';
import { now, uid, saveQuoteCard, type Project } from '../../src/model';

function groupedProject() {
  const project = demoProject();
  const transcript = project.transcripts[0];
  const turn = transcript.turns.find(turn => turn.role === 'participant')!;
  const quote = saveQuoteCard(project, transcript.id, turn.id, turn.start, turn.end, transcript.text.slice(turn.start, turn.end));
  const date = now();
  project.boardGroups.push({
    id: uid(),
    title: 'First impressions',
    note: 'Synthetic group description.',
    color: 0,
    quoteIds: [quote.id],
    createdAt: date,
    updatedAt: date,
  });
  return project;
}

async function openBackup(page: Page, project: Project) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a project backup', exact: true }).click();
  await page.getByLabel('Project backup file').setInputFiles({
    name: 'synthetic.margin.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByRole('button', { name: 'Import project', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Board', exact: true })).toBeVisible();
}

async function backup(page: Page): Promise<Project> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save backup', exact: true }).click(),
  ]);
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}

for (const method of ['button', 'keyboard']) {
  test(`an existing grouped quote can be refiled to Ungrouped by ${method}`, async ({ page }) => {
    const original = groupedProject();
    await openBackup(page, original);
    await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
    await page.getByRole('button', { name: 'Select passage', exact: true }).first().click();
    await page.getByRole('button', { name: 'Use entire turn', exact: true }).click();
    if (method === 'button') await page.getByRole('button', { name: 'Add to Ungrouped', exact: true }).click();
    else await page.keyboard.press('0');
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Ungrouped quote group' }).locator('.sticky-card')).toHaveCount(1);
    const saved = await backup(page);
    expect(saved.quotes).toEqual(original.quotes);
    expect(saved.boardGroups[0].quoteIds).toEqual([]);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Ungrouped quote group' }).locator('.sticky-card')).toHaveCount(1);
    await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
    await page.getByRole('button', { name: 'Select passage', exact: true }).first().click();
    await page.getByRole('button', { name: 'Use entire turn', exact: true }).click();
    await page.keyboard.press('1');
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(page.getByRole('region', { name: 'First impressions quote group' }).locator('.sticky-card')).toHaveCount(1);
  });
}

for (const prefix of ['margin-tips:', 'margin-keys:', 'margin-about:']) {
  test(`an invalid ${prefix} preference cannot hide saved research`, async ({ page }) => {
    const original = groupedProject();
    await openBackup(page, original);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const invalid of ['null', '42', '[]', '{"broken":true}']) {
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: prefix + original.id, value: invalid });
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Board', exact: true })).toBeVisible();
      await expect(page.locator('.sticky-card')).toHaveCount(1);
      expect(await backup(page)).toEqual(original);
    }
    expect(errors).toEqual([]);
  });
}

test('composing Enter and Escape keep note writing open until an explicit save or discard', async ({ page }) => {
  await openBackup(page, groupedProject());
  await page.getByRole('region', { name: 'First impressions quote group' }).getByRole('button', { name: 'Add note' }).click();
  const editor = page.getByRole('textbox', { name: 'Note', exact: true });
  await editor.fill('図書館での経験');
  for (const event of [
    { key: 'Enter', isComposing: true, keyCode: 13 },
    { key: 'Escape', isComposing: true, keyCode: 27 },
    { key: 'Enter', isComposing: false, keyCode: 229 },
    { key: 'Escape', isComposing: false, keyCode: 229 },
  ]) {
    await editor.dispatchEvent('keydown', event);
    await expect(editor).toHaveValue('図書館での経験');
    await expect(page.locator('.board-note:not(.writing)')).toHaveCount(0);
  }
  await editor.press('Enter');
  await expect(editor).toHaveCount(0);
  expect((await backup(page)).boardNotes.map(note => note.text)).toEqual(['図書館での経験']);
  await page.getByRole('region', { name: 'First impressions quote group' }).getByRole('button', { name: 'Add note' }).click();
  await editor.fill('Discard this unfinished note');
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  expect((await backup(page)).boardNotes.map(note => note.text)).toEqual(['図書館での経験']);
});

for (const firstFile of ['valid', 'invalid']) {
  test(`choosing another backup ignores an older ${firstFile} file read`, async ({ page }) => {
    await page.addInitScript(() => {
      const read = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function () {
        if (this.name === 'slow-first.margin.json') {
          await new Promise<void>(resolve => Object.assign(window, { releaseFirstBackupRead: resolve }));
          const result = await read.call(this);
          Object.assign(window, { firstBackupReadFinished: true });
          return result;
        }
        return read.call(this);
      };
    });
    const first = groupedProject();
    first.name = 'First backup';
    const latest = groupedProject();
    latest.name = 'Selected backup';
    await page.goto('/');
    await page.getByRole('button', { name: 'Open a project backup', exact: true }).click();
    const input = page.getByLabel('Project backup file');
    await input.setInputFiles({
      name: 'slow-first.margin.json',
      mimeType: 'application/json',
      buffer: Buffer.from(firstFile === 'valid' ? JSON.stringify(first) : 'invalid synthetic backup'),
    });
    await page.waitForFunction(() => 'releaseFirstBackupRead' in window);
    await expect(page.getByRole('button', { name: 'Import project', exact: true })).toBeDisabled();
    await input.setInputFiles({ name: 'selected.margin.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(latest)) });
    await expect(page.locator('.restore-preview')).toContainText('Selected backup');
    await page.evaluate(() => (window as unknown as { releaseFirstBackupRead: () => void }).releaseFirstBackupRead());
    await page.waitForFunction(() => 'firstBackupReadFinished' in window);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator('.restore-preview')).toContainText('Selected backup');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Import project', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Board', exact: true })).toBeVisible();
    expect(await backup(page)).toEqual(latest);
  });
}
