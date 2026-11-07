/**
 * First-time member onboarding through the real screens: NDA (every section
 * acknowledged, typed signature) then the profile wizard. Runs as its own project in
 * its own invocation (`npm run test:onboarding`, fresh server), because once any journey
 * has completed the Tester's onboarding on a shared server the screens no longer show.
 * Needs fresh server state: with E2E_BASE_URL against a used server it reports
 * "already onboarded" as a failure on purpose.
 */
import { test, expect } from '../support/fixtures';
import { personas } from '../support/personas';
import { demoButton } from '../support/auth';

test('a first-time Tester signs the NDA and completes the profile on screen', async ({ page }) => {
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
      // QA-026: these "backup codes" are a fixed formula, identical for every member, never stored server-side.
      test.info().annotations.push({ type: 'defect', description: `QA-026 backup codes shown: ${(await page.getByRole('listitem').filter({ hasText: /^\d{4}-\d{4}$/ }).allTextContents()).join(' ')}` });
      await stored.check();
    }
    const btn = page.getByRole('button', { name: /^(Continue|Finish)/ });
    if (!(await btn.isVisible().catch(() => false))) break;
    await btn.click();
  }
  await page.getByRole('button', { name: 'Enter DevHQ' }).click();
  await expect(page).toHaveURL(/\/test-queue$/);
  const ob = await (await page.request.get('/api/onboarding')).json();
  expect(ob.stage).toBe('ready');
  expect(ob.nda.signed).toBe(true);
});
