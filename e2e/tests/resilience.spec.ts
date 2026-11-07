/**
 * What a user sees when the network or the API misbehaves. The shared backend is never
 * killed (other workers use it); instead the browser's view of it is cut: every /api
 * call is refused at the network layer (what the proxy gives when the API process
 * dies) or answered 502 (what an edge in front of a dead backend gives).
 */
import { test, expect } from '../support/fixtures';
import { signInViaApi } from '../support/auth';

test.describe('Resilience', () => {
  for (const mode of ['connection refused', 'HTTP 502'] as const) {
    test(`backend gone mid-session (${mode}) gives an error state, not a white screen`, async ({ page }) => {
      await signInViaApi(page, 'admin', '/my-work');
      await expect(page.getByRole('heading', { level: 1, name: 'My work' })).toBeVisible();
      await page.route('**/api/**', (route) =>
        mode === 'HTTP 502'
          ? route.fulfill({ status: 502, contentType: 'text/html', body: '<h1>502 Bad Gateway</h1>' })
          : route.abort('connectionrefused'),
      );
      // Navigate inside the app, then try a write.
      await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Deployments' }).click();
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const text = (await page.locator('body').innerText()).trim();
      expect(text.length, 'page still renders').toBeGreaterThan(100);

      await page.goto('/team').catch(() => undefined); // full reload with the API down
      const body = (await page.locator('body').innerText()).trim();
      expect(body.length, 'not a blank page after reload').toBeGreaterThan(20);
      // A sensible state names the problem (offline / unavailable / try again) instead of
      // silently treating the user as signed out.
      await expect(page.getByText(/unavailable|offline|can’t reach|cannot reach|try again|connection/i).first()).toBeVisible();
    });
  }

  test('slow API shows loading skeletons, then the data', async ({ page }) => {
    await signInViaApi(page, 'admin', '/');
    await page.route('**/api/**', async (route) => {
      if (route.request().url().includes('/api/_events')) return route.continue();
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Team & roles' }).click();
    await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible();
    // The skeleton is a fixed 420 ms timer (useRouteLoading). With a 2.5 s API it is
    // gone long before the data arrives; what shows in between is what we check.
    await page.waitForTimeout(1000);
    const loadingStill = await page.getByRole('status', { name: 'Loading' }).isVisible().catch(() => false);
    const noteLoading = await page.getByText('Loading…').first().isVisible().catch(() => false);
    test.info().annotations.push({ type: 'observation', description: `after 1s: skeleton=${loadingStill} "Loading…" note=${noteLoading}` });
    expect(loadingStill || noteLoading, 'something says the data is still loading').toBeTruthy();
    await expect(page.getByRole('heading', { level: 1, name: 'Team & roles' })).toBeVisible({ timeout: 20_000 });
  });

  test('a failed write tells the user and does not pretend it saved', async ({ page }) => {
    await signInViaApi(page, 'developer', '/my-work');
    const status = page.getByRole('combobox', { name: /^Status of / }).first();
    await expect(status).toBeVisible();
    const before = await status.inputValue();
    const next = before === 'review' ? 'in-progress' : 'review';
    await page.route('**/api/tasks/**', (route) =>
      route.request().method() === 'PATCH' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'Service unavailable', requestId: 'qa' } }) }) : route.continue(),
    );
    await status.selectOption(next);
    await expect(page.getByText(/failed|couldn’t|could not|unavailable/i).first()).toBeVisible();
    await expect(status).toHaveValue(before);
  });
});
