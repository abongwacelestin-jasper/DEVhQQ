import { chromium, type FullConfig } from '@playwright/test';

/**
 * Warm-up, not state: Vite's dev server optimises dependencies on first request and
 * may force a full reload when it discovers a new one. Doing that before the first
 * test keeps "reload in the middle of a journey" out of the results.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  const res = await page.request.get('/api/health');
  if (!res.ok()) throw new Error(`Backend not healthy through ${baseURL}/api/health: ${res.status()}`);
  await page.request.post('/api/auth/demo', { data: { role: 'admin' } });
  for (const path of ['/', '/my-work', '/docs', '/deployments', '/team', '/code']) {
    await page.goto(path, { waitUntil: 'load', timeout: 180_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  }
  await page.request.post('/api/auth/sign-out');
  await browser.close();
}
