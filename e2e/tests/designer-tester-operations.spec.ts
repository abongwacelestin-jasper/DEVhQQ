/**
 * Personas: Inès Moreau (Designer), Ravi Patel (Tester), Grace Liu (Operations).
 */
import AxeBuilder from '@axe-core/playwright';
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
    // QA-011 is fixed: Pass moves the task to Done (server-confirmed) and records a comment.
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
    await modal.getByRole('textbox', { name: /^Impact/ }).fill('About 5% of checkout attempts fail in the EU.');
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

  test('incident timeline notes and status changes are stored on the server', async ({ page }) => {
    // QA-013 is closed: the local-only "Post update" / "Escalate" buttons were removed in wave 4;
    // every remaining incident action is written through the API.
    await signInViaApi(page, 'operations', '/incidents');
    await page.getByRole('button', { name: 'Declare incident' }).click();
    const modal = page.getByRole('dialog', { name: 'Declare an incident' });
    await modal.getByRole('textbox', { name: /What’s happening/ }).fill(`Escalation check ${uid()}`);
    await modal.getByRole('textbox', { name: /^Impact/ }).fill('Internal check, no customer impact.');
    await modal.getByRole('button', { name: /^Declare SEV/ }).click();
    await expect(page).toHaveURL(/\/incidents\/[\w-]+$/);
    const id = page.url().split('/').pop()!;
    const note = `Paged the on-call ${uid()}`;
    await page.getByRole('textbox', { name: 'Timeline note' }).fill(note);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: /Mitigated/ }).click();
    await expect
      .poll(async () => (await (await page.request.get(`/api/incidents/${id}`)).json()).status)
      .toBe('monitoring');
    await page.reload();
    await expect(page.getByText(note).first()).toBeVisible();
    expect(JSON.stringify(await (await page.request.get(`/api/incidents/${id}`)).json())).toContain(note);
  });

  test('records a mitigation step, assigns it, completes it; the server keeps it @smoke', async ({ page }) => {
    await signInViaApi(page, 'operations', '/incidents');
    await page.getByRole('button', { name: 'Declare incident' }).click();
    const modal = page.getByRole('dialog', { name: 'Declare an incident' });
    await modal.getByRole('textbox', { name: /What’s happening/ }).fill(`Payments timeout ${uid()}`);
    await modal.getByRole('textbox', { name: /^Impact/ }).fill('Card payments time out for about 10% of users.');
    await modal.getByRole('button', { name: /^Declare SEV/ }).click();
    await expect(page).toHaveURL(/\/incidents\/[\w-]+$/);
    const id = page.url().split('/').pop()!;

    const form = page.getByRole('form', { name: 'Add a recovery step' });
    const step = `Fail over to the backup gateway ${uid()}`;
    await form.getByRole('textbox', { name: 'Step' }).fill(step);
    await form.getByRole('combobox', { name: 'Owner' }).selectOption({ label: 'Kofi Mensah' });
    await expect(form.getByRole('combobox', { name: 'Kind' })).toHaveValue('mitigation');
    await form.getByRole('button', { name: 'Add step' }).click();
    await expect(page.getByText('Mitigation step added')).toBeVisible();
    const mitigation = page.getByRole('region', { name: /^Mitigation/ });
    const box = mitigation.getByRole('checkbox', { name: new RegExp(step) });
    await expect(box).not.toBeChecked();

    type Action = { title: string; owner: string; status: string; kind: string; doneAt: string | null };
    const actions = async () =>
      (await (await page.request.get(`/api/incidents/${id}/actions`)).json()) as Action[];
    const saved = (await actions()).find((a) => a.title === step);
    expect(saved).toMatchObject({ owner: 'm4', status: 'open', kind: 'mitigation', doneAt: null });

    // Not optimistic: the box ticks once the server has accepted the change (so click, not check()).
    await box.click();
    await expect(page.getByText(`“${step}” done`)).toBeVisible();
    await expect(box).toBeChecked();
    await expect.poll(async () => (await actions()).find((a) => a.title === step)?.status).toBe('done');

    await page.reload();
    await expect(page.getByRole('region', { name: /^Mitigation/ }).getByRole('checkbox', { name: new RegExp(step) })).toBeChecked();
    await expect(page.getByText(/^Action completed: /).first()).toBeVisible();

    const done = (await actions()).find((a) => a.title === step)!;
    expect(done.doneAt).toBeTruthy();
    const incident = (await (await page.request.get(`/api/incidents/${id}`)).json()) as { timeline: { note: string }[] };
    const notes = incident.timeline.map((t) => t.note);
    expect(notes.some((n) => n.startsWith('Action added · Mitigation:') && n.includes('Kofi Mensah'))).toBe(true);
    expect(notes.some((n) => n.startsWith('Action completed:'))).toBe(true);
    const list = (await (await page.request.get('/api/incidents')).json()) as { id: string; openActions: number }[];
    expect(list.find((i) => i.id === id)?.openActions).toBe(0);

    // The Recovery panel with a real list is clean of critical axe violations.
    const axe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('[data-sonner-toaster]')
      .analyze();
    expect(axe.violations.filter((v) => v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });

  test('sees deployments across all three products', async ({ page }) => {
    await signInViaApi(page, 'operations', '/deployments');
    await expect(page.getByRole('heading', { level: 1, name: 'Deployments' })).toBeVisible();
    const rows = (await (await page.request.get('/api/deployments')).json()) as { product: string }[];
    expect(new Set(rows.map((r) => r.product))).toEqual(new Set(['renewberry', 'blog', 'mirror']));
  });
});
