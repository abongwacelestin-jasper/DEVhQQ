import { expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { DEMO_MFA_CODE, DEMO_PASSWORD, personas, type RoleKey } from './personas';

/**
 * Phase 1 (pre-wave-4): onboarding lived only in sessionStorage (`devhq.onboarding.v1.<id>`),
 * so every new tab re-ran the NDA (QA-012). This shim pre-seeds that key; it is harmless
 * on wave-4 builds, where the server is the authority (see completeOnboarding).
 */
export async function seedOnboarding(context: BrowserContext, role: RoleKey) {
  const p = personas[role];
  if (!p.needsOnboarding) return;
  const value = JSON.stringify({
    ndaSignedAt: new Date().toISOString(),
    ndaName: p.name,
    profile: { displayName: p.name, timezone: 'UTC', hoursFrom: '09:00', hoursTo: '17:00', skills: ['QA'], notify: ['assigned'] },
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

/**
 * Wave 4: NDA + profile are recorded by the server (`/api/onboarding/*`). Journeys that are
 * not about onboarding complete it through the same API the screens use, as the member;
 * the onboarding screens themselves are covered in cross-cutting.spec.ts.
 * No-op when the endpoint does not exist (phase-1 builds) or the member is already ready.
 */
export async function completeOnboarding(api: APIRequestContext, role: RoleKey) {
  const p = personas[role];
  const res = await api.get('/api/onboarding');
  if (res.status() === 404) return;
  const ob = (await res.json()) as { stage?: string; nda?: { currentVersion?: string; signed?: boolean }; profileComplete?: boolean };
  if (ob.stage === 'ready' || !ob.stage) return;
  if (!ob.nda?.signed) {
    const nda = await api.post('/api/onboarding/nda', { data: { version: ob.nda?.currentVersion ?? '3.3', signedName: p.name } });
    expect(nda.status(), `NDA for ${role}: ${await nda.text()}`).toBeLessThan(300);
  }
  if (!ob.profileComplete) {
    const prof = await api.post('/api/onboarding/profile', {
      data: { displayName: p.name, timezone: 'UTC', hoursFrom: '09:00', hoursTo: '17:00', skills: ['QA'], notify: ['assigned'] },
    });
    expect([200, 201, 409], `profile for ${role}: ${await prof.text()}`).toContain(prof.status());
  }
}

/** Fast path: demo session via the API (cookie lands in the page's context), then open home. */
export async function signInViaApi(page: Page, role: RoleKey, landing?: string) {
  await seedOnboarding(page.context(), role);
  const res = await page.request.post('/api/auth/demo', { data: { role } });
  expect(res.status(), `demo sign-in for ${role}`).toBe(200);
  await completeOnboarding(page.request, role);
  await page.goto(landing ?? personas[role].home);
  await expectSignedIn(page, role);
}

/** Real user path: the demo button on the sign-in screen. */
export async function signInViaDemoButton(page: Page, role: RoleKey) {
  await seedOnboarding(page.context(), role);
  await page.goto('/sign-in');
  const p = personas[role];
  await demoButton(page, role).click();
  await expect(page).not.toHaveURL(/\/sign-in$/);
  if (/onboarding/.test(page.url())) {
    await completeOnboarding(page.request, role);
    await page.goto(p.home);
  }
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
  // Wave 4 code screens no longer auto-submit on the 6th digit: the lock screen has an
  // explicit Unlock button and /verify an explicit Verify button.
  for (const name of ['Unlock', 'Verify']) {
    const submit = scope.getByRole('button', { name, exact: true });
    if (await submit.isVisible().catch(() => false)) {
      await submit.click();
      break;
    }
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

/** The demo button on /sign-in: "Admin demo …", or "<initials> <name> <role> …" for the others. */
export function demoButton(page: Page, role: RoleKey) {
  const p = personas[role];
  return page.getByRole('button', { name: role === 'admin' ? /^Admin demo/ : new RegExp(`${p.name} ${p.label}`) });
}
