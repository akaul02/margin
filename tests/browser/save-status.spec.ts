import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

async function start(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Start a project', exact: true }).click();
  await page.getByLabel('Project name').fill('Synthetic autosave project');
  await page.getByRole('button', { name: 'Create project', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('local save status is accessible, survives reload, and backup opens in a fresh profile', async ({ page, browser }) => {
  await start(page);
  await expect(page.getByRole('status').filter({ hasText: 'Project saved in this browser' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Project saved in this browser' })).toBeVisible();
  await page.locator('.tip').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished)));
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByRole('radio', { name: 'Dark', exact: true }).check();
  await page.keyboard.press('Escape');
  // Theme colors transition on buttons as well as the tip. Inspect their settled state.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished),
    ),
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Save backup', exact: true }).focus();
  const [file] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  const raw = await readFile((await file.path())!, 'utf8');
  expect(JSON.parse(raw).name).toBe('Synthetic autosave project');
  const fresh = await browser.newContext();
  try {
    const other = await fresh.newPage();
    await other.goto('/');
    await other.getByRole('button', { name: 'Open a project backup' }).click();
    await other
      .getByLabel('Project backup file')
      .setInputFiles({ name: file.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(raw) });
    await other.getByRole('button', { name: 'Import project', exact: true }).click();
    await expect(other.locator('.project-crumb-name')).toHaveText('Synthetic autosave project');
  } finally {
    await fresh.close();
  }
});

test('interrupted browser transaction never reports success or replaces the saved project', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'New group', exact: true }).click();
  await page.getByLabel('Group name', { exact: true }).fill('Recover this interrupted group');
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === 'current') {
        this.transaction.abort();
        throw new DOMException('Synthetic interrupted write', 'AbortError');
      }
      return put.call(this, value, key);
    };
  });
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.locator('.local-save-bar [role="status"]')).toHaveText('Project save needs attention');
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Nothing was changed');
  page.once('dialog', dialog => dialog.accept());
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: 'Project saved in this browser' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Recover this interrupted group quote group' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review saved drafts' }).click();
  await expect(page.getByRole('dialog')).toContainText('Recover this interrupted group');
});
