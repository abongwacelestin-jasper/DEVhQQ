/**
 * Account settings pages (/settings, /sessions) as a Developer.
 *
 * Uses Sam Carter (m8, Developer), a seeded member no other e2e test signs in as,
 * because this file changes the account's password. The tests run in order:
 * profile edit → revoke a second session → change password and sign in again.
 */
import { test, expect } from '../support/fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { DEMO_MFA_CODE, DEMO_PASSWORD } from '../support/personas';
import { completeStepUp, enterCode, signOutViaUi } from '../support/auth';

const SAM = { name: 'Sam Carter', email: 'sam@techorg.io' };
const NEW_PASSWORD = 'Lighthouse-Orbit-73!';
const FIREFOX_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';

test.describe.configure({ mode: 'serial' });

/** NDA + profile through the same API the onboarding screens use (no-op once done). */
async function onboard(api: APIRequestContext) {
  const ob = (await (await api.get('/api/onboarding')).json()) as {
    stage: string;
    nda: { currentVersion: string; signed: boolean };
    profileComplete: boolean;
  };
  if (ob.stage === 'ready') return;
  if (!ob.nda.signed) {
    const nda = await api.post('/api/onboarding/nda', {
      data: { version: ob.nda.currentVersion, signedName: SAM.name },
    });
    expect(nda.status(), await nda.text()).toBeLessThan(300);
  }
  if (!ob.profileComplete) {
    const prof = await api.post('/api/onboarding/profile', {
      data: {
        displayName: SAM.name,
        timezone: 'UTC',
        hoursFrom: '09:00',
        hoursTo: '17:00',
        skills: ['QA'],
        notify: ['assigned'],
      },
    });
    expect(prof.status(), await prof.text()).toBe(200);
  }
}

/** The real sign-in screens: password, then the one-time code. */
async function signIn(page: Page, password = DEMO_PASSWORD) {
  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: 'Work email' }).fill(SAM.email);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/verify$/);
  await enterCode(page, DEMO_MFA_CODE);
  await expect(page).not.toHaveURL(/\/(sign-in|verify)$/);
  await onboard(page.request);
}

