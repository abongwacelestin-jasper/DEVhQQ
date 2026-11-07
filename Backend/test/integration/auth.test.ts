import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type TestServer } from '../helpers/server.ts';
import {
  DEMO_ACCOUNTS,
  DEMO_KEYS,
  DEMO_MFA_CODE,
  DEMO_PASSWORD,
  forceStepUp,
  fullSignIn,
  passwordOnly,
  signInAs,
  stepUp,
} from '../helpers/auth.ts';
import { createAuthenticator, makeAssertion, makeRegistration } from '../helpers/webauthn.ts';

let app: TestServer;
before(async () => {
  app = await startApp();
});
after(() => app.close());

describe('auth — demo sign-in', () => {
  for (const key of DEMO_KEYS) {
    it(`signs in as ${key} with a verified session scoped to the seeded member`, async () => {
      const c = await signInAs(app, key);
      const me = await c.get<{
        member: { id: string; role: string; products: string[] };
        stepUpRequired: boolean;
      }>('/api/auth/session');
      assert.equal(me.status, 200);
      assert.equal(me.json.member.id, DEMO_ACCOUNTS[key].memberId);
      assert.deepEqual(me.json.member.products, DEMO_ACCOUNTS[key].products);
      assert.equal(me.json.stepUpRequired, false);
    });
  }

  it('sets a __Host- cookie with HttpOnly, Secure and SameSite=Strict', async () => {
    const res = await app.client().post('/api/auth/demo', { role: 'developer' });
    const cookie = res.headers.get('set-cookie') ?? '';
    assert.match(cookie, /^__Host-devhq_session=[^;]+;/);
    for (const flag of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age='])
      assert.ok(cookie.includes(flag), flag);
    assert.ok(!/Domain=/i.test(cookie));
  });

  it('only returns the bearer token to console clients', async () => {
    const browser = await app
      .client()
      .post('/api/auth/demo', { role: 'pm' }, { headers: { 'X-DevHQ-Client': 'web' } });
    assert.equal(browser.status, 200);
    assert.equal('token' in browser.json, false);
  });

  it('accepts the cookie as a credential (no bearer token)', async () => {
    const issuer = app.client();
    const res = await issuer.post('/api/auth/demo', { role: 'tester' });
    const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    const me = await issuer.get('/api/auth/session', { headers: { Cookie: cookie }, token: null });
    assert.equal(me.status, 200);
    assert.equal(me.headers.get('x-step-up-required'), null);
  });

  it('rejects unknown demo roles with 422', async () => {
    const res = await app.client().post('/api/auth/demo', { role: 'root' });
    assert.equal(res.status, 422);
  });

  it('lists demo accounts outside production', async () => {
    const res = await app
      .client()
      .get<{ enabled: boolean; accounts: { key: string }[] }>('/api/auth/demo-accounts');
    assert.equal(res.json.enabled, true);
    assert.deepEqual(res.json.accounts.map((a) => a.key).sort(), [...DEMO_KEYS].sort());
  });
});

describe('auth — password + second factor', () => {
  it('the password step yields a partial session that cannot use the API', async () => {
    const c = await passwordOnly(app, DEMO_ACCOUNTS.developer.email);
    const tasks = await c.get('/api/tasks');
    assert.equal(tasks.status, 401);
    assert.equal(errorCode(tasks), 'mfa_required');
    const pending = await c.get<{ member: { id: string }; methods: string[] }>('/api/auth/pending');
    assert.equal(pending.status, 200);
    assert.equal(pending.json.member.id, 'm4');
    assert.ok(pending.json.methods.includes('totp'));
  });

  it('the second factor upgrades and rotates the session', async () => {
    const c = await passwordOnly(app, DEMO_ACCOUNTS.designer.email);
    const partialToken = c.token!;
    const mfa = await c.post<{ token: string }>('/api/auth/mfa/totp', { code: DEMO_MFA_CODE });
    assert.equal(mfa.status, 200);
    assert.notEqual(mfa.json.token, partialToken);
    c.token = mfa.json.token;
    assert.equal((await c.get('/api/tasks')).status, 200);
    const old = await c.get('/api/auth/pending', { token: partialToken });
    assert.equal(old.status, 401, 'pre-MFA token is dead after rotation');
  });

  it('a wrong or malformed code is refused', async () => {
    const c = await passwordOnly(app, DEMO_ACCOUNTS.tester.email);
    const wrong = await c.post('/api/auth/mfa/totp', { code: '000000' });
    assert.equal(wrong.status, 401);
    assert.equal(errorCode(wrong), 'mfa_invalid');
    assert.equal((await c.post('/api/auth/mfa/totp', { code: '12345' })).status, 422);
    assert.equal(
      (await c.post('/api/auth/mfa/totp', { code: DEMO_MFA_CODE, extra: 1 })).status,
      422,
    );
  });

  it('wrong password and unknown email are indistinguishable', async () => {
    const bad = await app
      .client()
      .post('/api/auth/sign-in', { email: 'priya@techorg.io', password: 'nope' });
    const unknown = await app
      .client()
      .post('/api/auth/sign-in', { email: 'ghost@techorg.io', password: 'nope' });
    assert.equal(bad.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(
      { code: errorCode(bad), msg: (bad.json as { error: { message: string } }).error.message },
      {
        code: errorCode(unknown),
        msg: (unknown.json as { error: { message: string } }).error.message,
      },
    );
  });

  it('emails are matched case-insensitively', async () => {
    const c = await passwordOnly(app, 'KOFI@TechOrg.io');
    assert.ok(c.token);
  });

  it('locks the account after 5 consecutive failures, even for the right password', async () => {
    const c = app.client();
    const email = 'lena@techorg.io';
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await c.post('/api/auth/sign-in', { email, password: `wrong-${i}` })).status,
        401,
      );
    const locked = await c.post<{ error: { details: { retryAfterSec: number } } }>(
      '/api/auth/sign-in',
      {
        email,
        password: DEMO_PASSWORD,
      },
    );
    assert.equal(locked.status, 423);
    assert.equal(errorCode(locked), 'locked');
    assert.ok(locked.json.error.details.retryAfterSec > 0);
  });

  it('invited (not yet active) members cannot sign in', async () => {
    const res = await app
      .client()
      .post('/api/auth/sign-in', { email: 'noah@techorg.io', password: DEMO_PASSWORD });
    assert.equal(res.status, 401);
    assert.equal(errorCode(res), 'invalid_credentials');
  });

  it('blocks a correct password from a Tor exit node (location risk ≥ 70)', async () => {
    const c = app.client({ ip: '185.220.101.77' });
    const res = await c.post<{ error: { details: { reasons: string[] } } }>('/api/auth/sign-in', {
      email: 'sam@techorg.io',
      password: DEMO_PASSWORD,
    });
    assert.equal(res.status, 403);
    assert.equal(errorCode(res), 'risk_blocked');
    assert.ok(res.json.error.details.reasons.includes('Tor exit node'));
  });

  it('a medium-risk sign-in is allowed but reports a challenge', async () => {
    const c = app.client({ ip: '104.28.1.2' }); // VPN (25) + first sign-in from a new "country" (20)
    const res = await c.post<{ risk?: { reasons: string[] } }>('/api/auth/sign-in', {
      email: 'yuki@techorg.io',
      password: DEMO_PASSWORD,
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.risk?.reasons.includes('Anonymising VPN'), JSON.stringify(res.json));
  });
});

describe('auth — session context binding', () => {
  it('a token replayed from another User-Agent is revoked', async () => {
    const c = await signInAs(app, 'developer');
    const thief = app.client({ ip: c.ip, userAgent: 'curl/8.0', token: c.token });
    const stolen = await thief.get('/api/auth/session');
    assert.equal(stolen.status, 401);
    assert.equal(errorCode(stolen), 'session_context_changed');
    assert.equal(
      (await c.get('/api/auth/session')).status,
      401,
      'the original session is gone too',
    );
  });

  it('an IP change keeps the session but demands step-up for sensitive actions', async () => {
    const owner = await signInAs(app, 'admin');
    await forceStepUp(owner, '127.9.9.9');
    const invite = await owner.post('/api/team/invites', {
      email: 'stepup-check@techorg.io',
      role: 'Developer',
      products: ['blog'],
    });
    assert.equal(invite.status, 401);
    assert.equal(errorCode(invite), 'step_up_required');
    await stepUp(owner);
    const again = await owner.post('/api/team/invites', {
      email: 'stepup-check@techorg.io',
      role: 'Developer',
      products: ['blog'],
    });
    assert.equal(again.status, 200, again.text);
  });

  it('step-up refuses a wrong code', async () => {
    const c = await signInAs(app, 'operations');
    const res = await c.post('/api/auth/step-up', { code: '999999' });
    assert.equal(res.status, 401);
    assert.equal(errorCode(res), 'mfa_invalid');
  });
});

describe('auth — sign-out and session management', () => {
  it('sign-out kills the token and clears the cookie', async () => {
    const c = await signInAs(app, 'pm');
    const out = await c.post('/api/auth/sign-out');
    assert.equal(out.status, 204);
    assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/);
    const after = await c.get('/api/auth/session');
    assert.equal(after.status, 401);
    assert.equal(errorCode(after), 'session_revoked');
  });

  it('lists my sessions, revokes another one by prefix, and refuses short or foreign prefixes', async () => {
    const a = await fullSignIn(app, 'tomas@techorg.io');
    const b = await fullSignIn(app, 'tomas@techorg.io');
    const list = await a.get<{ sessions: { id: string; current: boolean }[] }>('/api/auth/session');
    assert.ok(list.json.sessions.length >= 2);
    assert.ok(list.json.sessions.every((s) => s.id.length === 8));
    const other = list.json.sessions.find((s) => !s.current)!;
    const stranger = await signInAs(app, 'designer');
    assert.equal(
      (await stranger.delete(`/api/auth/sessions/${other.id}`)).status,
      404,
      'not my session',
    );
    assert.equal(
      (await a.delete(`/api/auth/sessions/${other.id.slice(0, 7)}`)).status,
      404,
      'prefix too short',
    );
    assert.equal((await a.delete(`/api/auth/sessions/${other.id}`)).status, 204);
    assert.equal((await b.get('/api/auth/session')).status, 401);
    assert.equal((await a.get('/api/auth/session')).status, 200);
  });

  it('sign-out-everywhere revokes every session of the member', async () => {
    const a = await fullSignIn(app, 'sam@techorg.io');
    const b = await fullSignIn(app, 'sam@techorg.io');
    const res = await a.post<{ revoked: number }>('/api/auth/sign-out-everywhere');
    assert.equal(res.status, 200);
    assert.ok(res.json.revoked >= 2);
    assert.equal((await a.get('/api/auth/session')).status, 401);
    assert.equal((await b.get('/api/auth/session')).status, 401);
  });

  it('rejects missing, forged and garbage bearer tokens', async () => {
    for (const token of [undefined, 'garbage', 'abc.def', 'a'.repeat(500)]) {
      const res = await app.client({ token }).get('/api/auth/session');
      assert.equal(res.status, 401, String(token));
    }
  });
});

