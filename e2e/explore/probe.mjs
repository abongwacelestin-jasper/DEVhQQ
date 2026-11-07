// Ad-hoc probe used while writing the suite: node explore/probe.mjs <baseURL> <role> <path...>
import { chromium } from '@playwright/test';

const [base, role = 'admin', ...paths] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: base });
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && console.log('[console.error]', m.text()));
const r = await page.request.post('/api/auth/demo', { data: { role } });
console.log('demo', r.status());
console.log('cookies', (await ctx.cookies()).map((c) => `${c.name} secure=${c.secure}`));
for (const p of paths.length ? paths : ['/']) {
  await page.goto(p, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(1500);
  console.log('\n=== ', p, '→', page.url());
  console.log((await page.locator('body').innerText()).slice(0, 2500));
}
await browser.close();