test.describe('Settings and sessions (Developer)', () => {
  test('edits the profile from the account menu and it persists after a reload', async ({ page }) => {
    await signIn(page);
    await page.goto('/my-work');
    await page.getByRole('button', { name: `Account menu for ${SAM.name}` }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

    const form = page.getByRole('form', { name: 'Profile' });
    await form.getByLabel('Title').fill('Platform engineer');
    await form.getByLabel(/^Short bio/).fill('Payments and billing reliability.');
    await form.getByRole('checkbox', { name: 'Sat' }).check();
    await form.getByRole('checkbox', { name: 'TypeScript' }).check();
    await form.getByRole('radio', { name: 'Daily digest' }).check();
    await form.getByRole('checkbox', { name: 'Review requests' }).check();
    await form.getByRole('button', { name: 'Save profile' }).click();
    await expect(form.getByRole('status')).toHaveText('Profile saved.');

    // Stored by the server, not the browser.
    const ob = (await (await page.request.get('/api/onboarding')).json()) as {
      profile: Record<string, unknown>;
    };
    expect(ob.profile).toMatchObject({
      title: 'Platform engineer',
      emailDelivery: 'daily',
      days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    });

    await page.reload();
    const after = page.getByRole('form', { name: 'Profile' });
    await expect(after.getByLabel('Title')).toHaveValue('Platform engineer');
    await expect(after.getByLabel(/^Short bio/)).toHaveValue('Payments and billing reliability.');
    await expect(after.getByRole('checkbox', { name: 'Sat' })).toBeChecked();
    await expect(after.getByRole('checkbox', { name: 'TypeScript' })).toBeChecked();
    await expect(after.getByRole('checkbox', { name: 'Review requests' })).toBeChecked();
    await expect(after.getByRole('radio', { name: 'Daily digest' })).toBeChecked();
    await expect(after.getByRole('button', { name: 'Save profile' })).toBeDisabled();
  });

  test('lists sessions, revokes a second one, then signs out everywhere else', async ({
    page,
    browser,
  }) => {
    await signIn(page);

    // A second device: its own browser context with a different user agent.
    const other = await browser.newContext({ userAgent: FIREFOX_WINDOWS });
    try {
      const pw = await other.request.post('/api/auth/sign-in', {
        data: { email: SAM.email, password: DEMO_PASSWORD },
      });
      expect(pw.status(), await pw.text()).toBe(200);
      const mfa = await other.request.post('/api/auth/mfa/totp', { data: { code: DEMO_MFA_CODE } });
      expect(mfa.status(), await mfa.text()).toBe(200);
      expect((await other.request.get('/api/auth/session')).status()).toBe(200);

      await page.getByRole('button', { name: `Account menu for ${SAM.name}` }).click();
      await page.getByRole('menuitem', { name: 'Sessions & devices' }).click();
      await expect(page).toHaveURL(/\/sessions$/);
      await expect(page.getByRole('heading', { name: 'Sessions & devices', level: 1 })).toBeVisible();
      const current = page.locator('li[aria-current="true"]');
      await expect(current).toHaveCount(1);
      await expect(current.getByText('This browser')).toBeVisible();

      await page.getByRole('button', { name: /^Revoke Firefox · Windows session/ }).click();
      await completeStepUp(page, { title: 'Revoke session', action: 'Verify & revoke' });
      await expect(page.getByText('Session revoked').first()).toBeVisible();
      await expect(page.getByRole('button', { name: /^Revoke Firefox · Windows session/ })).toHaveCount(0);
      expect((await other.request.get('/api/auth/session')).status()).toBe(401);
    } finally {
      await other.close();
    }

    // Earlier tests in this file left sessions behind: end all of them, keep this one.
    const elsewhere = page.getByRole('button', { name: 'Sign out everywhere else' });
    if (await elsewhere.isEnabled()) {
      await elsewhere.click();
      await completeStepUp(page, {
        title: 'Sign out everywhere else',
        action: 'Verify & sign out others',
      });
      await expect(page.getByText('Other sessions signed out').first()).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /^Revoke / })).toHaveCount(0);
    await expect(elsewhere).toBeDisabled();
    await expect(page.locator('li[aria-current="true"]')).toHaveCount(1);
    expect((await page.request.get('/api/auth/session')).status()).toBe(200);
  });

  test('changes the password, then signs in with the new one (and not the old one)', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto('/settings');
    const panel = page.getByRole('region', { name: 'Security', exact: true });
    await panel.getByLabel('Current password').fill('not-my-password');
    await panel.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
    await panel.getByLabel('Confirm new password').fill(NEW_PASSWORD);
    await panel.getByRole('button', { name: 'Change password' }).click();
    await expect(panel.getByRole('alert')).toHaveText('Your current password is incorrect.');
    await expect(panel.getByLabel('Current password')).toBeFocused();

    await panel.getByLabel('Current password').fill(DEMO_PASSWORD);
    await panel.getByRole('button', { name: 'Change password' }).click();
    // A stale verification would open the step-up dialog; complete it if it appears.
    const dialog = page.getByRole('dialog', { name: 'Confirm it’s you' });
    await expect(panel.getByRole('status').or(dialog)).toBeVisible();
    if (await dialog.isVisible()) await completeStepUp(page, { action: 'Verify & continue' });
    await expect(panel.getByRole('status')).toContainText('Password changed.');
    // This browser is still signed in after the change.
    expect((await page.request.get('/api/auth/session')).status()).toBe(200);

    await signOutViaUi(page);

    // The old password is refused…
    await page.getByRole('textbox', { name: 'Work email' }).fill(SAM.email);
    await page.locator('input[autocomplete="current-password"]').fill(DEMO_PASSWORD);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('Email or password is incorrect').first()).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in$/);

    // …and the new one works.
    await signIn(page, NEW_PASSWORD);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  });
});
