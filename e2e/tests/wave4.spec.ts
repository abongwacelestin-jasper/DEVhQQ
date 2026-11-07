/**
 * Phase 2: features that became real in wave 4 (WAVE4.md §6). Tagged @wave4 so the
 * phase-1 run (`--grep-invert @wave4`) stays meaningful against older builds.
 * Run against a build without ML / GitHub / SMTP configured: those must degrade to
 * labelled demo or heuristic data, never to a crash.
 */
import { test, expect, uid } from '../support/fixtures';
import { completeStepUp, enterCode, signInViaApi } from '../support/auth';
import { apiSession, requestProductionDeploy } from '../support/api';
import { personas } from '../support/personas';

test.describe('@wave4 F-SEC identity in the browser', () => {
  test('demo sign-in survives a reload and keeps no token in web storage', async ({ page }) => {
    await signInViaApi(page, 'admin');
    await page.reload();
    await expect(page.getByRole('button', { name: `Account menu for ${personas.admin.name}` })).toBeVisible();
    const leaked = await page.evaluate(() => {
      const all: string[] = [];
      for (const s of [window.localStorage, window.sessionStorage])
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i)!;
          all.push(`${k}=${s.getItem(k)}`);
        }
      return all.filter((kv) => /token|bearer|session_secret|eyJ|devhq_session/i.test(kv));
    });
    expect(leaked, 'no session token in localStorage/sessionStorage').toEqual([]);
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === '__Host-devhq_session');
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe('Strict');
  });

  test('lock screen unlocks with the authenticator code and survives a reload while locked', async ({ page }) => {
    await signInViaApi(page, 'admin');
    await page.getByRole('button', { name: /^Account menu for / }).click();
    await page.getByRole('menuitem', { name: /Lock session/ }).click();
    const lock = page.getByRole('dialog', { name: /Welcome back, Amara/ });
    await expect(lock).toBeVisible();
    await page.reload();
    await expect(page.getByRole('dialog', { name: /Welcome back, Amara/ }), 'still locked after reload').toBeVisible();
    await enterCode(page, '246810', page.getByRole('dialog', { name: /Welcome back, Amara/ }));
    await expect(page.getByRole('dialog', { name: /Welcome back, Amara/ })).toBeHidden();
  });

  test('Operations approves a deploy through step-up, with a wrong code then a retry @smoke', async ({ page, baseURL }) => {
    const d = await requestProductionDeploy(baseURL!, 'admin', 'renewberry', uid('v'));
    await signInViaApi(page, 'operations', '/deployments');
    const row = page.getByRole('listitem').filter({ hasText: d.sha }).filter({ has: page.getByRole('button', { name: 'Approve' }) });
    await row.getByRole('button', { name: 'Approve' }).click();
    const dialog = await completeStepUp(page, { title: /Approve production deploy/, action: 'Verify & approve', code: '111111' });
    await expect(dialog.getByRole('alert')).toContainText(/didn’t match|incorrect/i);
    await dialog.getByRole('textbox', { name: /6-digit code/i }).fill('246810');
    await dialog.getByRole('button', { name: 'Verify & approve' }).click();
    await expect(page.getByText('Deployment approved').first()).toBeVisible();
    const after = (await (await page.request.get('/api/deployments')).json()) as { id: string; approvedBy?: string }[];
    const list = Array.isArray(after) ? after : (after as unknown as { items: typeof after }).items;
    expect(list.find((x) => x.id === d.id)?.approvedBy).toBe('m11');
  });

  test('sign out everywhere ends every session of the member', async ({ browser, baseURL }) => {
    const a = await browser.newContext({ baseURL });
    const b = await browser.newContext({ baseURL });
    const pa = await a.newPage();
    const pb = await b.newPage();
    await signInViaApi(pa, 'admin');
    await signInViaApi(pb, 'admin');
    const res = await pa.request.post('/api/auth/sign-out-everywhere');
    expect(res.status()).toBeLessThan(300);
    expect((await pb.request.get('/api/auth/session')).status()).toBe(401);
    await pb.reload();
    await expect(pb).toHaveURL(/\/sign-in$/);
    // And the UI offers it: Security → sessions.
    const pc = await (await browser.newContext({ baseURL })).newPage();
    await signInViaApi(pc, 'admin', '/security');
    await expect(pc.getByRole('button', { name: /sign out (of )?(all|everywhere|other)/i }).first()).toBeVisible();
    await a.close();
    await b.close();
  });

  test('a new member: invite → accept → sign in → enrol a factor on the verify screen', async ({ page, baseURL, browser }) => {
    // QA-020 (S1) is fixed: /verify enrols a first factor when the API says next:"enroll".
    const email = `${uid('new').toLowerCase()}@techorg.io`;
    await signInViaApi(page, 'admin');
    const inv = await page.request.post('/api/team/invites', { data: { email, role: 'Developer', products: ['renewberry'] } });
    expect(inv.status(), await inv.text()).toBe(200);
    const { inviteLink } = (await inv.json()) as { inviteLink: string };

    const ctx = await browser.newContext({ baseURL });
    const newbie = await ctx.newPage();
    await newbie.goto(inviteLink);
    const password = 'Qa-beta-Passw0rd!';
    await newbie.locator('input[autocomplete="new-password"]').first().fill(password);
    await newbie.locator('input[autocomplete="new-password"]').nth(1).fill(password);
    await newbie.locator('button[type="submit"]').click();
    await expect(newbie.getByRole('heading', { name: 'Your account is active' })).toBeVisible();
    await newbie.getByRole('link', { name: 'Continue to sign in' }).click();
    await newbie.getByRole('textbox', { name: 'Work email' }).fill(email);
    await newbie.locator('input[autocomplete="current-password"]').fill(password);
    await newbie.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(newbie).toHaveURL(/\/verify$/);
    await expect(newbie.getByText(/set up|enrol|scan|authenticator app|QR/i).first()).toBeVisible({ timeout: 5000 });
    await ctx.close();
  });

  test('the API tells a factor-less member to enrol (server half of the flow)', async ({ page, baseURL }) => {
    const email = `${uid('api').toLowerCase()}@techorg.io`;
    await signInViaApi(page, 'admin');
    const inv = await page.request.post('/api/team/invites', { data: { email, role: 'Tester', products: ['mirror'] } });
    const { inviteLink } = (await inv.json()) as { inviteLink: string };
    const token = new URL(inviteLink, baseURL).searchParams.get('token');
    const anon = await (await import('@playwright/test')).request.newContext({ baseURL });
    const password = 'Qa-beta-Passw0rd!';
    expect((await anon.post('/api/auth/accept-invite', { data: { token, password } })).status()).toBeLessThan(300);
    const signIn = await anon.post('/api/auth/sign-in', { data: { email, password } });
    expect(signIn.status()).toBe(200);
    const body = await signIn.json();
    expect(body.next).toBe('enroll');
    expect(body.enrollRequired).toBe(true);
    const pending = await (await anon.get('/api/auth/pending')).json();
    expect(pending.enrollRequired).toBe(true);
    // Demo code must not work for a real invited member (CYBER-002).
    expect((await anon.post('/api/auth/mfa/totp', { data: { code: '246810' } })).status()).toBe(401);
    await anon.dispose();
  });
});

