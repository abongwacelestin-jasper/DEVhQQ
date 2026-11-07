/**
 * Wave 4 auth contracts:
 *  - body tokens only for `X-DevHQ-Client: cli` with no Origin (browsers are cookie-only),
 *  - the shared demo MFA code only works for seeded demo accounts,
 *  - members with no second factor enroll one during sign-in
 *    (POST /api/auth/mfa/enroll + /api/auth/mfa/enroll/confirm).
 */
import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import { DEMO_MFA_CODE, signInAs } from '../helpers/auth.ts';

let app: TestServer;
let totpAt: (secret: string, counter: number) => string;
const step = () => Math.floor(Date.now() / 30_000);

before(async () => {
  app = await startApp();
  ({ totpAt } = await import('../../auth/totp.ts'));
});
after(() => app.close());

/** Invites a fresh member as the Owner, accepts the invite and returns their credentials. */
async function newRealMember(email: string, password = 'Correct-Horse-42!') {
  const owner = await signInAs(app, 'admin');
  const inv = await owner.post<{ inviteLink: string }>('/api/team/invites', {
    email,
    role: 'Developer',
    products: ['renewberry'],
  });
  assert.equal(inv.status, 200, inv.text);
  const token = new URL(inv.json.inviteLink, 'http://x').searchParams.get('token')!;
  const ok = await app.client().post('/api/auth/accept-invite', { token, password });
  assert.equal(ok.status, 200, ok.text);
  return { email, password };
}

async function passwordStep(email: string, password: string) {
  const c = app.client();
  const res = await c.post<{
    token: string;
    next: string;
    methods: string[];
    enrollRequired: boolean;
  }>('/api/auth/sign-in', { email, password });
  assert.equal(res.status, 200, res.text);
  c.token = res.json.token;
  return { c, res };
}

describe('auth — token delivery (cookie-only browsers)', () => {
  const cases: [string, Record<string, string>, boolean][] = [
    ['cli, no Origin', {}, true],
    ['cli with Origin', { Origin: 'http://localhost:5173' }, false],
    ['cli with Sec-Fetch-Site', { 'Sec-Fetch-Site': 'same-origin' }, false],
    ['console (old contract)', { 'X-DevHQ-Client': 'console' }, false],
    ['no client header', { 'X-DevHQ-Client': '' }, false],
  ];
  for (const [name, headers, expectToken] of cases) {
    it(`${name} → ${expectToken ? 'token in body' : 'cookie only'}`, async () => {
      const res = await app.client().post('/api/auth/demo', { role: 'pm' }, { headers });
      assert.equal(res.status, 200, res.text);
      assert.equal('token' in res.json, expectToken);
      assert.match(res.headers.get('set-cookie') ?? '', /^__Host-devhq_session=/);
    });
  }
});

describe('auth — demo MFA code is for seeded demo accounts only', () => {
  let member: { email: string; password: string };
  before(async () => {
    member = await newRealMember('real.person@techorg.io');
  });

  it('a seeded demo account may use the shared code', async () => {
    const { c, res } = await passwordStep('kofi@techorg.io', 'devhq-demo');
    assert.deepEqual(res.json.methods, ['totp']);
    assert.equal((await c.post('/api/auth/mfa/totp', { code: DEMO_MFA_CODE })).status, 200);
  });

  it('a real (invited) member is told to enroll and cannot use the demo code', async () => {
    const { c, res } = await passwordStep(member.email, member.password);
    assert.deepEqual(
      [res.json.next, res.json.methods, res.json.enrollRequired],
      ['enroll', [], true],
    );
    const demo = await c.post('/api/auth/mfa/totp', { code: DEMO_MFA_CODE });
    assert.equal(demo.status, 401);
    assert.equal((await c.get('/api/tasks')).status, 401, 'still a partial session');
  });
});

describe('auth — first-factor enrollment during sign-in', () => {
  let member: { email: string; password: string };
  before(async () => {
    member = await newRealMember('enroll.me@techorg.io');
  });

  it('enroll → wrong code refused → right code finishes sign-in → factor now required', async () => {
    const { c } = await passwordStep(member.email, member.password);
    const start = await c.post<{ secret: string; otpauthUri: string; expiresInSec: number }>(
      '/api/auth/mfa/enroll',
    );
    assert.equal(start.status, 201, start.text);
    assert.match(start.json.secret, /^[A-Z2-7]{32}$/);
    assert.ok(start.json.otpauthUri.startsWith('otpauth://totp/'));
    assert.ok(start.json.expiresInSec > 0);

    const wrongCode = totpAt(start.json.secret, step() + 5);
    const wrong = await c.post('/api/auth/mfa/enroll/confirm', { code: wrongCode });
    assert.equal(wrong.status, 401);
    assert.equal(errorCode(wrong), 'mfa_invalid');

    const code = totpAt(start.json.secret, step());
    const ok = await c.post<{ token: string }>('/api/auth/mfa/enroll/confirm', { code });
    assert.equal(ok.status, 200, ok.text);
    c.token = ok.json.token;
    assert.equal((await c.get('/api/tasks')).status, 200, 'fully signed in');

    // Next sign-in: the enrolled authenticator is required, and enrollment is closed.
    const next = await passwordStep(member.email, member.password);
    assert.deepEqual(next.res.json.methods, ['totp']);
    assert.equal(next.res.json.enrollRequired, false);
    const again = await next.c.post('/api/auth/mfa/enroll');
    assert.equal(again.status, 409);
    assert.equal(errorCode(again), 'factor_exists');
    const fresh = await next.c.post('/api/auth/mfa/totp', {
      code: totpAt(start.json.secret, step() + 1),
    });
    assert.equal(fresh.status, 200, fresh.text);
  });

  it('confirm without a started enrollment is refused', async () => {
    const m = await newRealMember('no.start@techorg.io');
    const { c } = await passwordStep(m.email, m.password);
    const res = await c.post('/api/auth/mfa/enroll/confirm', { code: '123456' });
    assert.equal(res.status, 409);
    assert.equal(errorCode(res), 'enrollment_invalid');
  });

  it('an enrollment is bound to the session that started it', async () => {
    const m = await newRealMember('bound.session@techorg.io');
    const a = await passwordStep(m.email, m.password);
    const b = await passwordStep(m.email, m.password);
    const start = await a.c.post<{ secret: string }>('/api/auth/mfa/enroll');
    const res = await b.c.post('/api/auth/mfa/enroll/confirm', {
      code: totpAt(start.json.secret, step()),
    });
    assert.equal(res.status, 409, res.text);
  });

  it('seeded demo accounts (which have a usable factor) cannot enroll here', async () => {
    const { c } = await passwordStep('ravi@techorg.io', 'devhq-demo');
    const res = await c.post('/api/auth/mfa/enroll');
    assert.equal(res.status, 409);
    assert.equal(errorCode(res), 'factor_exists');
  });

  it('enrollment needs a partial session; anonymous and full sessions are refused', async () => {
    assert.equal((await app.client().post('/api/auth/mfa/enroll')).status, 401);
    const full: Client = await signInAs(app, 'designer');
    const res = await full.post('/api/auth/mfa/enroll');
    // A full session belongs to someone who already passed a factor.
    assert.equal(res.status, 409);
    assert.equal(errorCode(res), 'factor_exists');
  });
});
