// Ad-hoc probe of the password → MFA path: node explore/probe-password.mjs <baseURL>
import { chromium } from '@playwright/test';

const [base] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: base });
const page = await ctx.newPage();
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 200)));
page.on('response', (r) => r.url().includes('/api/') && console.log('[api]', r.status(), r.request().method(), new URL(r.url()).pathname));
page.on('framenavigated', (f) => f === page.mainFrame() && console.log('[nav]', f.url()));
await page.goto('/sign-in');
await page.getByRole('textbox', { name: 'Work email' }).fill('amara@techorg.io');
await page.locator('input[autocomplete="current-password"]').fill('devhq-demo');
await page.getByRole('button', { name: 'Continue', exact: true }).click();
await page.waitForTimeout(4000);
console.log('URL', page.url());
console.log((await page.locator('main').innerText()).slice(0, 600));
await browser.close();