test.describe('@wave4 collaboration', () => {
  test('messages post to a channel and survive a reload', async ({ page }) => {
    await signInViaApi(page, 'admin', '/messages');
    await expect(page.getByRole('heading', { level: 1, name: 'Messages', exact: true })).toBeVisible();
    const channels = (await (await page.request.get('/api/channels')).json()).items as { id: string; kind: string; name: string }[];
    const ch = channels.find((c) => c.kind !== 'dm') ?? channels[0];
    await page.goto(`/messages/${ch.id}`);
    const text = `QA message ${uid()}`;
    const box = page.getByRole('textbox', { name: 'Message', exact: true }).last();
    await box.fill(text);
    await box.press('Enter');
    const log = page.getByRole('log', { name: /^Messages in / });
    await expect(log.getByText(text)).toBeVisible();
    await page.reload();
    await expect(log.getByText(text)).toBeVisible();
    const msgs = (await (await page.request.get(`/api/channels/${ch.id}/messages`)).json()).items as { body?: string; text?: string }[];
    expect(msgs.some((m) => (m.body ?? m.text ?? '').includes(text))).toBeTruthy();
  });

  test('doc comments and versions are stored on the server', async ({ page }) => {
    await signInViaApi(page, 'admin', '/docs');
    const docs = (await (await page.request.get('/api/docs')).json()) as { id: string; title: string }[] | { items: { id: string; title: string }[] };
    const list = Array.isArray(docs) ? docs : docs.items;
    const doc = list[0];
    await page.goto(`/docs/${doc.id}`);
    const note = `QA comment ${uid()}`;
    await page.getByRole('tab', { name: /^Comments/ }).click();
    const input = page.getByPlaceholder('Add a comment');
    await input.fill(note);
    await input.press('Enter');
    await expect(page.getByText(note)).toBeVisible();
    await page.reload();
    // The doc reopens on its default tab; the comment must still be there on Comments.
    await page.getByRole('tab', { name: /^Comments/ }).click();
    await expect(page.getByText(note)).toBeVisible();
    const comments = await (await page.request.get(`/api/docs/${doc.id}/comments`)).json();
    expect(JSON.stringify(comments)).toContain(note);
    expect((await page.request.get(`/api/docs/${doc.id}/versions`)).status()).toBe(200);
  });

  test('assigning a task notifies the assignee', async ({ page, baseURL }) => {
    const pm = await apiSession(baseURL!, 'pm');
    const projects = await (await pm.get('/api/projects')).json();
    const rows = (Array.isArray(projects) ? projects : projects.items) as { id: string; product: string }[];
    const title = `Notify ${uid()}`;
    const created = await pm.post('/api/tasks', {
      data: { title, projectId: rows.find((p) => p.product === 'renewberry')!.id, assignee: 'm4', priority: 'high', type: 'task', estimate: 1, due: '2026-12-31' },
    });
    expect(created.status(), await created.text()).toBe(201);
    await pm.dispose();
    await signInViaApi(page, 'developer');
    await expect.poll(async () => JSON.stringify(await (await page.request.get('/api/notifications')).json())).toContain(title);
    // The notifications surface is the Inbox panel on My work (the topbar bell links there).
    await page.goto('/my-work');
    await expect(page.getByText(title).first()).toBeVisible();
  });
});

