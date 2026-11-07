/**
 * Cloudflare Turnstile with TURNSTILE_MODE=on, over HTTP against the real app.
 * siteverify is stubbed in-process (no network): the stub decides by token
 * prefix — `good:<action>:…` passes for that action, `bad:…` is rejected,
 * `down:…` throws as if Cloudflare were unreachable.
 *
 * Mode off is covered by turnstile-off.test.ts (config is read once per process).
 */
import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import { DEMO_ACCOUNTS, DEMO_MFA_CODE, DEMO_PASSWORD, signInAs } from '../helpers/auth.ts';

// Must be set before the app (and config/env.ts) loads in before().
process.env.TURNSTILE_MODE = 'on';
process.env.TURNSTILE_SITE_KEY = '0x4AAAAAAAintegrationSite';
process.env.TURNSTILE_SECRET_KEY = '0x4AAAAAAAintegrationSecret0123456789';
delete process.env.TURNSTILE_SECRET_KEY_FILE;
delete process.env.TURNSTILE_FAIL_OPEN;
delete process.env.TURNSTILE_EXEMPT_CLI;

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const ORIGIN = 'http://localhost:5173'; // test APP_ORIGIN default
const BROWSER = { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' };

const realFetch = globalThis.fetch;
const verifyCalls: { response: string; remoteip?: string }[] = [];

function stubSiteverify(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (String(input) !== SITEVERIFY) return realFetch(input, init);
  const body = JSON.parse(String(init?.body)) as { response: string; remoteip?: string };
  verifyCalls.push(body);
  const [kind, action] = body.response.split(':');
  if (kind === 'down') return Promise.reject(new Error('ENOTFOUND challenges.cloudflare.com'));
  const ok = kind === 'good';
  return Promise.resolve(
    new Response(
      JSON.stringify(
        ok
          ? { success: true, hostname: 'localhost', action, 'error-codes': [] }
          : { success: false, 'error-codes': ['invalid-input-response'] },
      ),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
}

let n = 0;
const token = (kind: 'good' | 'bad' | 'down', action = 'sign-in') => `${kind}:${action}:${++n}`;

let app: TestServer;
before(async () => {
  globalThis.fetch = stubSiteverify as typeof fetch;
  app = await startApp();
});
after(async () => {
  globalThis.fetch = realFetch;
  await app.close();
});

/** A browser-like client: the Client helper's CLI header plus the headers every browser sends. */
const browser = (c: Client = app.client()) => ({
  c,
  post: (path: string, body: unknown) => c.post(path, body, { headers: BROWSER }),
});

const signIn = (extra: Record<string, unknown> = {}) => ({
  email: DEMO_ACCOUNTS.developer.email,
  password: DEMO_PASSWORD,
  ...extra,
});

async function newInvite(): Promise<string> {
  const owner = await signInAs(app, 'admin'); // CLI client: exempt
  const inv = await owner.post<{ inviteLink: string }>('/api/team/invites', {
    email: `ts-${Date.now()}-${++n}@techorg.io`,
    role: 'Developer',
    products: ['renewberry'],
  });
  assert.equal(inv.status, 200, inv.text);
  return new URL(inv.json.inviteLink, 'http://x').searchParams.get('token')!;
}

describe('turnstile on — public config', () => {
  it('GET /api/auth/config publishes the mode and the site key, never the secret', async () => {
    const res = await app.client().get('/api/auth/config');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, {
      turnstile: { mode: 'on', siteKey: '0x4AAAAAAAintegrationSite' },
    });
    assert.ok(!res.text.includes('integrationSecret'));
  });
});

describe('turnstile on — password sign-in', () => {
  it('browser without a token → 400 turnstile_required, after the rate limiter ran', async () => {
    const res = await browser().post('/api/auth/sign-in', signIn());
    assert.equal(res.status, 400, res.text);
    assert.equal(errorCode(res), 'turnstile_required');
    assert.ok(res.headers.get('ratelimit-remaining') !== null, 'authLimiter charged first');
  });

  it('browser with a rejected token → 403 turnstile_failed; the password is never checked', async () => {
    const res = await browser().post('/api/auth/sign-in', signIn({ turnstileToken: token('bad') }));
    assert.equal(res.status, 403, res.text);
    assert.equal(errorCode(res), 'turnstile_failed');
  });

  it('a token minted for another form is refused', async () => {
    const res = await browser().post(
      '/api/auth/sign-in',
      signIn({ turnstileToken: token('good', 'recover') }),
    );
    assert.equal(errorCode(res), 'turnstile_failed');
  });

  it('a replayed token is refused even though it passed once', async () => {
    const t = token('good');
    const first = await browser().post('/api/auth/sign-in', signIn({ turnstileToken: t }));
    assert.equal(first.status, 200, first.text);
    const again = await browser().post('/api/auth/sign-in', signIn({ turnstileToken: t }));
    assert.equal(errorCode(again), 'turnstile_failed');
  });

  it('Cloudflare unreachable → 503 turnstile_unavailable (fail closed)', async () => {
    const res = await browser().post(
      '/api/auth/sign-in',
      signIn({ turnstileToken: token('down') }),
    );
    assert.equal(res.status, 503, res.text);
    assert.equal(errorCode(res), 'turnstile_unavailable');
  });

  it('browser with a valid token signs in (cookie only) and the client IP is sent to Cloudflare', async () => {
    const b = browser();
    const res = await b.post('/api/auth/sign-in', signIn({ turnstileToken: token('good') }));
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.token, undefined, 'browsers never get a body token');
    assert.equal(verifyCalls.at(-1)?.remoteip, b.c.ip);
  });

  it('wrong password with a valid token is still the generic 401', async () => {
    const res = await browser().post(
      '/api/auth/sign-in',
      signIn({ password: 'not-it', turnstileToken: token('good') }),
    );
    assert.equal(res.status, 401);
    assert.equal(errorCode(res), 'invalid_credentials');
  });

  it('an explicit CLI client (no Origin, no Sec-Fetch-Site) is exempt', async () => {
    const before = verifyCalls.length;
    const res = await app.client().post('/api/auth/sign-in', signIn());
    assert.equal(res.status, 200, res.text);
    assert.equal(typeof res.json.token, 'string');
    assert.equal(verifyCalls.length, before, 'no siteverify call for the CLI');
  });

  it('the CLI header does not exempt a request that carries a browser Origin or Sec-Fetch-Site', async () => {
    const variants: Record<string, string>[] = [
      { Origin: ORIGIN },
      { 'Sec-Fetch-Site': 'same-origin' },
    ];
    for (const headers of variants) {
      const res = await app.client().post('/api/auth/sign-in', signIn(), { headers });
      assert.equal(res.status, 400, `${JSON.stringify(headers)}: ${res.text}`);
      assert.equal(errorCode(res), 'turnstile_required');
    }
  });

  it('unknown body fields are still refused next to the token', async () => {
    const res = await browser().post(
      '/api/auth/sign-in',
      signIn({ turnstileToken: token('good'), extra: 1 }),
    );
    assert.equal(res.status, 422, res.text);
  });
});

describe('turnstile on — demo sign-in (non-production)', () => {
  it('browser needs a token; with one it signs in; CLI is exempt', async () => {
    const none = await browser().post('/api/auth/demo', { role: 'pm' });
    assert.equal(errorCode(none), 'turnstile_required');
    const ok = await browser().post('/api/auth/demo', {
      role: 'pm',
      turnstileToken: token('good'),
    });
    assert.equal(ok.status, 200, ok.text);
    const cli = await app.client().post('/api/auth/demo', { role: 'pm' });
    assert.equal(cli.status, 200, cli.text);
  });
});

describe('turnstile on — password recovery request', () => {
  it('browser needs a token for action "recover"; with one it gets the usual 202', async () => {
    const body = { email: 'amara@techorg.io' };
    const none = await browser().post('/api/auth/recovery/request', body);
    assert.equal(none.status, 400);
    assert.equal(errorCode(none), 'turnstile_required');
    const wrong = await browser().post('/api/auth/recovery/request', {
      ...body,
      turnstileToken: token('good', 'sign-in'),
    });
    assert.equal(errorCode(wrong), 'turnstile_failed');
    const ok = await browser().post('/api/auth/recovery/request', {
      ...body,
      turnstileToken: token('good', 'recover'),
    });
    assert.equal(ok.status, 202, ok.text);
  });
});

describe('turnstile on — accept invite', () => {
  it('browser needs a token for action "accept-invite"; with one the account activates', async () => {
    const invite = await newInvite();
    const body = { token: invite, password: 'Correct-Horse-42!' };
    const none = await browser().post('/api/auth/accept-invite', body);
    assert.equal(errorCode(none), 'turnstile_required');
    const ok = await browser().post('/api/auth/accept-invite', {
      ...body,
      turnstileToken: token('good', 'accept-invite'),
    });
    assert.equal(ok.status, 200, ok.text);
  });

  it('a CLI client can accept an invite without a token', async () => {
    const invite = await newInvite();
    const res = await app
      .client()
      .post('/api/auth/accept-invite', { token: invite, password: 'Correct-Horse-42!' });
    assert.equal(res.status, 200, res.text);
  });
});

describe('turnstile on — routes that stay unprotected', () => {
  it('the MFA step needs no token, even from a browser', async () => {
    const c = app.client();
    const pw = await c.post<{ token: string }>('/api/auth/sign-in', signIn());
    assert.equal(pw.status, 200, pw.text);
    c.token = pw.json.token;
    const mfa = await c.post('/api/auth/mfa/totp', { code: DEMO_MFA_CODE }, { headers: BROWSER });
    assert.equal(mfa.status, 200, mfa.text);
  });

  it('passkey sign-in options need no token', async () => {
    const res = await browser().post('/api/auth/webauthn/options', { purpose: 'sign-in' });
    assert.equal(res.status, 200, res.text);
  });
});
