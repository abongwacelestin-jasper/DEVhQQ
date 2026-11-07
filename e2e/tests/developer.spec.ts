/**
 * Persona: Kofi Mensah, Developer on RenewBerry (Repository: contribute, Deployment: view,
 * Administration: none).
 * "I open My work, move my task from backlog to done, and read and edit the docs I'm
 *  allowed to. Admin pages are closed to me, even by typing the URL."
 */
import { test, expect, uid } from '../support/fixtures';
import { signInViaApi } from '../support/auth';

test.describe('Developer journey', () => {
  test('My work lists my tasks and a task moves through every status @smoke', async ({ page }) => {
    await signInViaApi(page, 'developer');
    await expect(page).toHaveURL(/\/my-work$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My work' })).toBeVisible();

    // Make a fresh task of my own so parallel journeys never fight over seed data.
    const title = `Dev flow ${uid()}`;
    const created = await page.request.post('/api/tasks', {
      data: { title, projectId: await firstProject(page), assignee: 'm4', status: 'backlog', priority: 'medium', type: 'feature', estimate: 2, due: '2026-12-31' },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { key } = (await created.json()) as { key: string };
    await page.reload();

    const status = page.getByRole('combobox', { name: `Status of ${key}` });
    await expect(status).toBeVisible();
    for (const [value, label] of [
      ['in-progress', 'In progress'],
      ['review', 'In review'],
    ] as const) {
      await status.selectOption(value);
      await expect(page.getByText(`${key} → ${label}`).first()).toBeVisible();
      await expect.poll(async () => (await (await page.request.get(`/api/tasks/${key}`)).json()).status).toBe(value);
    }
    // Business rule (BOARD gate): you cannot close your own task; a reviewer or manager does.
    const refused = page.waitForResponse((r) => r.url().endsWith(`/api/tasks/${key}`) && r.request().method() === 'PATCH');
    await status.selectOption('done');
    expect((await refused).status()).toBe(403);
    await expect(page.getByText(/reviewer or manager/i).first()).toBeVisible();
    await expect(status, 'the select snaps back to the server value').toHaveValue('review');
    expect((await (await page.request.get(`/api/tasks/${key}`)).json()).status).toBe('review');
  });

  test('My work does not announce a status change the server refused', async ({ page }) => {
    test.fail(true, 'QA-029: the "KEY → Done" success toast fires before the API answers, so a refused self-close is announced');
    await signInViaApi(page, 'developer');
    const created = await page.request.post('/api/tasks', {
      data: { title: `Self close ${uid()}`, projectId: await firstProject(page), assignee: 'm4', status: 'review', priority: 'low', type: 'task', estimate: 1, due: '2026-12-31' },
    });
    const { key } = (await created.json()) as { key: string };
    await page.reload();
    await page.getByRole('combobox', { name: `Status of ${key}` }).selectOption('done');
    await page.waitForTimeout(1500);
    await expect(page.getByText(`${key} → Done`)).toHaveCount(0);
  });

  for (const path of ['/audit', '/security', '/integrations', '/workspaces']) {
    test(`direct URL ${path} shows the no-access page, not data`, async ({ page }) => {
      await signInViaApi(page, 'developer', path);
      await expect(page.getByText('403 · No access')).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: /isn’t part of the Developer view/ })).toBeVisible();
      await expect(page.getByRole('link', { name: /^Back to / })).toBeVisible();
    });
  }

  test('the audit trail API is closed to a Developer', async ({ page }) => {
    test.fail(true, 'QA-028 (S1): GET /api/audit has no requireArea guard; any member reads the whole sensitive trail, all products');
    await signInViaApi(page, 'developer');
    expect((await page.request.get('/api/audit?sensitive=1&limit=5')).status()).toBe(403);
  });

  test('the API refuses admin data too (not only the UI)', async ({ page }) => {
    await signInViaApi(page, 'developer');
    expect((await page.request.get('/api/access/grants')).status()).toBe(403);
    expect((await page.request.patch('/api/team/m12', { data: { role: 'Tester' } })).status()).toBe(403);
  });

  test('“Request access” on the no-access page reaches an admin', async ({ page }) => {
    test.fail(true, 'QA-010: request is only written to the tab’s local event list; no API call, no admin sees it');
    await signInViaApi(page, 'developer', '/audit');
    const calls: string[] = [];
    page.on('request', (r) => r.method() !== 'GET' && r.url().includes('/api/') && calls.push(r.url()));
    await page.getByRole('textbox', { name: 'Reason' }).fill('QA: need audit for incident review');
    await page.getByRole('button', { name: 'Request access' }).click();
    await expect(page.getByText('Request sent')).toBeVisible();
    expect(calls, 'an API call records the request').not.toEqual([]);
  });

  test('reads docs and edits one it is allowed to; the edit survives a reload', async ({ page }) => {
    await signInViaApi(page, 'developer', '/docs');
    await expect(page.getByRole('heading', { level: 1, name: 'Docs' })).toBeVisible();
    const docs = (await (await page.request.get('/api/docs')).json()) as { id: string; title: string; visibility: string; editors?: string[] }[];
    expect(docs.length).toBeGreaterThan(0);
    const doc = docs.find((d) => d.visibility !== 'restricted') ?? docs[0];

    await page.goto(`/docs/${doc.id}`);
    await expect(page.getByText(doc.title).first()).toBeVisible();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const marker = `QA edit ${uid()}`;
    const body = page.getByRole('textbox', { name: 'Doc content' });
    await body.press('ControlOrMeta+End');
    await body.pressSequentially(`\n\n${marker}`);
    await page.getByPlaceholder('What changed? (shown in history)').fill('QA beta check');
    await page.getByRole('button', { name: 'Save version' }).click();
    await expect(page.getByText('Saved').first()).toBeVisible();

    await page.reload();
    await expect(page.getByText(marker)).toBeVisible();
  });
});

async function firstProject(page: import('@playwright/test').Page) {
  const res = await page.request.get('/api/projects');
  const list = (await res.json()) as { id: string; product: string }[] | { items: { id: string; product: string }[] };
  const rows = Array.isArray(list) ? list : list.items;
  return rows.find((p) => p.product === 'renewberry')!.id;
}
