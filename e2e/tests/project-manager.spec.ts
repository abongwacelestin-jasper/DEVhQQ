/**
 * Persona: Daniel Reyes, Project manager on RenewBerry (Project: manage, Deployment: view).
 * "I create a task, assign it to a developer with a due date, discuss it, break it
 *  into a subtask and log my time. When I reload, everything is still there. If I
 *  try to approve a production deploy I am told politely that I can't."
 */
import { test, expect, uid } from '../support/fixtures';
import { completeStepUp, signInViaApi } from '../support/auth';
import { requestProductionDeploy } from '../support/api';

test.describe('Project manager journey', () => {
  test('creates, assigns, schedules and works a task; reload keeps it all @smoke', async ({ page }) => {
    const title = `QA task ${uid()}`;
    const comment = `Comment ${uid()}`;
    const subtask = `Subtask ${uid()}`;

    await signInViaApi(page, 'pm', '/my-work');
    await page.getByRole('button', { name: 'New task for me' }).click();
    const modal = page.getByRole('dialog', { name: 'New task' });
    await modal.getByRole('textbox', { name: 'Title' }).fill(title);
    await modal.getByRole('combobox', { name: /^Assignee/ }).selectOption({ label: await optionLabel(modal, /^Assignee/, 'Kofi Mensah') });
    await modal.getByLabel('Due date').fill('2026-12-15');
    await modal.getByRole('button', { name: 'Create task' }).click();

    const toast = page.getByText(/^[A-Z]+-\d+ created$/).first();
    await expect(toast).toBeVisible();
    const key = (await toast.textContent())!.replace(' created', '').trim();
    await page.goto(`/tasks/${key}`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByLabel('Due date')).toHaveValue('2026-12-15');

    await page.getByPlaceholder(/Write a comment/).fill(comment);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(comment)).toBeVisible();

    await page.getByRole('textbox', { name: 'New subtask' }).fill(subtask);
    await page.getByRole('textbox', { name: 'New subtask' }).press('Enter');
    await expect(page.getByText(subtask)).toBeVisible();

    await page.getByRole('button', { name: 'Log time' }).click();
    const log = page.getByRole('dialog', { name: `Log time · ${key}` });
    await log.getByRole('spinbutton', { name: 'Hours' }).fill('1');
    await log.getByRole('button', { name: /^Log 1h/ }).click();
    await expect(log).toBeHidden();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText(comment)).toBeVisible();
    await expect(page.getByText(subtask)).toBeVisible();
    await expect(page.getByLabel('Due date')).toHaveValue('2026-12-15');
    await expect(page.getByText('Kofi Mensah').first()).toBeVisible();

    // And the server agrees: the record of truth, not the tab's memory.
    const res = await page.request.get(`/api/tasks/${key}`);
    expect(res.status()).toBe(200);
    const task = await res.json();
    expect(task.assignee).toBe('m4');
  });

  test('is refused gracefully when trying to approve a production deploy', async ({ page, baseURL }) => {
    const d = await requestProductionDeploy(baseURL!, 'operations', 'renewberry', uid('v'));
    await signInViaApi(page, 'pm', '/deployments');
    await expect(page.getByRole('heading', { level: 1, name: 'Deployments' })).toBeVisible();
    const row = page
      .getByRole('listitem')
      .filter({ hasText: d.sha })
      .filter({ has: page.getByRole('button', { name: 'Approve' }) });
    // Least privilege: ideally the button is not offered at all (Deployment: view).
    const offered = await row.count();
    test.info().annotations.push({ type: 'observation', description: `Approve offered to PM: ${offered > 0}` });
    if (offered) {
      await row.getByRole('button', { name: 'Approve' }).click();
      await completeStepUp(page, { title: /Approve production deploy/, action: 'Verify & approve' });
      await expect(page.getByText('Approval failed').first()).toBeVisible();
    }
    // The server is the authority either way.
    const res = await page.request.post(`/api/deployments/${d.id}/approve`);
    expect(res.status()).toBe(403);
    await expect(page.getByRole('heading', { level: 1, name: 'Deployments' })).toBeVisible();
  });

  test('does not see the Approve action for deploys they cannot approve', async ({ page, baseURL }) => {
    test.fail(true, 'QA-007: Approve/Reject buttons are offered to roles with Deployment: view');
    const d = await requestProductionDeploy(baseURL!, 'operations', 'renewberry', uid('v'));
    await signInViaApi(page, 'pm', '/deployments');
    await expect(page.getByText(d.sha).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });
});

async function optionLabel(scope: import('@playwright/test').Locator, name: RegExp, startsWith: string) {
  const options = await scope.getByRole('combobox', { name }).locator('option').allTextContents();
  const hit = options.find((o) => o.startsWith(startsWith));
  if (!hit) throw new Error(`No option starting with "${startsWith}" in ${JSON.stringify(options)}`);
  return hit;
}