describe('auth — passkeys end to end (real ES256)', () => {
  it('registers a passkey, then signs in with it alone', async () => {
    const owner = await signInAs(app, 'admin');
    const auth = createAuthenticator(-7);
    const opts = await owner.post<{
      challengeId: string;
      publicKey: { challenge: string; rpId: string };
    }>('/api/auth/passkeys/options');
    assert.equal(opts.status, 200);
    const ceremony = {
      challengeId: opts.json.challengeId,
      challenge: opts.json.publicKey.challenge,
      rpId: opts.json.publicKey.rpId,
      origin: 'http://localhost:5173',
    };
    const reg = await owner.post(
      '/api/auth/passkeys',
      makeRegistration(auth, ceremony, { label: 'CI key' }),
    );
    assert.equal(reg.status, 201, reg.text);
    const dup = await owner.post('/api/auth/passkeys/options');
    const again = await owner.post(
      '/api/auth/passkeys',
      makeRegistration(auth, {
        ...ceremony,
        challengeId: (dup.json as { challengeId: string }).challengeId,
        challenge: (dup.json as { publicKey: { challenge: string } }).publicKey.challenge,
      }),
    );
    assert.equal(again.status, 409, 'same credential twice');

    const device = app.client();
    const get = await device.post<{
      challengeId: string;
      publicKey: { challenge: string; rpId: string };
    }>('/api/auth/webauthn/options');
    const assertion = makeAssertion(auth, {
      challengeId: get.json.challengeId,
      challenge: get.json.publicKey.challenge,
      rpId: get.json.publicKey.rpId,
      origin: 'http://localhost:5173',
    });
    const signIn = await device.post<{ token: string }>('/api/auth/webauthn/verify', assertion);
    assert.equal(signIn.status, 200, signIn.text);
    device.token = signIn.json.token;
    const me = await device.get<{ member: { id: string; passkeys: number } }>('/api/auth/session');
    assert.equal(me.json.member.id, 'm1');
    assert.equal(me.json.member.passkeys, 1);

    // Replaying the same assertion fails: the challenge is single use.
    const replay = await app.client().post('/api/auth/webauthn/verify', assertion);
    assert.equal(replay.status, 400);
    assert.equal(errorCode(replay), 'challenge_invalid');

    // Remove it again.
    assert.equal((await owner.delete(`/api/auth/passkeys/${auth.credentialId}`)).status, 204);
    assert.equal((await owner.delete(`/api/auth/passkeys/${auth.credentialId}`)).status, 404);
  });

  it('an unknown credential is refused without revealing anything', async () => {
    const auth = createAuthenticator(-7);
    const c = app.client();
    const get = await c.post<{
      challengeId: string;
      publicKey: { challenge: string; rpId: string };
    }>('/api/auth/webauthn/options');
    const res = await c.post(
      '/api/auth/webauthn/verify',
      makeAssertion(auth, {
        challengeId: get.json.challengeId,
        challenge: get.json.publicKey.challenge,
        rpId: get.json.publicKey.rpId,
        origin: 'http://localhost:5173',
      }),
    );
    assert.equal(res.status, 401);
    assert.equal(errorCode(res), 'invalid_credentials');
  });
});

