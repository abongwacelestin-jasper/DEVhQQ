import { test as base, expect, type Page, type TestInfo } from '@playwright/test';

export interface Diagnostics {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
}

/** Attaches listeners that record console errors, uncaught exceptions and failed /api calls. */
export function watch(page: Page): Diagnostics {
  const d: Diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  page.on('console', (m) => {
    if (m.type() === 'error') d.consoleErrors.push(m.text().slice(0, 500));
  });
  page.on('pageerror', (e) => d.pageErrors.push(`${e.name}: ${e.message}`.slice(0, 500)));
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? 'failed';
    // Navigations aborted by the router and long-poll SSE teardown are not defects.
    if (f.includes('ERR_ABORTED') && (r.url().includes('/api/_events') || r.resourceType() === 'document')) return;
    d.failedRequests.push(`${r.method()} ${new URL(r.url()).pathname} — ${f}`);
  });
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.status() >= 500)
      d.failedRequests.push(`${r.request().method()} ${u.pathname} — HTTP ${r.status()}`);
  });
  return d;
}

export async function attachDiagnostics(testInfo: TestInfo, d: Diagnostics) {
  const any = d.consoleErrors.length + d.pageErrors.length + d.failedRequests.length;
  if (any) await testInfo.attach('diagnostics.json', { body: JSON.stringify(d, null, 2), contentType: 'application/json' });
}

/**
 * `diag` is recorded for every test. Uncaught page exceptions fail the test (a white
 * screen is never acceptable); console errors and failed calls are attached as evidence
 * and asserted on explicitly where a journey depends on them.
 */
export const test = base.extend<{ diag: Diagnostics }>({
  diag: [
    async ({ page }, use, testInfo) => {
      const d = watch(page);
      await use(d);
      await attachDiagnostics(testInfo, d);
      expect(d.pageErrors, 'uncaught exceptions in the page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Unique, human-readable suffix so parallel tests never collide on shared server state. */
export function uid(prefix = 'QA') {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
