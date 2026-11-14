/**
 * First-time member onboarding through the real screens: NDA (every section
 * acknowledged, typed signature) then the profile wizard. Runs as its own project in
 * its own invocation (`npm run test:onboarding`, fresh server), because once any journey
 * has completed the Tester's onboarding on a shared server the screens no longer show.
 * Needs fresh server state: with E2E_BASE_URL against a used server it reports
 * "already onboarded" as a failure on purpose.
 */
import { request as playwrightRequest } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { DEMO_PASSWORD, personas } from '../support/personas';
import { demoButton } from '../support/auth';

test('a first-time Tester signs the NDA and completes the profile on screen', async ({ page }) => {
  let backupCodes: string[] = [];
  await page.goto('/sign-in');
  await demoButton(page, 'tester').click();
  await expect(page).toHaveURL(/\/onboarding\/nda$/);
  // The name sits on the wrapping <nav>, not on the tablist (UI request R-03).
  const tabs = page.getByRole('navigation', { name: 'Agreement sections' }).getByRole('tablist');
  await expect(tabs).toBeVisible();

  for (let guard = 0; guard < 10; guard++) {
    const panel = page.getByRole('tabpanel');
    for (const box of await panel.getByRole('checkbox').all()) if (!(await box.isChecked())) await box.check();
    const pressed = panel.locator('button[aria-pressed]');
    if ((await pressed.count()) && !(await panel.locator('button[aria-pressed="true"]').count())) await pressed.first().click();
    const next = page.getByRole('button', { name: /^Next: / });
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
  }
  // Any section still incomplete? Visit it and acknowledge.
  for (const tab of await tabs.getByRole('tab').all()) {
    if (await tab.getByLabel('Incomplete').count()) {
      await tab.click();
      for (const box of await page.getByRole('tabpanel').getByRole('checkbox').all()) if (!(await box.isChecked())) await box.check();
    }
  }
  await tabs.getByRole('tab').last().click();
  await page.getByPlaceholder(personas.tester.name).fill(personas.tester.name);
  await page.getByRole('button', { name: 'Sign agreement' }).click();

  await expect(page).toHaveURL(/\/onboarding\/profile$/);
  for (let guard = 0; guard < 8 && /onboarding\/profile/.test(page.url()); guard++) {
    const name = page.getByRole('textbox', { name: 'Display name' });
    if (await name.isVisible().catch(() => false)) await name.fill(personas.tester.name);
    const skill = page.getByRole('button', { name: 'Playwright', exact: true });
    if ((await skill.isVisible().catch(() => false)) && (await skill.getAttribute('aria-pressed')) !== 'true') await skill.click();
    const stored = page.getByRole('checkbox', { name: /stored these codes/ });
    if ((await stored.isVisible().catch(() => false)) && !(await stored.isChecked())) {
      // QA-026 is fixed: ten random codes from the server (hashed there), each usable once.
      const items = page.getByRole('listitem').filter({ hasText: /^[a-z2-9]{4}-[a-z2-9]{4}$/ });
      await expect(items).toHaveCount(10);
      backupCodes = await items.allTextContents();
      await stored.check();
    }
    const btn = page.getByRole('button', { name: /^(Continue|Finish)/ });
    if (!(await btn.isVisible().catch(() => false))) break;
    await btn.click();
  }
  await page.getByRole('button', { name: 'Enter TavetaHQ' }).click();
  await expect(page).toHaveURL(/\/test-queue$/);
  const ob = await (await page.request.get('/api/onboarding')).json();
  expect(ob.stage).toBe('ready');

  // A backup code from that screen completes a real password sign-in, once.
  expect(backupCodes).toHaveLength(10);
  for (const attempt of [200, 401]) {
    const api = await playwrightRequest.newContext({ baseURL: new URL(page.url()).origin });
    expect((await api.post('/api/auth/sign-in', { data: { email: personas.tester.email, password: DEMO_PASSWORD } })).status()).toBe(200);
    expect((await api.post('/api/auth/mfa/backup', { data: { code: backupCodes[0] } })).status()).toBe(attempt);
    await api.dispose();
  }
  expect(ob.nda.signed).toBe(true);
});
