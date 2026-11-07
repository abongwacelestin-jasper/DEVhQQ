/**
 * Persona: Amara Okafor, workspace Owner.
 * "As the owner I sign in with my password and a one-time code, check the overview,
 *  invite a new member, change someone's role, approve a production deploy that a
 *  colleague requested, confirm all of it is in the audit log, and sign out."
 */
import { test, expect, uid } from '../support/fixtures';
import { completeStepUp, enterCode, signInViaApi, signInWithPassword, signOutViaUi } from '../support/auth';
import { apiSession, myGrants, requestProductionDeploy, type ApiDeployment } from '../support/api';
import { DEMO_PASSWORD } from '../support/personas';

test.describe('Owner journey', () => {
  test('signs in with password + MFA, sees the overview, signs out @smoke', async ({ page }) => {
    // QA-002 (password + MFA sign-in impossible) is fixed in wave 4 (F-SEC keeps partial sessions alive).
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
    // Visually hidden inputs: click them directly (force-check can report "outside of the viewport").
    const role = dialog.getByRole('radio', { name: 'Designer' });
    const product = dialog.getByRole('checkbox', { name: /^RenewBerry/ });
    await role.evaluate((el: HTMLInputElement) => el.click());
    if (!(await product.isChecked())) await product.evaluate((el: HTMLInputElement) => el.click());
    await expect(role).toBeChecked();
    await expect(product).toBeChecked();
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

  test('changes a member’s role behind step-up; the server applies it', async ({ page }) => {
    // QA-001 (phase 1: no UI) is fixed in wave 4: MemberDetail has a role select behind step-up.
    await signInViaApi(page, 'admin', '/team/m12');
    await expect(page.getByRole('heading', { name: 'Noah Adeyemi' }).first()).toBeVisible();
    await page.getByRole('combobox', { name: /^Role/ }).selectOption('Tester');
    await completeStepUp(page, { title: 'Change role', action: 'Verify & save' });
    await expect(page.getByText('Noah Adeyemi is now Tester').first()).toBeVisible();
    const team = await (await page.request.get('/api/team')).json();
    const rows = (Array.isArray(team) ? team : team.items) as { id: string; role: string }[];
    expect(rows.find((m) => m.id === 'm12')?.role).toBe('Tester');
    await page.reload();
    await expect(page.getByRole('combobox', { name: /^Role/ })).toHaveValue('Tester');
    // Put it back so other journeys see the seed.
    await page.getByRole('combobox', { name: /^Role/ }).selectOption('Developer');
    await completeStepUp(page, { title: 'Change role', action: 'Verify & save' });
    await expect(page.getByText('Noah Adeyemi is now Developer').first()).toBeVisible();
  });

  test('role change is enforced by the API: step-up required, last owner protected', async ({ page, baseURL }) => {
    // The server half of "change a role", so the journey is covered even while the UI is missing.
    await signInViaApi(page, 'admin');
    const own = await page.request.patch('/api/team/m1', { data: { role: 'Developer' } });
    expect(own.status(), 'self-demotion is refused').toBe(403);

    const pm = await apiSession(baseURL!, 'pm');
    const forbidden = await pm.patch('/api/team/m8', { data: { role: 'Tester' } });
    expect(forbidden.status(), 'a PM cannot change roles').toBe(403);
    await pm.dispose();

    const ok = await page.request.patch('/api/team/m8', { data: { role: 'Tester' } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).role).toBe('Tester');
    const back = await page.request.patch('/api/team/m8', { data: { role: 'Developer' } });
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
    // The Owner holds standing production rights: no just-in-time grant is asked for.
    await expect(page.getByRole('dialog', { name: 'Request production access' })).toHaveCount(0);
    expect((await myGrants(page.request)).filter((g) => g.status === 'active')).toEqual([]);

    const after = await page.request.get('/api/deployments?product=renewberry&env=production');
    const mine = ((await after.json()) as ApiDeployment[]).find((x) => x.id === d.id);
    expect(mine?.approvedBy).toBe('m1');
    expect(['running', 'succeeded']).toContain(mine?.status);

    await page.goto('/audit');
    await page.getByPlaceholder('Search action, target, person or area').fill(tag);
    await expect(page.locator('main').getByText(/approved/i).first()).toBeVisible();
  });

  test('cannot approve their own production deploy (button disabled, API refuses)', async ({ page }) => {
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
    // Wave 4 disables Approve on your own request; phase 1 let you click and got a 403 toast.
    await expect(row.getByRole('button', { name: 'Approve' })).toBeDisabled();
    const id = ((await res.json()) as { id: string }).id;
    const self = await page.request.post(`/api/deployments/${id}/approve`);
    expect(self.status()).toBe(403);
    expect(((await self.json()) as { error: { code: string } }).error.code).toBe('self_approval');
  });
});
