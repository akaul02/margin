import { test, expect, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { newProject, makeTranscript } from '../../src/model';
const USER_B = '00000000-0000-4000-8000-000000000002';
const AUTH_KEY = 'margin-auth:http://127.0.0.1:5391';
async function signIn(page: Page, person = 'a') {
  await page.getByLabel('Email', { exact: true }).fill(`reader-${person}@example.invalid`);
  await page.getByLabel('Password', { exact: true }).fill('synthetic-only-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
}
async function demo(page: Page) {
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: 'Try the synthetic demo' }).click();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
}
async function card(page: Page) {
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
  await page.getByRole('button', { name: 'Select passage', exact: true }).first().click();
  await page.getByRole('button', { name: 'Use entire turn' }).click();
  await page.getByRole('button', { name: 'Add to Ungrouped', exact: true }).click();
  await page.getByRole('button', { name: 'Board', exact: true }).click();
  await expect(page.locator('.sticky-card')).toHaveCount(1);
}
async function share(page: Page, member?: string) {
  await page.getByRole('button', { name: 'Work together', exact: true }).click();
  await page.getByRole('button', { name: 'Share this project', exact: true }).click();
  const field = page.getByLabel('Shared room ID', { exact: true });
  await expect(field).toBeVisible();
  const id = await field.inputValue();
  if (member) {
    await page.getByLabel('Member account ID', { exact: true }).fill(member);
    await page.getByRole('button', { name: 'Add editor', exact: true }).click();
    await expect(page.locator('.member-list')).toContainText(member);
  }
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  return id;
}
async function join(page: Page, id: string) {
  await page.getByRole('button', { name: 'Open a shared board', exact: true }).click();
  await page.getByLabel('Or enter a shared room ID', { exact: true }).fill(id);
  await page.getByRole('button', { name: 'Open board', exact: true }).click();
  await expect(page.locator('.shared-banner')).toContainText('Shared project');
}
async function note(page: Page, text: string) {
  await page.locator('.sticky-card').first().getByRole('button', { name: 'Source & notes' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Synthetic reader');
  await page.getByLabel('Your note', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.locator('.card-comment').filter({ hasText: text })).toHaveCount(1);
  await page.getByRole('button', { name: 'Close dialog' }).click();
}
async function backup(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Project backup Lossless' }).click()]);
  const raw = await readFile((await dl.path())!, 'utf8');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  return JSON.parse(raw);
}
async function reconfirm(page: Page) {
  await page.evaluate(key => {
    const channel = new BroadcastChannel(key);
    channel.postMessage({ event: 'SIGNED_IN', session: JSON.parse(localStorage.getItem(key)!) });
    channel.close();
  }, AUTH_KEY);
}

test('sign-in is accessible on desktop and phone; rejected sign-in never opens a workspace', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'screenshots/hosted-sign-in-desktop.png', fullPage: true });
  await page.getByLabel('Email', { exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.getByLabel('Email', { exact: true }).fill('reader-a@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('wrong-synthetic-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Sign-in failed');
  await expect(page.getByRole('button', { name: 'Try the synthetic demo' })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'screenshots/hosted-sign-in-phone.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('members collaborate with exact quotes; revoked access preserves a recoverable browser copy', async ({ page, browser }) => {
  test.setTimeout(75000);
  await demo(page);
  await card(page);
  const id = await share(page, USER_B);
  const context = await browser.newContext(),
    other = await context.newPage();
  await other.goto('/');
  await signIn(other, 'b');
  await join(other, id);
  await expect(other.locator('.sticky-card')).toHaveCount(1);
  await note(other, 'A human-authored synthetic note from the second reader.');
  await expect(page.locator('.sticky-card').getByRole('button', { name: 'Source & notes' })).toContainText('1', { timeout: 15000 });
  const copy = await backup(page);
  expect(copy.comments[0].author).toBe('user');
  expect(copy.transcripts.find((t: any) => t.id === copy.quotes[0].transcriptId).text.slice(copy.quotes[0].start, copy.quotes[0].end)).toBe(
    copy.quotes[0].text,
  );
  await page.getByRole('button', { name: 'Work together', exact: true }).click();
  await expect(page.locator('.member-list')).toContainText(USER_B);
  await page.getByLabel('Member account ID', { exact: true }).focus();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'screenshots/hosted-members-desktop.png', fullPage: true });
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Remove member', exact: true }).click();
  await expect(page.locator('.member-list')).not.toContainText(USER_B);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await note(other, 'Kept locally after membership was removed.');
  await expect(other.locator('.shared-banner')).toContainText('no longer has access');
  const preserved = await backup(other);
  expect(preserved.comments.some((n: any) => n.body === 'Kept locally after membership was removed.')).toBe(true);
  expect((await backup(page)).comments).toHaveLength(1);
  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByRole('radio', { name: 'Dark' }).check();
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.locator('.sticky-card').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: 'screenshots/hosted-board-phone-dark.png', fullPage: true });
  await context.close();
});

