import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a project', exact: true }).click();
  await page.getByLabel('Project name').fill('Synthetic autosave project');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await page.getByRole('button', { name: 'New group', exact: true }).click();
  await page.getByLabel('Group name', { exact: true }).fill('Synthetic group');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
}
async function begin(page: Page, text: string) {
  await page.getByRole('button', { name: 'Add note to Synthetic group', exact: true }).click();
  await page.getByLabel('Note', { exact: true }).fill(text);
}
async function recover(page: Page) {
  await page.getByRole('button', { name: 'Review saved drafts', exact: true }).click();
  await page.getByRole('button', { name: 'Restore saved writing', exact: true }).click();
}
async function reloadDraft(page: Page) {
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
}

test('inline board-note typing survives reload and restores its original group', async ({ page }) => {
  await start(page);
  await begin(page, 'An unfinished thought.\nA second line.');
  await expect(page.locator('.writing').getByRole('status')).toContainText('Writing draft saved');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await reloadDraft(page);
  await recover(page);
  await expect(page.getByRole('dialog')).toContainText('No saved writing drafts remain');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Synthetic group quote group' }).locator('.note-words')).toContainText(
    'An unfinished thought.',
  );
  await page.reload();
  await expect(page.locator('.note-words')).toContainText('A second line.');
  await expect(page.getByRole('button', { name: 'Review saved drafts', exact: true })).toHaveCount(0);
});

test('a stale tab keeps its board-note draft and recovery cannot overwrite newer writing', async ({ page, context }) => {
  await start(page);
  await begin(page, 'Original note.');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.note-words')).toHaveText('Original note.');
  const other = await context.newPage();
  await other.goto('/');
  await other.locator('.board-note').click();
  await other.getByLabel('Note', { exact: true }).fill('Writing from the stale tab.');
  await page.locator('.board-note').click();
  await page.getByLabel('Note', { exact: true }).fill('Newer saved writing.');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.note-words')).toHaveText('Newer saved writing.');
  await other.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(other.getByLabel('Note', { exact: true })).toHaveValue('Writing from the stale tab.');
  await expect(other.getByRole('alert')).toContainText('Another tab changed');
  await reloadDraft(other);
  await recover(other);
  await expect(other.getByRole('dialog').getByRole('alert')).toContainText('changed or was removed');
  await other.getByRole('button', { name: 'Save as a separate note', exact: true }).click();
  await other.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(other.locator('.note-words')).toHaveText(['Writing from the stale tab.', 'Newer saved writing.']);
  await other.close();
});

test('interrupted project write keeps the board-note draft recoverable', async ({ page }) => {
  await start(page);
  await begin(page, 'Keep this writing through an interrupted save.');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      if (this.name === 'workspace' && key === 'current') {
        this.transaction.abort();
        throw new DOMException('Synthetic interrupted write', 'AbortError');
      }
      return put.call(this, value, key!);
    };
  });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Keep this writing through an interrupted save.');
  await expect(page.getByRole('alert')).toContainText('could not be saved');
  await reloadDraft(page);
  await recover(page);
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.locator('.note-words')).toHaveText('Keep this writing through an interrupted save.');
});

test('failed browser draft storage exposes a download and guards navigation', async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('margin-writing-v1:')) throw new DOMException('Synthetic quota limit', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await begin(page, 'Writing that only remains in this window.');
  await expect(page.locator('.writing').getByRole('alert')).toContainText('could not be stored');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
  await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Writing that only remains in this window.');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download this writing now', exact: true }).click(),
  ]);
  expect(JSON.parse(await readFile((await download.path())!, 'utf8')).data.text).toBe('Writing that only remains in this window.');
  await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Writing that only remains in this window.');
  // Explicit Done can still save the project when only draft storage is full.
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.note-words')).toHaveText('Writing that only remains in this window.');
});

test('Escape discards only the inline draft, while Done clears recovery after saving', async ({ page }) => {
  await start(page);
  await begin(page, 'Deliberately discarded writing.');
  await page.keyboard.press('Escape');
  await expect(page.locator('.board-note')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Review saved drafts', exact: true })).toHaveCount(0);
  await begin(page, 'Committed writing.');
  await page.keyboard.press('Enter');
  await expect(page.locator('.note-words')).toHaveText('Committed writing.');
  await expect(page.getByRole('button', { name: 'Review saved drafts', exact: true })).toHaveCount(0);
});

test('shared updates wait while an inline editor holds writing that could not be stored', async ({ page }) => {
  await start(page);
  await begin(page, 'Original shared note.');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Work together', exact: true }).click();
  await page.getByRole('button', { name: 'Start local live session' }).click();
  const roomId = await page.getByLabel('Local room ID', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.locator('.board-note').click();
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key.startsWith('margin-writing-v1:')) throw new DOMException('Synthetic quota limit', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  await page.getByLabel('Note', { exact: true }).fill('Only copy in the open editor.');
  const room = await (await page.request.get(`/api/rooms/${roomId}`)).json();
  const remote = structuredClone(room.project);
  remote.boardNotes = [];
  remote.boardGroups.forEach((group: { noteIds?: string[] }) => {
    delete group.noteIds;
  });
  const response = await page.request.put(`/api/rooms/${roomId}`, {
    headers: { 'X-Margin-Local': '1' },
    data: { project: remote, expectedRevision: room.revision },
  });
  expect(response.ok()).toBe(true);
  // Exercise both the live notification and the existing five-second fallback poll.
  await page.waitForTimeout(5500);
  await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Only copy in the open editor.');
  await expect(page.locator('.writing').getByRole('alert')).toContainText('could not be stored');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download this writing now', exact: true }).click(),
  ]);
  expect(JSON.parse(await readFile((await download.path())!, 'utf8')).data.text).toBe('Only copy in the open editor.');
});

test('a failed draft discard keeps the editor and does not claim the project was saved', async ({ page }) => {
  await start(page);
  await begin(page, 'Draft whose removal is blocked.');
  await page.evaluate(() => {
    const remove = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (key: string) {
      if (key.startsWith('margin-writing-v1:')) throw new DOMException('Synthetic denied removal', 'SecurityError');
      return remove.call(this, key);
    };
  });
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Note', { exact: true })).toHaveValue('Draft whose removal is blocked.');
  await expect(page.locator('.writing').getByRole('alert')).toHaveText(
    'This recovery draft could not be removed. It remains available in Draft recovery.',
  );
});
