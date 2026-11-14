/**
 * Cloudflare Turnstile on the public auth forms.
 *
 * Runs in both modes and asserts the behaviour of the one it is in:
 *  - default (mode off): no widget, no Cloudflare script, forms work as before;
 *  - `E2E_TURNSTILE=1` (playwright.config.ts starts the API with TURNSTILE_MODE=on and
 *    Cloudflare's always-pass test keys): the widget renders, solves itself, and sign-in,
 *    password recovery and invite acceptance go through with its token; a browser request
 *    without a token is refused. Needs internet (challenges.cloudflare.com).
 *
 *   E2E_TURNSTILE=1 npx playwright test --project=chromium tests/turnstile.spec.ts
 */
import { test, expect, uid } from '../support/fixtures';
import { enterCode, expectSignedIn } from '../support/auth';
import { DEMO_MFA_CODE, DEMO_PASSWORD, personas } from '../support/personas';
import type { Page } from '@playwright/test';

const on = process.env.E2E_TURNSTILE === '1';
const SCRIPT = 'script[src*="challenges.cloudflare.com/turnstile/v0/api.js"]';
/** API calls as an explicit CLI client: exempt from the check, as designed. */
const CLI = { 'X-DevHQ-Client': 'cli' };

/** Mode on: the widget is labelled and solved (the always-pass test key solves it on its own). */
async function solveCheck(page: Page) {
  const region = page.getByRole('group', { name: 'Security check' });
  if (!on) {
    await expect(region).toHaveCount(0);
    return;
  }
  await expect(region).toBeVisible();
  await expect(region).toHaveAttribute('data-turnstile-status', 'solved', { timeout: 30_000 });
  await expect(region).toContainText('Security check complete.');
}

test.describe(`Turnstile (mode ${on ? 'on' : 'off'}) @turnstile`, () => {
  test('the API publishes the mode; the script loads only when it is on', async ({ page }) => {
    const cfg = await (await page.request.get('/api/auth/config')).json();
    expect(cfg.turnstile.mode).toBe(on ? 'on' : 'off');
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { name: 'Sign in to TavetaHQ' })).toBeVisible();
    await solveCheck(page);
    await expect(page.locator(SCRIPT)).toHaveCount(on ? 1 : 0);
    if (on) expect(await page.locator(SCRIPT).getAttribute('src')).toContain('render=explicit');
  });

  test('password sign-in through the widget, then the one-time code', async ({ page }) => {
    const p = personas.admin;
    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'Work email' }).fill(p.email);
    await page.locator('input[autocomplete="current-password"]').fill(DEMO_PASSWORD);
    await solveCheck(page);
    const signIn = page.waitForResponse((r) => r.url().endsWith('/api/auth/sign-in'));
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const res = await signIn;
    expect(res.status(), await res.text()).toBe(200);
    if (on) expect(res.request().postDataJSON().turnstileToken, 'token sent').toBeTruthy();
    await expect(page).toHaveURL(/\/verify$/);
    await enterCode(page, DEMO_MFA_CODE);
    await expectSignedIn(page, 'admin');
  });

  test('a browser request without a token is refused only when the check is on', async ({ page, baseURL }) => {
    const res = await page.request.post('/api/auth/sign-in', {
      data: { email: personas.admin.email, password: DEMO_PASSWORD },
      headers: { Origin: baseURL!, 'Sec-Fetch-Site': 'same-origin' },
    });
    if (on) {
      expect(res.status()).toBe(400);
      expect((await res.json()).error.code).toBe('turnstile_required');
    } else {
      expect(res.status()).toBe(200);
    }
  });

  test('password recovery through the widget', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByRole('textbox', { name: 'Work email' }).fill('amara@techorg.io');
    await solveCheck(page);
    const sent = page.waitForResponse((r) => r.url().endsWith('/api/auth/recovery/request'));
    await page.getByRole('button', { name: 'Send reset link' }).click();
    expect((await sent).status()).toBe(202);
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
  });

  test('invite acceptance through the widget', async ({ page, browser, baseURL }) => {
    const admin = await page.request.post('/api/auth/demo', { data: { role: 'admin' }, headers: CLI });
    expect(admin.status(), await admin.text()).toBe(200);
    const inv = await page.request.post('/api/team/invites', {
      data: { email: `${uid('ts').toLowerCase()}@techorg.io`, role: 'Developer', products: ['renewberry'] },
    });
    expect(inv.status(), await inv.text()).toBe(200);
    const { inviteLink } = (await inv.json()) as { inviteLink: string };

    const ctx = await browser.newContext({ baseURL });
    const newbie = await ctx.newPage();
    await newbie.goto(inviteLink);
    const password = 'Qa-beta-Passw0rd!';
    await newbie.locator('input[autocomplete="new-password"]').first().fill(password);
    await newbie.locator('input[autocomplete="new-password"]').nth(1).fill(password);
    await solveCheck(newbie);
    await newbie.locator('button[type="submit"]').click();
    await expect(newbie.getByRole('heading', { name: 'Your account is active' })).toBeVisible();
    await ctx.close();
  });
});
