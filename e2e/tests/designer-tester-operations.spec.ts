/**
 * Personas: Inès Moreau (Designer), Ravi Patel (Tester), Grace Liu (Operations).
 */
import { test, expect, uid } from '../support/fixtures';
import { signInViaApi } from '../support/auth';

test.describe('Designer journey', () => {
  test('lands on My work and can create a design task for herself', async ({ page }) => {
    await signInViaApi(page, 'designer');
    await expect(page).toHaveURL(/\/my-work$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My work' })).toBeVisible();
    const title = `Design review ${uid()}`;
    await page.getByRole('button', { name: 'New task for me' }).click();
    const modal = page.getByRole('dialog', { name: 'New task' });
    await modal.getByRole('textbox', { name: 'Title' }).fill(title);
    await modal.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText(/^[A-Z]+-\d+ created$/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  });

  test('has no deployment access (Deployment: none) in the UI or the API', async ({ page }) => {
    await signInViaApi(page, 'designer', '/deployments');
    await expect(page.getByText('403 · No access')).toBeVisible();
    expect((await page.request.get('/api/deployments')).status()).toBe(403);
  });
});

test.describe('Tester journey', () => {
  test('works the test queue: fail sends a task back to the assignee @smoke', async ({ page }) => {
    await signInViaApi(page, 'tester');
    await expect(page).toHaveURL(/\/test-queue$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Test queue' })).toBeVisible();

    const failButtons = page.getByRole('button', { name: 'Fail', exact: true });
    await expect(failButtons.first()).toBeVisible();
    const row = page.getByRole('listitem').filter({ has: failButtons.first() }).first();
    const key = (await row.textContent())!.match(/[A-Z]+-\d+/)![0];
    await row.getByRole('button', { name: 'Fail', exact: true }).click();
    await expect(page.getByText(`${key} sent back`)).toBeVisible();
    await expect.poll(async () => (await (await page.request.get(`/api/tasks/${key}`)).json()).status).toBe('in-progress');
  });

  test('passing a task takes it out of the queue', async ({ page }) => {
    test.fail(true, 'QA-011: Pass only adds a comment; the task stays “In review” and can be passed again');
    await signInViaApi(page, 'tester', '/test-queue');
    const pass = page.getByRole('button', { name: 'Pass', exact: true });
    await expect(pass.first()).toBeVisible();
    const row = page.getByRole('listitem').filter({ has: pass.first() }).first();
    const key = (await row.textContent())!.match(/[A-Z]+-\d+/)![0];
    await row.getByRole('button', { name: 'Pass', exact: true }).click();
    await expect(page.getByText(`${key} passed testing`)).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: key }).getByRole('button', { name: 'Pass' })).toHaveCount(0);
  });

  test('reports a bug from the queue', async ({ page }) => {
    await signInViaApi(page, 'tester', '/test-queue');
    await page.getByRole('button', { name: 'Report bug' }).click();
    const modal = page.getByRole('dialog', { name: 'New task' });
    const title = `Bug ${uid()}`;
    await modal.getByRole('textbox', { name: 'Title' }).fill(title);
    const assignee = modal.getByRole('combobox', { name: /^Assignee/ });
    const opts = await assignee.locator('option').allTextContents();
    await assignee.selectOption({ index: Math.min(1, opts.length - 1) });
    await modal.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText(/^[A-Z]+-\d+ created$/).first()).toBeVisible();
  });
});

test.describe('Operations journey', () => {
  test('declares, updates and resolves an incident; the server records each step @smoke', async ({ page }) => {
    await signInViaApi(page, 'operations');
    await expect(page).toHaveURL(/\/incidents$/);
    const title = `QA outage ${uid()}`;
    await page.getByRole('button', { name: 'Declare incident' }).click();
    const modal = page.getByRole('dialog', { name: 'Declare an incident' });
    await modal.getByRole('textbox', { name: /What’s happening/ }).fill(title);
    await modal.getByRole('button', { name: /^Declare SEV/ }).click();

    await expect(page).toHaveURL(/\/incidents\/[\w-]+$/);
    const id = page.url().split('/').pop()!;
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

    const note = `Rolled back the CDN config ${uid()}`;
    await page.getByRole('textbox', { name: 'Timeline note' }).fill(note);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(note)).toBeVisible();

    await page.getByRole('button', { name: 'Mitigated · monitor' }).click();
    await expect.poll(async () => (await (await page.request.get(`/api/incidents/${id}`)).json()).status).toBe('monitoring');

    await page.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByText(`${id} resolved`)).toBeVisible();
    await expect.poll(async () => (await (await page.request.get(`/api/incidents/${id}`)).json()).status).toBe('resolved');

    await page.reload();
    await expect(page.getByText(note)).toBeVisible();
  });

  test('“Post update” and “Escalate” reach a real channel', async ({ page }) => {
    test.fail(true, 'QA-013: both only append a local timeline row and toast; no status page, chat or page-out exists');
    await signInViaApi(page, 'operations', '/incidents');
    const calls: string[] = [];
    page.on('request', (r) => r.method() !== 'GET' && r.url().includes('/api/') && calls.push(r.url()));
    await page.getByRole('button', { name: 'Declare incident' }).click();
    const modal = page.getByRole('dialog', { name: 'Declare an incident' });
    await modal.getByRole('textbox', { name: /What’s happening/ }).fill(`Escalation check ${uid()}`);
    await modal.getByRole('button', { name: /^Declare SEV/ }).click();
    await expect(page).toHaveURL(/\/incidents\/[\w-]+$/);
    calls.length = 0;
    await page.getByRole('button', { name: 'Post update' }).click();
    await page.getByRole('button', { name: 'Escalate' }).click();
    await page.waitForTimeout(500);
    expect(calls.length, 'post update + escalate call the API').toBeGreaterThanOrEqual(2);
  });

  test('sees deployments across all three products', async ({ page }) => {
    await signInViaApi(page, 'operations', '/deployments');
    await expect(page.getByRole('heading', { level: 1, name: 'Deployments' })).toBeVisible();
    const rows = (await (await page.request.get('/api/deployments')).json()) as { product: string }[];
    expect(new Set(rows.map((r) => r.product))).toEqual(new Set(['renewberry', 'blog', 'mirror']));
  });
});