test('a lost successful response retries from persisted outbox after refresh exactly once', async ({ page }) => {
  await demo(page);
  await card(page);
  const id = await share(page);
  let dropped = false;
  await page.route(`**/api/rooms/${id}/operations`, async route => {
    if (!dropped) {
      dropped = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort();
    } else await route.continue();
  });
  await note(page, 'Durable synthetic edit after a lost response.');
  await expect(page.locator('.shared-banner')).toContainText('not been shared');
  await page.reload();
  await expect(page.locator('.shared-banner')).toContainText('Shared project');
  await expect(page.locator('.shared-banner')).not.toContainText('not been shared');
  const saved = await backup(page);
  expect(saved.comments.filter((n: any) => n.body === 'Durable synthetic edit after a lost response.')).toHaveLength(1);
});

test('account switches isolate saved projects, drafts and delayed network completion', async ({ page }) => {
  await demo(page);
  await card(page);
  const id = await share(page);
  await page.locator('.sticky-card').getByRole('button', { name: 'Source & notes' }).click();
  await page.getByLabel('Your name', { exact: true }).fill('Account A');
  await page.getByLabel('Your note', { exact: true }).fill('Private synthetic A draft');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.draft-banner')).toContainText('1 saved writing draft');
  let held: Route | undefined;
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  await page.route(`**/api/rooms/${id}`, async route => {
    if (route.request().method() === 'GET' && !held) {
      held = route;
      const response = await route.fetch();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    } else await route.continue();
  });
  // Trigger the ordinary ten-second poll; the original account remains bound
  // to this outstanding request even after another account signs in.
  await expect.poll(() => !!held, { timeout: 15000 }).toBe(true);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await signIn(page, 'b');
  release();
  await expect(page.getByRole('button', { name: 'Start a project' })).toBeVisible();
  await expect(page.locator('.sticky-card')).toHaveCount(0);
  await expect(page.locator('.draft-banner')).toHaveCount(0);
  await expect(page.getByText('Private synthetic A draft', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try the synthetic demo' }).click();
  await page.getByRole('button', { name: 'Skip tutorial' }).click();
  expect((await backup(page)).quotes).toHaveLength(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await signIn(page, 'a');
  await expect(page.locator('.sticky-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Review saved drafts' }).click();
  await expect(page.getByRole('dialog')).toContainText('Private synthetic A draft');
});

test('same-account session reconfirmation keeps an open pasted transcript and keyboard focus', async ({ page }) => {
  await demo(page);
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
  await page.getByRole('button', { name: 'Import transcript', exact: true }).click();
  await page.getByLabel('Transcript name', { exact: true }).fill('Synthetic unfinished import');
  await page.getByLabel('Transcript text', { exact: true }).fill('Participant: These exact words stay while I change tabs.');
  const verification = page.waitForResponse(r => r.url().includes('/auth/v1/user'));
  await reconfirm(page);
  await verification;
  await expect(page.getByLabel('Transcript text', { exact: true })).toHaveValue('Participant: These exact words stay while I change tabs.');
  await expect(page.getByLabel('Transcript text', { exact: true })).toBeFocused();
  await page.screenshot({ path: 'screenshots/hosted-preserved-import.png', fullPage: true });
});

test('delayed logout blocks late verification and new sign-in until logout finishes', async ({ page }) => {
  await demo(page);
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  let logout = false;
  await page.route('**/auth/v1/logout*', async route => {
    logout = true;
    await gate;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect.poll(() => logout).toBe(true);
  await reconfirm(page);
  await expect(page.getByRole('button', { name: 'Signing out…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  release();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await signIn(page, 'b');
  await expect(page.getByRole('button', { name: 'Start a project' })).toBeVisible();
});

test('signing out in another tab locks the old account instead of displaying cached projects', async ({ page, context }) => {
  await demo(page);
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: 'Board', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(second.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Board', exact: true })).toHaveCount(0);
});

test('a cached user object with an invalid token cannot authorize browser storage', async ({ page }) => {
  await demo(page);
  await page.evaluate(key => {
    const session = JSON.parse(localStorage.getItem(key)!);
    session.access_token = 'synthetic.invalid.token';
    localStorage.setItem(key, JSON.stringify(session));
  }, AUTH_KEY);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Board', exact: true })).toHaveCount(0);
});

test('oversized local projects remain exportable and never enter the hosted creation queue', async ({ page }) => {
  const project = newProject('Large synthetic fixture', true);
  project.transcripts = [
    makeTranscript('Synthetic A', 'Participant: ' + 'a'.repeat(790000)),
    makeTranscript('Synthetic B', 'Participant: ' + 'b'.repeat(790000)),
  ];
  await page.goto('/');
  await signIn(page);
  await page.getByRole('button', { name: 'Open a project backup' }).click();
  await page
    .getByLabel('Project backup file')
    .setInputFiles({ name: 'synthetic-large.margin.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.getByRole('button', { name: 'Import project', exact: true }).click();
  let creates = 0;
  page.on('request', r => {
    if (r.url().endsWith('/api/rooms') && r.method() === 'POST') creates++;
  });
  await page.getByRole('button', { name: 'Work together', exact: true }).click();
  await page.getByRole('button', { name: 'Share this project', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('1.5 MB');
  expect(creates).toBe(0);
  await expect(page.getByLabel('Shared room ID', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  expect(await backup(page)).toEqual(project);
  await page.reload();
  await expect(page.locator('.shared-banner')).toHaveCount(0);
});

test('temporary verification failures keep already-verified local writing without installing a new token', async ({ page }) => {
  await demo(page);
  await page.getByRole('button', { name: 'Transcripts', exact: true }).click();
  await page.getByRole('button', { name: 'Import transcript', exact: true }).click();
  await page.getByLabel('Transcript name', { exact: true }).fill('Synthetic offline writing');
  await page.getByLabel('Transcript text', { exact: true }).fill('Participant: My exact unfinished words remain.');
  await page.route('**/auth/v1/user', route => route.abort());
  await reconfirm(page);
  await expect(page.getByRole('region', { name: 'Signed-in account' })).toContainText('Offline:', { timeout: 10000 });
  await expect(page.getByLabel('Transcript text', { exact: true })).toHaveValue('Participant: My exact unfinished words remain.');
  await page.unroute('**/auth/v1/user');
  const verified = page.waitForResponse(r => r.url().includes('/auth/v1/user'));
  await reconfirm(page);
  await verified;
  await expect(page.getByRole('region', { name: 'Signed-in account' })).not.toContainText('Offline:');
  await expect(page.getByLabel('Transcript text', { exact: true })).toHaveValue('Participant: My exact unfinished words remain.');
});
