/**
 * Behaviour every persona relies on: lock and session lifetime, routing, scope,
 * preferences, small screens and the keyboard.
 */
import { test, expect } from '../support/fixtures';
import { enterCode, seedOnboarding, signInViaApi } from '../support/auth';
import { personas } from '../support/personas';

test.describe('Session lifetime', () => {
  test('idle lock covers the app and unlocks with a one-time code @smoke', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('devhq.idle-minutes', '1'));
    await page.clock.install();
    await signInViaApi(page, 'admin');
    await page.clock.fastForward('00:45');
    await expect(page.getByText(/lock|idle/i).first()).toBeVisible();
    await page.clock.fastForward('00:30');

    const lock = page.getByRole('dialog', { name: personas.admin.name });
    await expect(lock).toBeVisible();
    await enterCode(page, '000000', lock);
    await expect(lock.getByText(/didn’t match|incorrect|try again/i).first()).toBeVisible();
    await enterCode(page, '246810', lock);
    await expect(lock).toBeHidden();
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  });

  test('a locked tab stays locked after a reload', async ({ page }) => {
    test.fail(true, 'QA-004: the lock is client state only; reloading the page drops it and the app is usable without a code');
    await signInViaApi(page, 'admin');
    await page.getByRole('button', { name: /^Account menu for / }).click();
    await page.getByRole('menuitem', { name: /Lock session/ }).click();
    const lock = page.getByRole('dialog', { name: personas.admin.name });
    await expect(lock).toBeVisible();
    await page.reload();
    await expect(page.getByRole('dialog', { name: personas.admin.name })).toBeVisible();
  });

  test('a session ended on the server sends the tab to sign-in, not a broken page', async ({ page }) => {
    await signInViaApi(page, 'admin');
    // Same cookie jar as the tab: this is "signed out from another tab/device".
    expect((await page.request.post('/api/auth/sign-out')).status()).toBeLessThan(300);
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Team & roles' }).click();
    await expect(page).toHaveURL(/\/sign-in$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Sign in to DevHQ' })).toBeVisible();
  });

  test('expired cookie on reload lands on sign-in', async ({ page, context }) => {
    await signInViaApi(page, 'developer');
    await context.clearCookies();
    await page.reload();
    await expect(page).toHaveURL(/\/sign-in$/);
  });
});

test.describe('Routing', () => {
  test('an unknown URL shows a 404 page', async ({ page }) => {
    test.fail(true, 'QA-005: there is no 404 route; "*" silently redirects to the home page');
    await signInViaApi(page, 'admin', '/this-page-does-not-exist');
    await expect(page.getByText(/404|not found|doesn’t exist/i).first()).toBeVisible();
    await expect(page).toHaveURL(/this-page-does-not-exist/);
  });

  test('a deep link to a task opens that task', async ({ page }) => {
    await signInViaApi(page, 'admin', '/tasks/RB-212');
    await expect(page).toHaveURL(/\/tasks\/RB-212$/);
    await expect(page.getByText('RB-212').first()).toBeVisible();
  });

  test('a deep link survives the sign-in detour', async ({ page }) => {
    test.fail(true, 'QA-006: after sign-in the user lands on the role home, the requested URL is lost');
    await page.goto('/tasks/RB-212');
    await expect(page).toHaveURL(/\/sign-in/);
    await seedOnboarding(page.context(), 'admin');
    await page.getByRole('button', { name: /^Admin demo/ }).click();
    await expect(page).toHaveURL(/\/tasks\/RB-212$/);
  });

  test('an unknown task key shows a not-found state', async ({ page }) => {
    await signInViaApi(page, 'admin', '/tasks/ZZ-99999');
    await expect(page.getByText(/not found|doesn’t exist|no task|isn’t available/i).first()).toBeVisible();
  });

  test('an out-of-scope product is hidden (developer → Blog)', async ({ page }) => {
    await signInViaApi(page, 'developer', '/products/blog');
    await expect(page.getByText(/403|not found|No access|isn’t/i).first()).toBeVisible();
    expect((await page.request.get('/api/deployments?product=blog')).status()).toBeLessThan(500);
    const rows = (await (await page.request.get('/api/tasks')).json()) as { product?: string; key: string }[];
    const list = Array.isArray(rows) ? rows : (rows as unknown as { items: typeof rows }).items;
    expect(list.every((t) => !t.key.startsWith('BL-'))).toBeTruthy();
  });
});