describe('auth — invites', () => {
  it('invite → preview → weak password refused → accept → sign in; the link is single use', async () => {
    const owner = await signInAs(app, 'admin');
    const inv = await owner.post<{ id: string; status: string; inviteLink: string }>(
      '/api/team/invites',
      {
        email: 'new.hire@techorg.io',
        role: 'Tester',
        products: ['mirror'],
      },
    );
    assert.equal(inv.status, 200, inv.text);
    assert.equal(inv.json.status, 'invited');
    const token = new URL(inv.json.inviteLink, 'http://x').searchParams.get('token')!;

    const anon = app.client();
    const preview = await anon.get<{ email: string; name: string; role: string }>(
      `/api/auth/invite?token=${encodeURIComponent(token)}`,
    );
    assert.equal(preview.status, 200);
    assert.deepEqual(
      { email: preview.json.email, name: preview.json.name, role: preview.json.role },
      { email: 'new.hire@techorg.io', name: 'New Hire', role: 'Tester' },
    );

    for (const weak of [
      'short1!A',
      'alllowercase1!x',
      'NoDigitsHere!!',
      'NoSymbols12345',
      'new.hire-Pass123!',
    ]) {
      const r = await anon.post('/api/auth/accept-invite', { token, password: weak });
      assert.equal(r.status, 422, weak);
      assert.equal(errorCode(r), 'weak_password');
    }
    const ok = await anon.post('/api/auth/accept-invite', { token, password: 'Correct-Horse-42!' });
    assert.equal(ok.status, 200, ok.text);
    const reuse = await anon.post('/api/auth/accept-invite', {
      token,
      password: 'Correct-Horse-42!',
    });
    assert.equal(reuse.status, 400);
    assert.equal(errorCode(reuse), 'invite_invalid');

    const c = app.client();
    const pw = await c.post('/api/auth/sign-in', {
      email: 'new.hire@techorg.io',
      password: 'Correct-Horse-42!',
    });
    assert.equal(pw.status, 200);
  });

  it('unknown and malformed invite tokens fail closed', async () => {
    const c = app.client();
    assert.equal((await c.get('/api/auth/invite?token=short')).status, 400);
    assert.equal((await c.get(`/api/auth/invite?token=${'A'.repeat(43)}`)).status, 400);
    assert.equal(
      (
        await c.post('/api/auth/accept-invite', {
          token: 'A'.repeat(43),
          password: 'Correct-Horse-42!',
        })
      ).status,
      400,
    );
  });
});
