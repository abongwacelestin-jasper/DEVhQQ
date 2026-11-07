/**
 * Real authenticator codes over HTTP. This file boots the app with
 * DEMO_TOTP_SECRET set, so every seeded member has a TOTP secret (the demo
 * code is still accepted as a fallback outside production).
 */
import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type TestServer } from '../helpers/server.ts';
import { passwordOnly } from '../helpers/auth.ts';

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
process.env.DEMO_TOTP_SECRET = SECRET;

let app: TestServer;
let totpAt: (secret: string, counter: number) => string;
const nowCode = () => totpAt(SECRET, Math.floor(Date.now() / 30_000));

before(async () => {
  app = await startApp();
  ({ totpAt } = await import('../../auth/totp.ts'));
});
after(() => app.close());

describe('TOTP second factor over HTTP', () => {
  it('accepts the current authenticator code', async () => {
    const c = await passwordOnly(app, 'kofi@techorg.io');
    const res = await c.post('/api/auth/mfa/totp', { code: nowCode() });
    assert.equal(res.status, 200, res.text);
  });

  it('a code used for MFA cannot be replayed for step-up in the same session chain', async () => {
    const c = await passwordOnly(app, 'lena@techorg.io');
    const code = nowCode();
    const mfa = await c.post<{ token: string }>('/api/auth/mfa/totp', { code });
    assert.equal(mfa.status, 200);
    c.token = mfa.json.token;
    const replay = await c.post('/api/auth/step-up', { code });
    // The rotated session carries the used counter, so the code is dead even
    // if a 30 s boundary has passed in between.
    assert.equal(replay.status, 401);
    assert.equal(errorCode(replay), 'mfa_invalid');
  });

  // FINDING B-5 (auth/sessions.ts:99 + routes/auth.routes.ts:434): the TOTP
  // replay counter lives on the *session*, and every password sign-in starts
  // a new session at lastTotpCounter = -1. A code observed once (shoulder
  // surfing, phishing relay) can be replayed in a second session within its
  // 90-second window. RFC 6238 §5.2 requires the verifier to reject a second
  // use of an OTP after a successful validation — the counter must be stored
  // per member.
  it(
    'a code accepted in one session is refused in a second session',
    { todo: 'FINDING B-5: TOTP replay protection is per session, not per member' },
    async () => {
      const a = await passwordOnly(app, 'yuki@techorg.io');
      const b = await passwordOnly(app, 'yuki@techorg.io');
      const code = nowCode();
      assert.equal((await a.post('/api/auth/mfa/totp', { code })).status, 200);
      const second = await b.post('/api/auth/mfa/totp', { code });
      assert.equal(second.status, 401, 'the same OTP was accepted twice');
    },
  );
});
