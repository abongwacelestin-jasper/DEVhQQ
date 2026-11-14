/**
 * Clicks every visible button on every main route (and the first detail page of
 * each kind) as one persona, and records for each click: uncaught exceptions,
 * console errors, failed or 4xx/5xx /api calls, and "dead" buttons: a click that
 * changed nothing in the DOM, sent no request, started no download or file
 * picker and did not navigate. BUTTON_ROUTES=/team,/activity limits the routes.
 *
 * Output: docs/qa/evidence/buttons-<role>.json. Like the crawl, it never fails on
 * findings. Run: BUTTON_ROLE=admin npx playwright test --project=explore buttons
 * Sign out / lock are skipped (they end the session the pass depends on).
 */
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeOnboarding, seedOnboarding } from '../support/auth';
import { MAIN_ROUTES, type RoleKey } from '../support/personas';

const here = dirname(fileURLToPath(import.meta.url));
const evidence = join(here, '..', '..', 'docs', 'qa', 'evidence');
mkdirSync(evidence, { recursive: true });

const role = (process.env.BUTTON_ROLE as RoleKey | undefined) ?? 'admin';
const MAX_PER_PAGE = Number(process.env.BUTTON_MAX ?? 45);
const SKIP = /sign out|log out|lock (screen|now)|^lock$/i;
const DETAIL =
  /^\/(projects|tasks|docs|repositories|pull-requests|deployments|incidents|team|integrations|messages)\/[^/]+$/;

test(`click every button as ${role}`, async ({ browser, baseURL }) => {
  test.setTimeout(45 * 60_000);
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedOnboarding(context, role);
  const page = await context.newPage();
  const res = await page.request.post('/api/auth/demo', { data: { role } });
  if (res.status() !== 200) throw new Error(`demo sign-in ${role} → ${res.status()}`);
  await completeOnboarding(page.request, role);

  let bucket = {
    console: [] as string[],
    errors: [] as string[],
    api: [] as string[],
    requests: 0,
    downloads: 0,
  };
  page.on('console', (m) => m.type() === 'error' && bucket.console.push(m.text().slice(0, 300)));
  page.on('pageerror', (e) => bucket.errors.push(e.message.slice(0, 300)));
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/_events')) bucket.requests++;
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.status() >= 400)
      bucket.api.push(`${r.request().method()} ${u.pathname} → ${r.status()}`);
  });
  page.on('download', () => bucket.downloads++);
  page.on('filechooser', () => bucket.downloads++);
  page.on('dialog', (d) => void d.dismiss().catch(() => {}));

  const open = async (route: string) => {
    await page.goto(route, { waitUntil: 'load' });
    await page.waitForTimeout(1100);
  };
  const buttons = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('button, [role="button"]')].map((el, i) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const s = getComputedStyle(el);
        const visible =
          r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
        const name =
          (el.getAttribute('aria-label') ?? '').trim() ||
          (el.getAttribute('title') ?? '').trim() ||
          (el.textContent ?? '').trim().replace(/\s+/g, ' ');
        return {
          i,
          name: name.slice(0, 70),
          visible,
          disabled:
            (el as HTMLButtonElement).disabled === true ||
            el.getAttribute('aria-disabled') === 'true',
        };
      }),
    );

  const only = process.env.BUTTON_ROUTES?.split(',');
  const queue: string[] = only ?? [...MAIN_ROUTES];
  const seenKinds = new Set<string>();
  const rows: unknown[] = [];

  for (let q = 0; q < queue.length; q++) {
    const route = queue[q];
    await open(route);
    const landed = new URL(page.url()).pathname;
    if (landed !== route && !DETAIL.test(route)) {
      rows.push({ route, landed, note: 'redirected; not clicked' });
      continue;
    }
    // Queue the first detail page of each kind linked from this page.
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? ''),
    );
    for (const h of hrefs) {
      const m = DETAIL.exec(h.split('?')[0]);
      if (m && !seenKinds.has(m[1])) {
        seenKinds.add(m[1]);
        queue.push(h.split('?')[0]);
      }
    }

    const initial = (await buttons()).filter((b) => b.visible && !b.disabled && !SKIP.test(b.name));
    const todo = initial.slice(0, MAX_PER_PAGE);
    const clicks: unknown[] = [];
    for (const b of todo) {
      // Back to a clean page when the last click navigated or left something open.
      const at = new URL(page.url());
      if (at.pathname + at.search !== route) await open(route);
      const now = await buttons();
      const target = now[b.i];
      if (!target || target.name !== b.name || !target.visible) {
        await open(route);
        const again = (await buttons())[b.i];
        if (!again || again.name !== b.name || !again.visible) {
          clicks.push({ name: b.name, note: 'not found after reset' });
          continue;
        }
      }
      bucket = { console: [], errors: [], api: [], requests: 0, downloads: 0 };
      await page.evaluate(() => {
        const w = window as unknown as { __mut: number; __obs?: MutationObserver };
        w.__obs?.disconnect();
        w.__mut = 0;
        w.__obs = new MutationObserver((l) => (w.__mut += l.length));
        w.__obs.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
      });
      const el = page.locator('button, [role="button"]').nth(b.i);
      let clickError: string | undefined;
      await el
        .click({ timeout: 2500 })
        .catch((e: Error) => (clickError = e.message.split('\n')[0].slice(0, 160)));
      await page.waitForTimeout(650);
      const after = new URL(page.url());
      const mutated = await page
        .evaluate(() => (window as unknown as { __mut: number }).__mut ?? -1)
        .catch(() => -1);
      const navigated =
        after.pathname + after.search + after.hash !== new URL(route, after.origin).pathname;
      const dead =
        !clickError &&
        !navigated &&
        mutated === 0 &&
        bucket.requests === 0 &&
        bucket.downloads === 0;
      const row: Record<string, unknown> = { name: b.name };
      if (clickError) row.clickError = clickError;
      if (dead) row.dead = true;
      if (navigated) row.navigated = after.pathname + after.search;
      if (bucket.errors.length) row.errors = bucket.errors;
      if (bucket.console.length) row.console = bucket.console;
      if (bucket.api.length) row.api = [...new Set(bucket.api)];
      clicks.push(row);
      await page.keyboard.press('Escape').catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(120);
    }
    rows.push({ route, buttons: initial.length, clicked: todo.length, clicks });
    writeFileSync(
      join(evidence, `buttons-${role}${only ? '-partial' : ''}.json`),
      JSON.stringify(rows, null, 2),
    );
  }
  await context.close();
});
