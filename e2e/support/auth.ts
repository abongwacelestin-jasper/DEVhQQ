import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { DEMO_MFA_CODE, DEMO_PASSWORD, personas, type RoleKey } from './personas';

/**
 * Onboarding (NDA + profile) currently lives in the browser's sessionStorage only
 * (Frontend AuthContext `devhq.onboarding.v1.<memberId>`), so every new tab of a
 * non-admin persona is sent back through the NDA. That is defect QA-012 in
 * docs/qa/BETA_REPORT.md. Journeys that are *not* about onboarding pre-seed it here
 * so they test what they claim to test; `onboarding.spec.ts` covers the real flow.
 * When B-COLLAB makes the server the authority (`GET /api/onboarding`), this seeding
 * becomes a no-op and can be deleted.
 */
export async function seedOnboarding(context: BrowserContext, role: RoleKey) {
  const p = personas[role];
  if (!p.needsOnboarding) return;
  const value = JSON.stringify({
    ndaSignedAt: new Date().toISOString(),
    ndaName: p.name,
    profile: {
      displayName: p.name,
      timezone: 'UTC',
      hoursFrom: '09:00',
      hoursTo: '17:00',
      skills: ['QA'],
      notify: ['assigned'],
    },
  });
  await context.addInitScript(
    ([key, v]) => {
      try {
        if (!window.sessionStorage.getItem(key)) window.sessionStorage.setItem(key, v);
      } catch {
        /* opaque origins (about:blank) have no storage */
      }
    },
    [`devhq.onboarding.v1.${p.memberId}`, value] as const,
  );
}

/** Fast path: demo session via the API (cookie lands in the page's context), then open home. */
export async function signInViaApi(page: Page, role: RoleKey, landing?: string) {
  await seedOnboarding(page.context(), role);
  const res = await page.request.post('/api/auth/demo', { data: { role } });
  expect(res.status(), `demo sign-in for ${role}`).toBe(200);
  await page.goto(landing ?? personas[role].home);
  await expectSignedIn(page, role);
}

/** Real user path: the demo button on the sign-in screen. */
export async function signInViaDemoButton(page: Page, role: RoleKey) {
  await seedOnboarding(page.context(), role);
  await page.goto('/sign-in');
  const p = personas[role];
  await page.getByRole('button', { name: new RegExp(`^${p.label}`) }).click();
  await expectSignedIn(page, role);
}

/** Password + one-time code, as a real member signs in. */
export async function signInWithPassword(page: Page, role: RoleKey, opts?: { code?: string }) {
  await seedOnboarding(page.context(), role);
  const p = personas[role];
  await page.goto('/sign-in');
  await page.getByRole('textbox', { name: 'Work email' }).fill(p.email);
  await page.locator('input[autocomplete="current-password"]').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/verify$/);
  await enterCode(page, opts?.code ?? DEMO_MFA_CODE);
}

/** Types a 6-digit code into the CodeInput (one box per digit, or a single field). */
export async function enterCode(page: Page, code: string, scope = page.locator('body')) {
  const boxes = scope.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]');
  await expect(boxes.first()).toBeVisible();
  const n = await boxes.count();
  if (n >= 6) {
    await boxes.first().click();
    await page.keyboard.type(code, { delay: 30 });
  } else {
    await boxes.first().fill(code);
  }
}

export async function expectSignedIn(page: Page, role: RoleKey) {
  const p = personas[role];
  await expect(page).not.toHaveURL(/\/(sign-in|verify|onboarding)/);
  // The topbar account menu is labelled with the member's name.
  await expect(page.getByRole('button', { name: `Account menu for ${p.name}` })).toBeVisible();
}

/** API client authenticated as a persona, independent of any browser page. */
export async function apiAs(request: APIRequestContext, role: RoleKey) {
  const res = await request.post('/api/auth/demo', { data: { role } });
  expect(res.status(), `demo sign-in for ${role}`).toBe(200);
  const body = (await res.json()) as { token?: string };
  return body;
}

export async function signOutViaUi(page: Page) {
  // The profile menu lives in the topbar; its trigger is labelled with the member name.
  await page.getByRole('button', { name: /^Account menu for / }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

/** Completes the re-verification dialog (ReauthDialog) that guards sensitive actions. */
export async function completeStepUp(
  page: Page,
  opts: { title?: string | RegExp; action: string | RegExp; code?: string },
) {
  const dialog = page.getByRole('dialog', opts.title ? { name: opts.title } : undefined).last();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: /6-digit code/i }).fill(opts.code ?? DEMO_MFA_CODE);
  await dialog.getByRole('button', { name: opts.action }).click();
  return dialog;
}
