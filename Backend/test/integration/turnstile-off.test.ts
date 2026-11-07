/**
 * Cloudflare Turnstile with TURNSTILE_MODE=off (the default): every protected
 * route behaves exactly as before, from a browser and without a token, and
 * Cloudflare is never contacted. Mode on: turnstile.test.ts.
 */
import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, type TestServer } from '../helpers/server.ts';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, signInAs } from '../helpers/auth.ts';

delete process.env.TURNSTILE_MODE;
delete process.env.TURNSTILE_SITE_KEY;
delete process.env.TURNSTILE_SECRET_KEY;
delete process.env.TURNSTILE_SECRET_KEY_FILE;

const BROWSER = { Origin: 'http://localhost:5173', 'Sec-Fetch-Site': 'same-origin' };
const realFetch = globalThis.fetch;
let cloudflareCalls = 0;

let app: TestServer;
before(async () => {
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('https://challenges.cloudflare.com/')) cloudflareCalls++;
    return realFetch(input, init);
  }) as typeof fetch;
  app = await startApp();
});
after(async () => {
  globalThis.fetch = realFetch;
  await app.close();
});

describe('turnstile off (default)', () => {
  it('GET /api/auth/config says off and publishes no site key', async () => {
    const res = await app.client().get('/api/auth/config');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { turnstile: { mode: 'off', siteKey: null } });
  });

  it('browser password sign-in needs no token', async () => {
    const res = await app
      .client()
      .post(
        '/api/auth/sign-in',
        { email: DEMO_ACCOUNTS.developer.email, password: DEMO_PASSWORD },
        { headers: BROWSER },
      );
    assert.equal(res.status, 200, res.text);
  });

  it('browser demo sign-in needs no token', async () => {
    const res = await app.client().post('/api/auth/demo', { role: 'tester' }, { headers: BROWSER });
    assert.equal(res.status, 200, res.text);
  });

  it('browser recovery request needs no token', async () => {
    const res = await app
      .client()
      .post('/api/auth/recovery/request', { email: 'amara@techorg.io' }, { headers: BROWSER });
    assert.equal(res.status, 202, res.text);
  });

  it('browser accept-invite needs no token', async () => {
    const owner = await signInAs(app, 'admin');
    const inv = await owner.post<{ inviteLink: string }>('/api/team/invites', {
      email: `ts-off-${Date.now()}@techorg.io`,
      role: 'Developer',
      products: ['renewberry'],
    });
    assert.equal(inv.status, 200, inv.text);
    const token = new URL(inv.json.inviteLink, 'http://x').searchParams.get('token')!;
    const res = await app
      .client()
      .post(
        '/api/auth/accept-invite',
        { token, password: 'Correct-Horse-42!' },
        { headers: BROWSER },
      );
    assert.equal(res.status, 200, res.text);
  });

  it('a stray turnstileToken field is accepted and ignored', async () => {
    const res = await app
      .client()
      .post(
        '/api/auth/sign-in',
        { email: DEMO_ACCOUNTS.pm.email, password: DEMO_PASSWORD, turnstileToken: 'anything' },
        { headers: BROWSER },
      );
    assert.equal(res.status, 200, res.text);
  });

  it('never contacts Cloudflare', () => {
    assert.equal(cloudflareCalls, 0);
  });
});
