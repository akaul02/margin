import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { demoProject } from '../../src/demo';
import { exportProject, renameProject, type Project } from '../../src/model';

// These tests run against a Margin server that saves to a SQLite file in a temporary folder.
test.describe.configure({ mode: 'serial' });
const dataDir = process.env.MARGIN_TEST_DATA_DIR!;
const key = () => readFileSync(join(dataDir, 'key'), 'utf8').trim();
function savedProjects(): string[] {
  const db = new DatabaseSync(join(dataDir, 'margin.sqlite'), { readOnly: true });
  const row = db.prepare("SELECT value FROM entries WHERE key = 'current'").get() as { value: string } | undefined;
  db.close();
  return row ? JSON.parse(row.value).projects.map((p: Project) => p.name) : [];
}
async function putInBrowser(page: Page, value: unknown) {
  await page.evaluate(
    async value =>
      await new Promise<void>((resolve, reject) => {
        const r = indexedDB.open('ceal-margin-local', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('workspace');
        r.onsuccess = () => {
          const tx = r.result.transaction('workspace', 'readwrite');
          tx.objectStore('workspace').put(value, 'current');
          tx.oncomplete = () => {
            r.result.close();
            resolve();
          };
          tx.onabort = () => reject(tx.error);
        };
      }),
    value,
  );
}
async function importProject(page: Page, p: Project) {
  await page.getByRole('button', { name: 'Open a project backup' }).click();
  await page
    .getByLabel('Project backup file')
    .setInputFiles({ name: 'synthetic.margin.json', mimeType: 'application/json', buffer: Buffer.from(exportProject(p)) });
  await page.getByRole('button', { name: 'Import project', exact: true }).click();
}

test('without the key, a browser cannot open the data file', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your saved work is protected.' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText("This browser doesn't have Margin's key yet");
  expect(savedProjects()).toEqual([]);
});

test('moves a browser’s saved projects into the data file once', async ({ page }) => {
  const p = demoProject(true);
  renameProject(p, 'Saved in the browser before');
  await page.goto('/');
  await putInBrowser(page, { projects: [p], activeId: p.id, revision: 'browser-revision' });
  // The same tab, as when someone opens the link while Margin shows the lock screen.
  await page.goto(`/#key=${key()}`);
  await expect(page.getByText("Moved 1 project from this browser into Margin's data file")).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  expect(savedProjects()).toEqual(['Saved in the browser before']);
  await page.reload();
  await expect(page.getByText('Moved 1 project')).toHaveCount(0);
  expect(savedProjects()).toEqual(['Saved in the browser before']);
});

test('work saves to the file and survives clearing the browser', async ({ page, browser }) => {
  await page.goto(`/#key=${key()}`);
  await page.getByRole('link', { name: 'Margin home' }).click();
  const p = demoProject(true);
  renameProject(p, 'Written in the data file');
  await importProject(page, p);
  await expect.poll(savedProjects).toContain('Written in the data file');

  // A brand-new browser profile with the key sees the same projects.
  const fresh = await browser.newContext();
  const other = await fresh.newPage();
  await other.goto(`/#key=${key()}`);
  await expect(other.getByText('Written in the data file').first()).toBeVisible();
  await fresh.close();

  // Clearing this browser's storage leaves the file alone.
  await page.evaluate(() => new Promise(resolve => (indexedDB.deleteDatabase('ceal-margin-local').onsuccess = resolve)));
  await page.reload();
  await expect(page.getByText('Written in the data file').first()).toBeVisible();
  expect(savedProjects()).toContain('Written in the data file');
  expect(savedProjects()).toContain('Saved in the browser before');
});

test('the export dialog says where the file is', async ({ page }) => {
  await page.goto(`/#key=${key()}`);
  await page.getByRole('button', { name: 'Help and keyboard guide' }).click();
  await expect(page.getByText(`Everything saves to ${join(dataDir, 'margin.sqlite')} on this computer.`)).toBeVisible();
});

test('restore points are kept in the file and can be restored', async ({ page }) => {
  await page.goto(`/#key=${key()}`);
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await page.getByRole('button', { name: 'New group', exact: true }).click();
  await page.getByLabel('Group name', { exact: true }).fill('A group to undo');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByRole('button', { name: 'Review restore' }).first().click();
  await page.getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByText('A group to undo')).toHaveCount(0);
});
