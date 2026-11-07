/**
 * POST /api/auth/password — change password while signed in.
 * Session only (PATs refused), fresh step-up, current password proven, shared
 * policy enforced, other sessions revoked, this one kept on a rotated token.
 */
import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type TestServer } from '../helpers/server.ts';
import { DEMO_PASSWORD, forceStepUp, fullSignIn, stepUp } from '../helpers/auth.ts';
import { audit } from '../../audit/auditLog.ts';

const auditEntries = () => audit.list({ limit: 1000 });

const EMAIL = 'tomas@techorg.io'; // m6, Developer; not used by any other test in this file's process
const MEMBER = 'm6';
const NEW_PASSWORD = 'Harbour-Lantern-42!';

let app: TestServer;
before(async () => {
  app = await startApp();
});
after(() => app.close());

describe('POST /api/auth/password — refusals', () => {
  it('refuses a personal access token (interactive session only)', async () => {
    const c = await fullSignIn(app, EMAIL);
    const issued = await c.post<{ token: string }>('/api/tokens', {
      name: 'pw-probe',
      scopes: ['project:view'],
      expiresInDays: 7,
    });
    assert.equal(issued.status, 201, issued.text);
    const pat = app.client({ token: issued.json.token });
    const res = await pat.post('/api/auth/password', {
      currentPassword: DEMO_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(res.status, 403, res.text);
    assert.equal(errorCode(res), 'session_required');
  });

  it('requires a fresh step-up', async () => {
    const c = await fullSignIn(app, EMAIL);
    await forceStepUp(c, '127.9.9.9');
    const res = await c.post('/api/auth/password', {
      currentPassword: DEMO_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(res.status, 401, res.text);
    assert.equal(errorCode(res), 'step_up_required');
    // After re-verifying, the same request is accepted by the guard (and then fails on the body only).
    await stepUp(c);
    const after = await c.post('/api/auth/password', { currentPassword: DEMO_PASSWORD });
    assert.equal(after.status, 422, after.text);
  });

  it('rejects a wrong current password and audits it', async () => {
    const c = await fullSignIn(app, EMAIL);
    const res = await c.post('/api/auth/password', {
      currentPassword: 'not-the-password',
      newPassword: NEW_PASSWORD,
    });
    assert.equal(res.status, 403, res.text);
    assert.equal(errorCode(res), 'invalid_current_password');
    assert.ok(
      auditEntries().some((e) => e.actor === MEMBER && e.action === 'auth.password_change_failed'),
    );
    assert.equal((await c.get('/api/auth/session')).status, 200, 'session survives the refusal');
  });

  it('enforces the password policy with a concrete reason', async () => {
    const c = await fullSignIn(app, EMAIL);
    for (const [pw, reason] of [
      ['Short1!', /12 characters/],
      ['alllowercase-123!', /upper and lower/],
      ['No-Digits-Here-At-All', /number/],
      ['NoSymbols12345abc', /symbol/],
      ['Tomas-Rides-2024!', /email/],
    ] as const) {
      const res = await c.post<{ error: { message: string } }>('/api/auth/password', {
        currentPassword: DEMO_PASSWORD,
        newPassword: pw,
      });
      assert.equal(res.status, 422, `${pw}: ${res.text}`);
      assert.equal(errorCode(res), 'weak_password');
      assert.match(res.json.error.message, reason);
    }
  });

  it('rejects unknown fields and a missing body', async () => {
    const c = await fullSignIn(app, EMAIL);
    assert.equal((await c.post('/api/auth/password', {})).status, 422);
    const extra = await c.post('/api/auth/password', {
      currentPassword: DEMO_PASSWORD,
      newPassword: NEW_PASSWORD,
      memberId: 'm1',
    });
    assert.equal(extra.status, 422, extra.text);
  });
});

describe('POST /api/auth/password — success', () => {
  it('changes the password, revokes other sessions and keeps this one', async () => {
    const other1 = await fullSignIn(app, EMAIL);
    const other2 = await fullSignIn(app, EMAIL);
    const me = await fullSignIn(app, EMAIL);
    const oldToken = me.token;

    const res = await me.post<{ ok: boolean; revokedSessions: number; token: string }>(
      '/api/auth/password',
      { currentPassword: DEMO_PASSWORD, newPassword: NEW_PASSWORD },
    );
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.ok, true);
    // Every earlier session in this file belongs to the same member and is revoked too.
    assert.ok(res.json.revokedSessions >= 2, String(res.json.revokedSessions));
    assert.ok(res.json.token && res.json.token !== oldToken, 'token rotated');
    assert.match(res.headers.get('set-cookie') ?? '', /^__Host-/);

    // Other sessions are gone.
    for (const c of [other1, other2]) {
      const r = await c.get('/api/auth/session');
      assert.equal(r.status, 401, r.text);
      assert.equal(errorCode(r), 'session_revoked');
    }
    // The pre-rotation token is dead; the current session continues on the new one.
    assert.equal((await me.get('/api/auth/session', { token: oldToken })).status, 401);
    me.token = res.json.token;
    const session = await me.get<{ sessions: { current: boolean }[] }>('/api/auth/session');
    assert.equal(session.status, 200, session.text);
    assert.equal(session.json.sessions.length, 1);
    assert.equal(session.json.sessions[0].current, true);

    const audited = auditEntries().find(
      (e) => e.actor === MEMBER && e.action === 'auth.password_changed',
    );
    assert.ok(audited, 'audited');
    assert.equal(audited.sensitive, true);

    // Old password no longer signs in; the new one does.
    const old = await app.client().post('/api/auth/sign-in', {
      email: EMAIL,
      password: DEMO_PASSWORD,
    });
    assert.equal(old.status, 401, old.text);
    assert.equal(errorCode(old), 'invalid_credentials');
    const fresh = await app.client().post('/api/auth/sign-in', {
      email: EMAIL,
      password: NEW_PASSWORD,
    });
    assert.equal(fresh.status, 200, fresh.text);
  });

  it('refuses reusing the current password as the new one', async () => {
    const c = app.client();
    const pw = await c.post<{ token: string }>('/api/auth/sign-in', {
      email: EMAIL,
      password: NEW_PASSWORD,
    });
    assert.equal(pw.status, 200, pw.text);
    c.token = pw.json.token;
    const mfa = await c.post<{ token: string }>('/api/auth/mfa/totp', { code: '246810' });
    assert.equal(mfa.status, 200, mfa.text);
    c.token = mfa.json.token;
    const res = await c.post('/api/auth/password', {
      currentPassword: NEW_PASSWORD,
      newPassword: NEW_PASSWORD,
    });
    assert.equal(res.status, 422, res.text);
    assert.equal(errorCode(res), 'password_unchanged');
  });
});

describe('POST /api/auth/sign-out-others', () => {
  it('ends every other session and keeps this one', async () => {
    const a = app.client();
    const pw = await a.post<{ token: string }>('/api/auth/sign-in', {
      email: 'sam@techorg.io',
      password: DEMO_PASSWORD,
    });
    assert.equal(pw.status, 200, pw.text);
    a.token = pw.json.token;
    a.token = (await a.post<{ token: string }>('/api/auth/mfa/totp', { code: '246810' })).json.token;
    const b = await fullSignIn(app, 'sam@techorg.io');
    const res = await a.post<{ revoked: number }>('/api/auth/sign-out-others');
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.revoked, 1);
    assert.equal((await b.get('/api/auth/session')).status, 401);
    const mine = await a.get<{ sessions: { current: boolean }[] }>('/api/auth/session');
    assert.equal(mine.status, 200);
    assert.deepEqual(
      mine.json.sessions.map((s) => s.current),
      [true],
    );
  });
});