test.describe('Scope and preferences', () => {
  test('switching product scope hides out-of-scope data', async ({ page }) => {
    await signInViaApi(page, 'admin', '/deployments');
    const pending = page.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Approve' }) });
    await expect(pending.first()).toBeVisible();
    await page.getByRole('button', { name: /^Scope: / }).click();
    await page.getByRole('option', { name: /^Blog/ }).first().click();
    await expect(page.getByRole('button', { name: /^Scope: Blog/ })).toBeVisible();
    await expect(page.locator('main').getByText('RenewBerry production')).toHaveCount(0);
    await expect(page.locator('main').getByText('Mirror Acture production')).toHaveCount(0);
  });

  test('language and theme choices persist across a reload @smoke', async ({ page }) => {
    await signInViaApi(page, 'admin');
    await page.getByRole('button', { name: /^Account menu for / }).click();
    await page.getByRole('radio', { name: 'Dark' }).click();
    await page.getByRole('radio', { name: 'FR' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByRole('navigation', { name: 'Primary' }).getByText('Mon travail')).toBeVisible();
  });

  test('French translation covers page content, not just navigation', async ({ page }) => {
    test.fail(true, 'QA-014: only nav/topbar strings are translated; page headings and bodies stay English');
    await page.addInitScript(() => window.localStorage.setItem('devhq.lang', 'fr'));
    await signInViaApi(page, 'admin', '/my-work');
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('My work');
  });
});

test.describe('Mobile viewport', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('bottom nav and the More sheet reach every section @smoke', async ({ page }) => {
    await signInViaApi(page, 'admin');
    const bottom = page.getByRole('navigation', { name: 'Quick navigation' });
    await expect(bottom).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
    await bottom.getByRole('button', { name: /more/i }).click();
    const sheet = page.getByRole('dialog', { name: 'All sections' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('link', { name: /Audit log/ }).click();
    await expect(page).toHaveURL(/\/audit$/);
    await expect(sheet).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no horizontal scroll at 375px').toBeLessThanOrEqual(1);
  });
});

test.describe('Keyboard', () => {
  test('sign-in works with the keyboard alone', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'Work email' }).focus();
    await page.keyboard.type('amara@techorg.io');
    await page.keyboard.press('Tab');
    // Next stop should be the password field (the "Forgot password?" link sits in its label).
    let focused = await page.evaluate(() => document.activeElement?.getAttribute('autocomplete') ?? document.activeElement?.textContent);
    if (focused !== 'current-password') {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => document.activeElement?.getAttribute('autocomplete') ?? '');
    }
    expect(focused).toBe('current-password');
    await page.keyboard.type('devhq-demo');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/verify$/);
  });

  test('every sign-in control shows a visible focus indicator', async ({ page }) => {
    await page.goto('/sign-in');
    const missing: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const s = getComputedStyle(el);
        const ring = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
        const shadow = s.boxShadow && s.boxShadow !== 'none';
        return { name: (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40), ok: ring || !!shadow };
      });
      if (r && !r.ok) missing.push(r.name);
    }
    test.info().annotations.push({ type: 'no-focus-ring', description: missing.join(' | ') || 'none' });
    expect(missing, 'controls without a visible focus style').toEqual([]);
  });

  test('⌘K opens the command menu, arrow keys and Enter navigate, Esc closes', async ({ page }) => {
    await signInViaApi(page, 'admin');
    await page.keyboard.press('ControlOrMeta+k');
    const menu = page.getByRole('dialog', { name: 'Command menu' });
    await expect(menu).toBeVisible();
    const input = menu.getByRole('combobox', { name: 'Search query' });
    await expect(input).toBeFocused();
    await input.fill('audit');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/\/audit/);

    await page.keyboard.press('ControlOrMeta+k');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
});

test.describe('Onboarding', () => {
  test('a new tab does not ask a member to sign the NDA again', async ({ browser, baseURL }) => {
    test.fail(true, 'QA-012: NDA/profile completion is stored in sessionStorage; every new tab restarts onboarding');
    const context = await browser.newContext({ baseURL });
    const first = await context.newPage();
    await seedOnboarding(context, 'tester'); // the first tab "completed" onboarding
    await first.request.post('/api/auth/demo', { data: { role: 'tester' } });
    await first.goto('/test-queue');
    await expect(first).toHaveURL(/\/test-queue$/);
    const fresh = await browser.newContext({ baseURL, storageState: await context.storageState() });
    const second = await fresh.newPage();
    await second.goto('/test-queue');
    await expect(second).toHaveURL(/\/test-queue$/);
    await context.close();
    await fresh.close();
  });

  test('a first-time member is walked through NDA and profile', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('button', { name: /^Tester/ }).click();
    await expect(page).toHaveURL(/\/onboarding\/nda$/);
    await expect(page.getByRole('tablist', { name: 'Agreement sections' })).toBeVisible();
  });
});