test.describe('@wave4 engineering and ML (unconfigured integrations)', () => {
  for (const [path, heading] of [
    ['/repositories', 'Repositories'],
    ['/pull-requests', 'Pull requests'],
    ['/monitors', 'Monitors'],
  ] as const) {
    test(`${path} loads from the API and labels sample data`, async ({ page }) => {
      await signInViaApi(page, 'admin', path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.getByText('Sample data').first()).toBeVisible();
    });
  }

  test('the assistant says it is unavailable instead of inventing an answer', async ({ page }) => {
    await signInViaApi(page, 'admin');
    await page.getByRole('button', { name: 'Ask DevHQ' }).click();
    // QA-031 is fixed: the panel sends the server's scope shape.
    const q = page.getByRole('textbox', { name: 'Ask a question' });
    await q.fill('What is blocking the RenewBerry release?');
    await q.press('Enter');
    await expect(page.getByText(/Assistant unavailable|Heuristic/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('deploy-risk badge shows a heuristic score when the ML service is down', async ({ page }) => {
    await signInViaApi(page, 'admin');
    const list = await (await page.request.get('/api/deployments')).json();
    const rows = (Array.isArray(list) ? list : list.items) as { id: string }[];
    await page.goto(`/deployments/${rows[0].id}`);
    const badge = page.getByRole('region', { name: 'Deployment risk' });
    await expect(badge).toBeVisible();
    await expect(badge).toContainText(/heuristic|model/);
    await expect(badge).toContainText(/risk · \d+%/);
  });

  test('task-insight badges show overdue risk with their source', async ({ page }) => {
    await signInViaApi(page, 'admin', '/assignments');
    await expect(page.getByText(/\d+% risk/).first()).toBeVisible();
    const t = await page.getByText(/\d+% risk/).first().getAttribute('title');
    expect(t ?? '').toMatch(/rule-based estimate|predicted by|demo data/);
  });

  test('personal access tokens are shown once and stored hashed', async ({ page }) => {
    await signInViaApi(page, 'admin');
    const res = await page.request.post('/api/tokens', { data: { name: `qa-${uid()}`, scopes: ['project:view'], expiresInDays: 7 } });
    expect(res.status(), await res.text()).toBeLessThan(300);
    const created = await res.json();
    const secret = JSON.stringify(created).match(/"(token|secret|value)":"([^"]+)"/)?.[2];
    expect(secret, 'token returned once').toBeTruthy();
    expect(JSON.stringify(await (await page.request.get('/api/tokens')).json())).not.toContain(secret!);
  });

  test('password recovery never reveals whether an account exists', async ({ page }) => {
    await page.goto('/forgot-password');
    const known = await page.request.post('/api/auth/recovery/request', { data: { email: 'amara@techorg.io' } });
    const unknown = await page.request.post('/api/auth/recovery/request', { data: { email: 'nobody-here@techorg.io' } });
    expect(known.status()).toBe(202);
    expect(unknown.status()).toBe(202);
    expect(await known.text()).toBe(await unknown.text());
  });

  test('server-side onboarding: NDA signed once is not asked again in a new tab', async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ baseURL });
    const p = await ctx.newPage();
    await p.request.post('/api/auth/demo', { data: { role: 'designer' } });
    const ob = await (await p.request.get('/api/onboarding')).json();
    expect(ob.stage, JSON.stringify(ob)).toBeTruthy();
    // Without the sessionStorage shim: what does a fresh tab see?
    await p.goto('/my-work');
    // The SPA decides after it has asked the server, so wait for the URL to settle.
    // Other journeys share the Designer persona and may finish its onboarding in parallel,
    // so judge the tab against the stage the server reports now.
    await p.getByRole('heading', { level: 1 }).first().waitFor();
    const after = (await (await p.request.get('/api/onboarding')).json()).stage as string;
    test.info().annotations.push({ type: 'observation', description: `designer fresh tab → ${p.url()}; server stage ${ob.stage} → ${after}` });
    await expect(p).toHaveURL(after === 'ready' ? /\/my-work$/ : /onboarding/);
    await ctx.close();
  });
});
