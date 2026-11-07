/**
 * axe-core (WCAG 2.1 A/AA) on every main route and the auth screens.
 * Each route is its own test so one bad page never hides another. Every violation is
 * attached to the test and appended to test-results/axe/<route>.json; the
 * tests fail only on "critical" impact, and docs/qa/BETA_REPORT.md triages the rest.
 */
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../support/fixtures';
import { signInViaApi } from '../support/auth';
import { AUTH_ROUTES, MAIN_ROUTES } from '../support/personas';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-results', 'axe');
mkdirSync(out, { recursive: true });

async function audit(page: import('@playwright/test').Page, route: string, theme: 'light' | 'dark') {
  // Let the 420 ms route skeleton and entry animations settle; axe on a skeleton is noise.
  await page.waitForTimeout(1200);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('[data-sonner-toaster]')
    .analyze();
  const rows = result.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.length,
    sample: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
  writeFileSync(join(out, `${theme}${route.replace(/\//g, '_') || '_root'}.json`), JSON.stringify({ route, theme, rows }, null, 2));
  await test.info().attach('axe.json', { body: JSON.stringify(rows, null, 2), contentType: 'application/json' });
  return rows;
}

test.describe('Accessibility (axe)', () => {
  for (const route of AUTH_ROUTES) {
    test(`auth ${route}`, async ({ page }) => {
      await page.goto(route);
      const rows = await audit(page, route, 'light');
      expect(rows.filter((r) => r.impact === 'critical')).toEqual([]);
    });
  }

  for (const route of MAIN_ROUTES) {
    test(`app ${route}`, async ({ page }) => {
      await signInViaApi(page, 'admin', route);
      const rows = await audit(page, route, 'light');
      expect(rows.filter((r) => r.impact === 'critical')).toEqual([]);
    });
  }

  for (const route of ['/', '/my-work', '/deployments', '/team'] as const) {
    test(`dark theme ${route}`, async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem('devhq.theme', 'dark'));
      await signInViaApi(page, 'admin', route);
      const rows = await audit(page, route, 'dark');
      expect(rows.filter((r) => r.impact === 'critical')).toEqual([]);
    });
  }
});
