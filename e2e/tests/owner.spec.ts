/**
 * Persona: Amara Okafor, workspace Owner.
 * "As the owner I sign in with my password and a one-time code, check the overview,
 *  invite a new member, change someone's role, approve a production deploy that a
 *  colleague requested, confirm all of it is in the audit log, and sign out."
 */
import { test, expect, uid } from '../support/fixtures';
import { completeStepUp, enterCode, signInViaApi, signInWithPassword, signOutViaUi } from '../support/auth';
import { apiSession, requestProductionDeploy, type ApiDeployment } from '../support/api';
import { DEMO_PASSWORD } from '../support/personas';

test.describe('Owner journey', () => {
  test('signs in with password + MFA, sees the overview, signs out @smoke', async ({ page }) => {
    test.fail(true, 'QA-002: data providers call the API with the password-only session; 401 mfa_required signs the user out before the code can be entered');
    await signInWithPassword(page, 'admin');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening), Amara/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();

    await signOutViaUi(page);
    // The session is gone server-side, not just in the tab.
    const res = await page.request.get('/api/auth/session');
    expect(res.status()).toBe(401);
    await page.goto('/');
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('a wrong password is refused without revealing which part was wrong', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'Work email' }).fill('nobody@techorg.io');
    await page.locator('input[autocomplete="current-password"]').fill('whatever-123');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const unknown = (await page.getByRole('alert').textContent()) ?? '';
    await page.getByRole('textbox', { name: 'Work email' }).fill('amara@techorg.io');
    await page.locator('input[autocomplete="current-password"]').fill('not-the-password');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/incorrect|failed/i);
    expect(await page.getByRole('alert').textContent(), 'no user enumeration').toBe(unknown);
    await expect(page).toHaveURL(/\/sign-in$/);
  });

  test('a wrong one-time code is refused and the user can retry', async ({ page }) => {
    test.fail(true, 'QA-002: the /verify screen is never usable (signed out by 401 mfa_required)');
    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'Work email' }).fill('amara@techorg.io');
    await page.locator('input[autocomplete="current-password"]').fill('not-the-password');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/incorrect|failed/i);
    await expect(page).toHaveURL(/\/sign-in$/);

    await page.locator('input[autocomplete="current-password"]').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page).toHaveURL(/\/verify$/);
    await enterCode(page, '000000');
    await expect(page.getByRole('status')).toContainText('didn’t match');
    await expect(page).toHaveURL(/\/verify$/);
  });

  test('invites a member; the invite shows in the directory and the audit log', async ({ page }) => {
    const email = `${uid('invite').toLowerCase()}@techorg.io`;
    await signInViaApi(page, 'admin', '/team');
    await page.getByRole('button', { name: 'Invite' }).click();

    const dialog = page.getByRole('dialog', { name: 'Invite member' });
    await dialog.getByRole('textbox', { name: 'Work email' }).fill(email);
    await dialog.getByRole('radio', { name: 'Designer' }).check({ force: true });
    await dialog.getByRole('checkbox', { name: /^RenewBerry/ }).check({ force: true });
    await dialog.getByRole('button', { name: 'Create invite' }).click();

    // Sensitive: either it goes straight through (fresh verification) or asks for a code.
    const stepUp = page.getByRole('dialog', { name: /verif/i });
    if (await stepUp.isVisible().catch(() => false)) await completeStepUp(page, { action: /verify/i });

    await expect(dialog.getByRole('textbox', { name: 'Accept invite link' })).toHaveValue(/\/accept-invite\?token=/);
    await dialog.getByRole('button', { name: 'Done' }).click();

    await page.getByPlaceholder('Search by name, email or role').fill(email);
    await expect(page.getByRole('region', { name: 'Members' }).or(page.locator('main')).getByText(email).first()).toBeVisible();

    await page.goto('/audit');
    await page.getByPlaceholder('Search action, target, person or area').fill(email);
    await expect(page.getByRole('region', { name: 'Events' }).or(page.locator('main')).getByText(email).first()).toBeVisible();
  });

  test('changes a member’s role behind step-up', async ({ page }) => {
    test.info().annotations.push({ type: 'defect', description: 'QA-001: no UI to change a member role' });
    test.fail(true, 'QA-001: PATCH /api/team/:id supports role changes but no screen offers it');
    await signInViaApi(page, 'admin', '/team/m12');
    await expect(page.getByRole('heading', { name: 'Noah Adeyemi' }).first()).toBeVisible();
    const roleControl = page
      .getByRole('combobox', { name: /role/i })
      .or(page.getByRole('button', { name: /change role/i }));
    await expect(roleControl.first()).toBeVisible({ timeout: 3000 });
  });

  test('role change is enforced by the API: step-up required, last owner protected', async ({ page, baseURL }) => {
    // The server half of "change a role", so the journey is covered even while the UI is missing.
    await signInViaApi(page, 'admin');
    const own = await page.request.patch('/api/team/m1', { data: { role: 'Developer' } });
    expect(own.status(), 'self-demotion is refused').toBe(403);

    const pm = await apiSession(baseURL!, 'pm');
    const forbidden = await pm.patch('/api/team/m12', { data: { role: 'Tester' } });
    expect(forbidden.status(), 'a PM cannot change roles').toBe(403);
    await pm.dispose();

    const ok = await page.request.patch('/api/team/m12', { data: { role: 'Tester' } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).role).toBe('Tester');
    const back = await page.request.patch('/api/team/m12', { data: { role: 'Developer' } });
    expect(back.status()).toBe(200);
  });

  test('approves a production deploy requested by Operations (two-person rule) @smoke', async ({ page, baseURL }) => {
    const tag = uid('v');
    const d = await requestProductionDeploy(baseURL!, 'operations', 'renewberry', tag);
    expect(d.status).toBe('awaiting-approval');

    await signInViaApi(page, 'admin', '/deployments');
    const row = page
      .getByRole('listitem')
      .filter({ hasText: d.sha })
      .filter({ has: page.getByRole('button', { name: 'Approve' }) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Approve' }).click();
    await completeStepUp(page, { title: /Approve production deploy/, action: 'Verify & approve' });
    await expect(page.getByText('Deployment approved').first()).toBeVisible();

    const after = await page.request.get('/api/deployments?product=renewberry&env=production');
    const mine = ((await after.json()) as ApiDeployment[]).find((x) => x.id === d.id);
    expect(mine?.approvedBy).toBe('m1');
    expect(['running', 'succeeded']).toContain(mine?.status);

    await page.goto('/audit');
    await page.getByPlaceholder('Search action, target, person or area').fill(tag);
    await expect(page.locator('main').getByText(/approved/i).first()).toBeVisible();
  });

  test('cannot approve their own production deploy', async ({ page }) => {
    const tag = uid('v');
    await signInViaApi(page, 'admin', '/deployments');
    const sha = 'abcdef1';
    const res = await page.request.post('/api/deployments', {
      data: { product: 'blog', env: 'production', version: tag, sha },
    });
    expect(res.status()).toBe(201);
    await page.reload();
    const row = page
      .getByRole('listitem')
      .filter({ hasText: tag })
      .filter({ has: page.getByRole('button', { name: 'Approve' }) });
    await row.getByRole('button', { name: 'Approve' }).click();
    await completeStepUp(page, { title: /Approve production deploy/, action: 'Verify & approve' });
    await expect(page.getByText(/can’t approve your own deployment/i).first()).toBeVisible();
  });
});
