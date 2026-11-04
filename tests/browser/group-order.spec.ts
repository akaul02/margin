import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { demoProject } from '../../src/demo';
import { now, uid, type Project } from '../../src/model';

function fixture() {
  const project = demoProject();
  const date = now();
  project.boardGroups = ['First', 'Second', 'Third'].map((title, color) => ({
    id: uid(),
    title,
    color,
    note: `${title} synthetic description.`,
    quoteIds: [],
    createdAt: date,
    updatedAt: date,
  }));
  return project;
}

const titles = (page: Page) => page.locator('.board-columns .group-title');

async function importBackup(page: Page, project: Project) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open a project backup', exact: true }).click();
  await page.getByLabel('Project backup file').setInputFiles({
    name: 'synthetic-group-order.margin.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.getByRole('button', { name: 'Import project', exact: true }).click();
  await expect(titles(page)).toHaveText(['First', 'Second', 'Third']);
}

async function backup(page: Page): Promise<Project> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save backup', exact: true }).click(),
  ]);
  return JSON.parse(await readFile((await download.path())!, 'utf8'));
}

async function join(page: Page, roomId: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Join a local board', exact: true }).click();
  await page.getByLabel('Local room ID', { exact: true }).fill(roomId);
  await page.getByRole('button', { name: 'Join board', exact: true }).click();
  await expect(titles(page)).toHaveText(['First', 'Second', 'Third']);
}

async function moveSecond(page: Page, direction: 'left' | 'right') {
  await page.getByRole('button', { name: 'Edit group Second', exact: true }).click();
  await page.getByRole('button', { name: `Move ${direction}`, exact: true }).click();
  await expect(titles(page)).toHaveText(direction === 'left' ? ['Second', 'First', 'Third'] : ['First', 'Third', 'Second']);
  await expect(page.getByRole('button', { name: `Move ${direction}`, exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
}

test('moving groups changes the board, supports Undo, and survives reload without changing group contents', async ({ page }) => {
  const project = fixture();
  await importBackup(page, project);
  await moveSecond(page, 'left');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(titles(page)).toHaveText(['First', 'Second', 'Third']);
  expect((await backup(page)).boardGroups).toEqual(project.boardGroups);
  await moveSecond(page, 'right');
  const saved = await backup(page);
  expect(saved.boardGroups).toEqual([project.boardGroups[0], project.boardGroups[2], project.boardGroups[1]]);
  expect(saved.transcripts).toEqual(project.transcripts);
  await page.reload();
  await expect(titles(page)).toHaveText(['First', 'Third', 'Second']);
  expect((await backup(page)).boardGroups).toEqual(saved.boardGroups);
});

test('shared group order and its Undo preserve another reader’s later group description', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const project = fixture();
  const response = await page.request.post('/api/rooms', { headers: { 'X-Margin-Local': '1' }, data: { project } });
  expect(response.ok()).toBe(true);
  const room = await response.json();
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  try {
    await join(page, room.id);
    await join(other, room.id);
    await moveSecond(page, 'left');
    await expect(titles(other)).toHaveText(['Second', 'First', 'Third'], { timeout: 15_000 });
    await other.getByRole('button', { name: 'Edit group First', exact: true }).click();
    await other.getByLabel('Description', { exact: true }).fill('A later description written by the second reader.');
    await other.getByRole('button', { name: 'Save group', exact: true }).click();
    await expect(other.getByRole('dialog')).toHaveCount(0);
    const firstGroup = page.getByRole('region', { name: 'First quote group', exact: true });
    await firstGroup.getByRole('button', { name: 'Read more: First', exact: true }).click();
    await expect(firstGroup).toContainText('A later description written by the second reader.', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(titles(page)).toHaveText(['First', 'Second', 'Third']);
    await expect(titles(other)).toHaveText(['First', 'Second', 'Third'], { timeout: 15_000 });
    const saved = await backup(page);
    expect(saved.boardGroups.map(group => group.id)).toEqual(project.boardGroups.map(group => group.id));
    expect(saved.boardGroups[0].note).toBe('A later description written by the second reader.');
    await other.reload();
    await expect(titles(other)).toHaveText(['First', 'Second', 'Third']);
    expect((await backup(other)).boardGroups).toEqual(saved.boardGroups);
  } finally {
    await otherContext.close();
  }
});

test('competing group orders show readable versions and preserve the local order on resolution', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const project = fixture();
  const response = await page.request.post('/api/rooms', { headers: { 'X-Margin-Local': '1' }, data: { project } });
  expect(response.ok()).toBe(true);
  const room = await response.json();
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  try {
    await join(page, room.id);
    await join(other, room.id);
    await page.context().setOffline(true);
    await moveSecond(page, 'left');
    await moveSecond(other, 'right');
    await page.context().setOffline(false);
    await page.getByRole('button', { name: 'Review conflicting save', exact: true }).click({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Board group order', exact: true })).toBeVisible();
    await expect(page.locator('.conflict-versions pre')).toHaveText(['1. Second\n2. First\n3. Third', '1. First\n2. Third\n3. Second']);
    for (const group of project.boardGroups) await expect(page.locator('.conflict-record')).not.toContainText(group.id);
    await page.getByRole('button', { name: 'Keep local copy & use shared', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(titles(page)).toHaveText(['First', 'Third', 'Second']);
    await expect(titles(other)).toHaveText(['First', 'Third', 'Second']);
    await page.getByRole('button', { name: 'Open project menu', exact: true }).click();
    await page.getByRole('button', { name: /^Everyday places \(local copy\)/ }).click();
    await expect(titles(page)).toHaveText(['Second', 'First', 'Third']);
    expect((await backup(page)).boardGroups.map(group => group.id)).toEqual([
      project.boardGroups[1].id,
      project.boardGroups[0].id,
      project.boardGroups[2].id,
    ]);
  } finally {
    await page.context().setOffline(false);
    await otherContext.close();
  }
});
