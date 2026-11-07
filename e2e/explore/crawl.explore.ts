/**
 * Scripted exploratory pass. For every persona × main route × viewport it records:
 * where the route lands, whether the no-access page shows, the page heading, console
 * errors, uncaught exceptions, failed or 4xx/5xx /api calls, horizontal overflow,
 * unnamed buttons/links, dead links (href="#" or empty) and "demo/sample/mock" copy.
 *
 * Output: docs/qa/evidence/explore-<role>.json and screenshots under
 * docs/qa/screenshots/explore/ (1280 px for all, plus any route that overflows).
 * It never fails on findings — triage happens in BETA_REPORT.md.
 */
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedOnboarding } from '../support/auth';
import { MAIN_ROUTES, personas, type RoleKey } from '../support/personas';

const here = dirname(fileURLToPath(import.meta.url));
const evidence = join(here, '..', '..', 'docs', 'qa', 'evidence');
const shots = join(here, '..', '..', 'docs', 'qa', 'screenshots', 'explore');
mkdirSync(evidence, { recursive: true });
mkdirSync(shots, { recursive: true });

const VIEWPORTS = [
  { name: '1280', width: 1280, height: 800 },
  { name: '768', width: 768, height: 1024 },
  { name: '375', width: 375, height: 812 },
] as const;

const roles = (process.env.EXPLORE_ROLES?.split(',') as RoleKey[] | undefined) ?? (Object.keys(personas) as RoleKey[]);

for (const role of roles) {
  test(`explore as ${role}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL });
    await seedOnboarding(context, role);
    const page = await context.newPage();
    const res = await page.request.post('/api/auth/demo', { data: { role } });
    if (res.status() !== 200) throw new Error(`demo sign-in ${role} → ${res.status()}`);

    let bucket: { console: string[]; errors: string[]; api: string[] } = { console: [], errors: [], api: [] };
    page.on('console', (m) => m.type() === 'error' && bucket.console.push(m.text().slice(0, 300)));
    page.on('pageerror', (e) => bucket.errors.push(e.message.slice(0, 300)));
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/') && r.status() >= 400)
        bucket.api.push(`${r.request().method()} ${u.pathname}${u.search} → ${r.status()}`);
    });
    page.on('requestfailed', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/_events')) return;
      bucket.api.push(`${r.method()} ${u.pathname} → ${r.failure()?.errorText}`);
    });

    const rows: unknown[] = [];
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of MAIN_ROUTES) {
        bucket = { console: [], errors: [], api: [] };
        // Client-side navigation (what a user's click does); a full Vite reload per route costs ~5 s.
        if (new URL(page.url()).origin !== new URL(baseURL ?? page.url()).origin || page.url() === 'about:blank') {
          await page.goto(route, { waitUntil: 'load' });
        } else {
          await page.evaluate((r) => {
            window.history.pushState({}, '', r);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }, route);
        }
        // The route skeleton is a fixed 420 ms timer; SSE keeps the network busy, so no networkidle.
        await page.waitForTimeout(1200);
        const info = await page.evaluate(() => {
          const doc = document.documentElement;
          const visible = (el: Element) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
          };
          const nameOf = (el: Element) =>
            (el.getAttribute('aria-label') ?? '').trim() ||
            (el.getAttribute('title') ?? '').trim() ||
            (el.textContent ?? '').trim() ||
            (el.getAttribute('aria-labelledby') ? 'labelledby' : '');
          const unnamedButtons = [...document.querySelectorAll('button, [role="button"]')]
            .filter(visible)
            .filter((b) => !nameOf(b))
            .map((b) => (b as HTMLElement).outerHTML.slice(0, 160));
          const deadLinks = [...document.querySelectorAll('a')]
            .filter(visible)
            .filter((a) => {
              const h = a.getAttribute('href');
              return h === null || h === '' || h === '#' || h.startsWith('javascript:');
            })
            .map((a) => `${(a.textContent ?? '').trim().slice(0, 60)} [href=${a.getAttribute('href')}]`);
          const wide = [...document.querySelectorAll('main *')]
            .filter(visible)
            .filter((el) => (el as HTMLElement).getBoundingClientRect().right > window.innerWidth + 1)
            .slice(0, 5)
            .map((el) => `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(' ').slice(0, 3).join('.')}`);
          const text = document.body.innerText;
          const mockCopy = [...new Set((text.match(/[^\n]*\b(demo|sample|mock|placeholder|lorem|coming soon|simulated|fake)\b[^\n]*/gi) ?? []).map((s) => s.trim().slice(0, 140)))].slice(0, 8);
          return {
            h1: [...document.querySelectorAll('h1')].map((h) => h.textContent?.trim()).filter(Boolean),
            noAccess: text.includes('403 · No access'),
            overflowX: doc.scrollWidth > window.innerWidth + 1,
            scrollWidth: doc.scrollWidth,
            wide,
            unnamedButtons: unnamedButtons.slice(0, 10),
            unnamedButtonCount: unnamedButtons.length,
            deadLinks: deadLinks.slice(0, 10),
            mockCopy,
            empty: text.trim().length < 40,
          };
        }).catch(async (e: Error) => {
          // A client-side redirect raced the probe; record it rather than abort the crawl.
          await page.waitForTimeout(800);
          return { h1: [], noAccess: false, overflowX: false, scrollWidth: 0, wide: [], unnamedButtons: [], unnamedButtonCount: 0, deadLinks: [], mockCopy: [], empty: false, probeError: e.message.slice(0, 200) };
        });
        const landed = new URL(page.url()).pathname;
        const slug = `${role}-${vp.name}-${route.replace(/\//g, '_') || 'root'}`;
        if (vp.name === '1280' || info.overflowX)
          await page.screenshot({ path: join(shots, `${slug}.png`), fullPage: false });
        rows.push({ role, viewport: vp.name, route, landed, ...info, ...bucket, screenshot: `docs/qa/screenshots/explore/${slug}.png` });
      }
    }
    writeFileSync(join(evidence, `explore-${role}.json`), JSON.stringify(rows, null, 2));
    await context.close();
  });
}
