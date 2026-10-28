import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
async function demo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try the synthetic demo' }).click();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  await expect(page.getByRole('heading', { name: 'Board', exact: true })).toBeVisible();
}
async function card(page: Page, index = 0) {
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
  await page.getByRole('button', { name: 'Select passage', exact: true }).nth(index).click();
  await page.getByRole('button', { name: 'Use entire turn' }).click();
  await page.getByRole('button', { name: 'Add to Ungrouped', exact: true }).click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Board', exact: true })).toBeVisible();
}
async function group(page: Page, name: string) {
  await page.getByRole('button', { name: 'New group', exact: true }).click();
  await page.getByLabel('Group name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function backup(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Project backup Lossless' }).click()]);
  const raw = await readFile((await dl.path())!, 'utf8');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  return JSON.parse(raw);
}
async function note(page: Page, text: string, by = 'Synthetic reader') {
  await page.locator('.sticky-card').first().getByRole('button', { name: 'Source & notes' }).click();
  await page.getByLabel('Your name', { exact: true }).fill(by);
  await page.getByLabel('Your note', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.locator('.card-comment')).toContainText(text);
  await page.getByRole('button', { name: 'Close dialog' }).click();
}
async function share(page: Page) {
  await page.getByRole('button', { name: 'Work together', exact: true }).click();
  await page.getByRole('button', { name: 'Start local live session' }).click();
  await expect(page.getByLabel('Local room ID', { exact: true })).toBeVisible();
  const id = await page.getByLabel('Local room ID', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  return id;
}
async function join(page: Page, id: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Join a local board', exact: true }).click();
  await page.getByLabel('Local room ID', { exact: true }).fill(id);
  await page.getByRole('button', { name: 'Join board', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Board', exact: true })).toBeVisible();
  await expect(page.locator('.shared-banner')).toContainText('Local shared board');
}

test('board collects uncoded exact quotes, moves with keyboard and drag, and preserves comments', async ({ page }) => {
  await demo(page);
  await card(page);
  await card(page, 1);
  await group(page, 'Feeling at home');
  await group(page, 'Questions to revisit');
  const quotes = await page.locator('.sticky-card blockquote').allTextContents();
  await page
    .locator('.sticky-card')
    .first()
    .getByRole('button', { name: /^Move card:/ })
    .focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Move to group').selectOption({ label: 'Feeling at home' });
  await page.getByRole('button', { name: 'Move card', exact: true }).focus();
  await page.keyboard.press('Enter');
  const first = page.getByRole('region', { name: 'Ungrouped quote group' });
  const dest = page.getByRole('region', { name: 'Feeling at home quote group' });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(dest.locator('.sticky-card')).toHaveCount(1);
  await first.locator('.sticky-card').dragTo(dest.locator('.board-column-head'));
  await expect(dest.locator('.sticky-card')).toHaveCount(2);
  await expect(first.locator('.sticky-card')).toHaveCount(0);
  await note(page, 'Could we discuss the difference between these moments? 🌱');
  await page.locator('#main').focus();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'screenshots/17-quote-board-desktop.png', fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const data = await backup(page);
  expect(data.codes).toHaveLength(0);
  expect(data.quotes.map((q: any) => q.text)).toEqual(quotes);
  expect(data.boardGroups[0].quoteIds).toHaveLength(2);
  expect(data.comments[0].author).toBe('user');
  await page.reload();
  await expect(page.locator('.sticky-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Edit group Feeling at home' }).click();
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Remove group', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ungrouped quote group' }).locator('.sticky-card')).toHaveCount(2);
  expect((await backup(page)).comments).toHaveLength(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Feeling at home quote group' }).locator('.sticky-card')).toHaveCount(2);
});

test('card source context and human notes are distinct; phone and dark modes are accessible', async ({ page }) => {
  await demo(page);
  await card(page);
  await group(page, 'Our discussion');
  await note(page, 'An explicitly human observation.');
  await page.locator('.sticky-card').first().getByRole('button', { name: 'Source & notes' }).click();
  await page.getByText('Show context', { exact: true }).click();
  await expect(page.locator('.quote-context')).toContainText('Interviewer · context only');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'screenshots/18-quote-notes-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByRole('radio', { name: 'Dark' }).check();
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(
    await page
      .locator('.sticky-card')
      .first()
      .evaluate(el => getComputedStyle(el).animationName),
  ).toBe('none');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'screenshots/19-board-phone-dark.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByRole('radio', { name: 'Light' }).check();
  await page.keyboard.press('Escape');
  await page.screenshot({ path: 'screenshots/20-board-phone-light.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('file handoff round-trips board groups, uncoded cards and attributed notes as an independent copy', async ({ page, browser }) => {
  await demo(page);
  await card(page);
  await group(page, 'A connection');
  await note(page, 'A question to pass along.', 'Reader A');
  const before = await backup(page);
  await page.getByRole('button', { name: 'Work together', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText("Copies don't merge back");
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download a copy' }).click()]);
  const raw = await readFile((await dl.path())!, 'utf8');
  await page.screenshot({ path: 'screenshots/21-collaboration-options.png', fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: 'Open a project backup' }).click();
  await other
    .getByLabel('Project backup file')
    .setInputFiles({ name: 'handoff.margin.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
  await other.getByRole('button', { name: 'Import project', exact: true }).click();
  expect(await backup(other)).toEqual(before);
  await group(other, 'A separate local edit');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  expect((await backup(page)).boardGroups).toHaveLength(1);
  expect((await backup(other)).boardGroups).toHaveLength(2);
  await context.close();
});

test('two independent browser clients synchronize groups, quote movement and notes', async ({ page, browser }) => {
  test.setTimeout(60000);
  await demo(page);
  await card(page);
  const id = await share(page);
  const context = await browser.newContext();
  const other = await context.newPage();
  await join(other, id);
  await expect(other.locator('.sticky-card')).toHaveCount(1);
  await group(page, 'Our shared group');
  await expect(other.getByRole('heading', { name: 'Our shared group' })).toBeVisible({ timeout: 12000 });
  await other
    .locator('.sticky-card')
    .first()
    .getByRole('button', { name: /^Move card:/ })
    .click();
  await other.getByLabel('Move to group').selectOption({ label: 'Our shared group' });
  await other.getByRole('button', { name: 'Move card', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Our shared group quote group' }).locator('.sticky-card')).toHaveCount(1, {
    timeout: 12000,
  });
  await note(other, 'A note from the second browser.', 'Reader B');
  await expect(page.locator('.sticky-card').getByRole('button', { name: 'Source & notes' })).toContainText('1', { timeout: 12000 });
  expect((await backup(page)).comments[0].by).toBe('Reader B');
  await page.screenshot({ path: 'screenshots/22-local-shared-board.png', fullPage: true });
  await other.reload();
  await expect(other.locator('.shared-banner')).toContainText('Local shared board');
  await expect(other.locator('.sticky-card')).toHaveCount(1);
  await context.close();
});

test('offline edits retry and independent group creations merge safely', async ({ page, context, browser }) => {
  test.setTimeout(90000);
  await demo(page);
  await card(page);
  const id = await share(page);
  const secondContext = await browser.newContext();
  const other = await secondContext.newPage();
  await join(other, id);
  await context.setOffline(true);
  await group(page, 'Offline but recoverable');
  await expect(page.locator('.shared-banner')).toContainText('not been shared');
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Retry sharing', exact: true }).click();
  await expect(other.getByRole('heading', { name: 'Offline but recoverable' })).toBeVisible({ timeout: 15000 });
  await context.setOffline(true);
  await group(page, 'My independent local idea');
  await group(other, 'Another reader’s saved idea');
  await context.setOffline(false);
  await expect(page.getByRole('heading', { name: 'Another reader’s saved idea' })).toBeVisible({ timeout: 15000 });
  await expect(other.getByRole('heading', { name: 'My independent local idea' })).toBeVisible({ timeout: 15000 });
  expect((await backup(page)).boardGroups).toHaveLength(3);
  await expect(page.getByRole('button', { name: 'Review conflicting save' })).toHaveCount(0);
  await secondContext.close();
});

test('incoming shared updates cannot erase an unsaved note or let Undo erase another reader’s work', async ({ page, browser }) => {
  test.setTimeout(90000);
  await demo(page);
  await card(page);
  const id = await share(page);
  const secondContext = await browser.newContext();
  const other = await secondContext.newPage();
  await join(other, id);
  await group(page, 'My earlier group');
  await expect(other.getByRole('heading', { name: 'My earlier group' })).toBeVisible({ timeout: 12000 });
  await group(other, 'Their later group');
  await expect(page.getByRole('heading', { name: 'Their later group' })).toBeVisible({ timeout: 12000 });
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My earlier group' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Their later group' })).toBeVisible();
  await page.locator('.sticky-card').first().getByRole('button', { name: 'Source & notes' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Reader A');
  await page.getByLabel('Your note', { exact: true }).fill('Keep this unsaved writing.');
  await other.getByRole('button', { name: 'Board', exact: true }).click();
  await other.getByRole('button', { name: 'All quotes', exact: true }).click();
  await other.getByRole('button', { name: 'Remove quote', exact: true }).click();
  await page.waitForTimeout(5500);
  await expect(page.getByLabel('Your note', { exact: true })).toHaveValue('Keep this unsaved writing.');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.locator('.card-comment')).toContainText('Keep this unsaved writing.');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.shared-banner')).toContainText('not been shared');
  await page.getByRole('button', { name: 'Keep local copy & load shared' }).click();
  await page.getByRole('button', { name: 'Open project menu' }).click();
  await page.getByRole('button', { name: /^Everyday places \(local copy\)/ }).click();
  const preserved = await backup(page);
  expect(preserved.comments[0].body).toBe('Keep this unsaved writing.');
  expect(preserved.quotes).toHaveLength(1);
  await secondContext.close();
});

test('a group description opens from its column header and stays accessible', async ({ page }) => {
  await demo(page);
  await card(page);
  await page.getByRole('button', { name: 'New group', exact: true }).click();
  await page.getByLabel('Group name', { exact: true }).fill('Paper · Feeling welcome');
  await page.getByLabel('Description', { exact: true }).fill('What the paper says about feeling welcome.\n\nA second paragraph.');
  await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const column = page.getByRole('region', { name: 'Paper · Feeling welcome quote group' }),
    toggle = column.locator('.group-toggle');
  await expect(column.getByRole('heading')).toHaveText('Paper · Feeling welcome');
  await expect(toggle).toHaveText('Read more');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.group-note')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle).toHaveText('Show less');
  await expect(page.locator('.group-note p')).toHaveText(['What the paper says about feeling welcome.', 'A second paragraph.']);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await column.locator('.board-column-head h2').click();
  await expect(page.locator('.group-note')).toHaveCount(0);
  const saved = (await backup(page)).boardGroups.find((g: any) => g.title === 'Paper · Feeling welcome');
  expect(saved.note).toBe('What the paper says about feeling welcome.\n\nA second paragraph.');
});
test('the board is a wall of groups with a map on top, and notes can be written, edited, moved and deleted on it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await demo(page);
  await card(page);
  for (const name of ['First group', 'Second group', 'Third group', 'Fourth group']) await group(page, name);
  const columns = page.locator('.board-wall .board-group'),
    head = async (i: number) => (await columns.nth(i).locator('.board-column-head').boundingBox())!;
  await expect(columns).toHaveCount(5);
  const [a, b] = [await head(0), await head(1)];
  expect(b.y).toBe(a.y);
  expect(b.x).toBeGreaterThan(a.x + a.width);
  const tiles = page.getByRole('navigation', { name: 'Map of the board' }).getByRole('button');
  await expect(tiles).toHaveCount(5);
  const fourth = page.getByRole('region', { name: 'Fourth group quote group' });
  await fourth.getByRole('button', { name: 'Add note to Fourth group' }).click();
  await page.getByLabel('Note', { exact: true }).fill('People route around links.');
  await page.keyboard.press('Enter');
  await expect(fourth.locator('.board-note .note-words')).toHaveText('People route around links.');
  await expect(fourth.locator('.group-meta')).toHaveText('0 quotes · 1 note');
  await fourth.locator('.board-note').click();
  await page.getByLabel('Note', { exact: true }).fill('People route around unknown links.');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(fourth.locator('.note-words')).toHaveText('People route around unknown links.');
  await fourth.getByRole('button', { name: 'Add note to Fourth group' }).click();
  await page.getByLabel('Note', { exact: true }).fill('Not this one.');
  await page.keyboard.press('Escape');
  await expect(fourth.locator('.board-note')).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await fourth.getByRole('button', { name: /^Move note:/ }).click();
  await page.getByLabel('Move to group').selectOption({ label: 'Second group' });
  await page.getByRole('button', { name: 'Move note', exact: true }).click();
  const second = page.getByRole('region', { name: 'Second group quote group' });
  await expect(second.locator('.board-note')).toHaveCount(1);
  await expect(fourth.locator('.board-note')).toHaveCount(0);
  await page.getByRole('region', { name: 'Ungrouped quote group' }).locator('.sticky-card').dragTo(tiles.nth(3));
  await expect(page.getByRole('region', { name: 'Third group quote group' }).locator('.sticky-card')).toHaveCount(1);
  const saved = await backup(page);
  expect(saved.boardNotes).toHaveLength(1);
  expect(saved.boardGroups.find((g: any) => g.title === 'Second group').noteIds).toEqual([saved.boardNotes[0].id]);
  await page.reload();
  await expect(second.locator('.note-words')).toHaveText('People route around unknown links.');
  await second.locator('.board-note').click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(second.locator('.board-note')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(second.locator('.board-note')).toHaveCount(1);
});
