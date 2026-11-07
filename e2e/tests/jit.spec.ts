/**
 * Just-in-time production access in the browser.
 *
 * Production-impacting actions (approving or rolling back a production deploy,
 * changing an incident's severity, resolving a SEV1) need an approved,
 * unexpired grant for `production:<product>`. Without one the server answers
 * 403 `elevation_required` and the app offers to request access.
 *
 * Each test owns one product's grant for Operations so parallel journeys never
 * see each other's elevation: blog here for refusals, renewberry for the
 * approval journey (wave4.spec.ts uses mirror).
 */
import { test, expect, uid } from '../support/fixtures';
import { completeStepUp, requestJitAccess, signInViaApi } from '../support/auth';
import { apiSession, decideGrantAs, myGrants, requestProductionDeploy } from '../support/api';

test.describe('JIT production access', () => {
  test('a refused production action without a grant shows the request dialog, and nothing changes', async ({ page, baseURL }) => {
    const d = await requestProductionDeploy(baseURL!, 'admin', 'blog', uid('v'));
    await signInViaApi(page, 'operations', '/deployments');
    const row = page.getByRole('listitem').filter({ hasText: d.sha }).filter({ has: page.getByRole('button', { name: 'Approve' }) });
    await row.getByRole('button', { name: 'Approve' }).click();
    await completeStepUp(page, { title: /Approve production deploy/, action: 'Verify & approve' });

    const dialog = page.getByRole('dialog', { name: 'Request production access' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('production:blog');
    await expect(dialog.getByRole('textbox', { name: /Reason/ })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Duration' })).toBeVisible();
    await expect(page.getByText('Deployment approved')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();

    // The server refused: still awaiting approval, and cancelling requested nothing.
    const list = (await (await page.request.get('/api/deployments?product=blog')).json()) as { id: string; status: string }[];
    expect(list.find((x) => x.id === d.id)?.status).toBe('awaiting-approval');
    expect((await myGrants(page.request)).some((g) => g.scope === 'production:blog')).toBe(false);

    // Same on incident detail: resolving a SEV1 is refused and offers access; no false "resolved".
    const api = await apiSession(baseURL!, 'operations');
    const inc = await api.post('/api/incidents', {
      data: { product: 'blog', title: `JIT SEV1 ${uid()}`, severity: 'SEV1', impact: 'Blog is down for everyone.' },
    });
    expect(inc.status()).toBe(201);
    const { id } = (await inc.json()) as { id: string };
    await api.dispose();
    await page.goto(`/incidents/${id}`);
    await expect(page.getByRole('region', { name: 'Production access' })).toContainText('production:blog');
    await page.getByRole('button', { name: 'Resolve' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('production:blog');
    await expect(page.getByText(`${id} resolved`)).toHaveCount(0);
    expect(((await (await page.request.get(`/api/incidents/${id}`)).json()) as { status: string }).status).not.toBe('resolved');
  });

  test('request on the deployment, a second admin approves on Security, then approve with time left shown', async ({ page, baseURL, browser }) => {
    const d = await requestProductionDeploy(baseURL!, 'admin', 'renewberry', uid('v'));
    await signInViaApi(page, 'operations', `/deployments/${d.id}`);
    const status = page.getByRole('region', { name: 'Production access' });
    await expect(status).toContainText('Approving this deploy needs just-in-time access to production:renewberry');
    await status.getByRole('button', { name: 'Request access' }).click();
    await requestJitAccess(page, { scope: 'production:renewberry', reason: `Release ${d.version} to RenewBerry`, minutes: 60 });
    await expect(status).toContainText('Access requested');

    // The approver's place: Security → Production access (two-person rule).
    const adminCtx = await browser.newContext({ baseURL });
    const admin = await adminCtx.newPage();
    await signInViaApi(admin, 'admin', '/security');
    const grants = admin.getByRole('list', { name: 'Just-in-time grants' });
    const item = grants.getByRole('listitem').filter({ hasText: 'Grace Liu' }).filter({ hasText: 'production:renewberry' }).filter({ hasText: 'Pending' });
    await item.getByRole('button', { name: 'Approve' }).click();
    await completeStepUp(admin, { title: 'Approve production access', action: 'Verify & approve' });
    await expect(admin.getByText('Access approved').first()).toBeVisible();
    await expect(grants.getByRole('listitem').filter({ hasText: 'Grace Liu' }).filter({ hasText: /(min|h) left/ }).first()).toBeVisible();
    await adminCtx.close();

    await page.reload();
    await expect(status).toContainText('Production access active');
    await expect(status).toContainText(/(59 min|1 h) left/);
    await page.getByRole('button', { name: 'Approve' }).click();
    await completeStepUp(page, { title: /Approve production deploy/, action: 'Verify & approve' });
    await expect(page.getByText('Deployment approved').first()).toBeVisible();
    const after = (await (await page.request.get('/api/deployments?product=renewberry')).json()) as { id: string; approvedBy?: string }[];
    expect(after.find((x) => x.id === d.id)?.approvedBy).toBe('m11');

    const active = (await myGrants(page.request)).find((g) => g.scope === 'production:renewberry' && g.status === 'active');
    await decideGrantAs(baseURL!, 'admin', active!.id, 'revoke');
  });
});
