import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import { fullSignIn, signInAll, type DemoKey } from '../helpers/auth.ts';

interface MemberRow {
  id: string;
  email: string;
  role: string;
  products: string[];
  status: string;
  mfa: boolean;
  passwordHash?: string;
}
interface Grant {
  id: string;
  memberId: string;
  scope: string;
  status: string;
  approvedBy?: string;
  expiresAt?: number;
  durationMs: number;
}

let app: TestServer;
let as: Record<DemoKey, Client>;
before(async () => {
  app = await startApp();
  as = await signInAll(app);
});
after(() => app.close());

describe('team — directory', () => {
  it('shows members who share a product with the caller, without secrets', async () => {
    const dev = await as.developer.get<MemberRow[]>('/api/team');
    assert.equal(dev.status, 200);
    assert.ok(dev.json.every((m) => m.products.includes('renewberry')));
    assert.ok(
      !dev.json.some((m) => m.id === 'm6'),
      'blog-only member hidden from a renewberry dev',
    );
    for (const m of dev.json) {
      assert.equal('passwordHash' in m, false);
      assert.equal('totpSecret' in m, false);
      assert.equal('inviteTokenHash' in m, false);
    }
    const owner = await as.admin.get<MemberRow[]>('/api/team');
    assert.ok(owner.json.length >= 12);
  });

  it('narrows to a project’s product', async () => {
    const res = await as.admin.get<MemberRow[]>('/api/team?projectId=p4');
    assert.ok(res.json.length > 0);
    assert.ok(res.json.every((m) => m.products.includes('blog')));
  });
});

describe('team — role and access changes', () => {
  it('an Owner cannot change their own role', async () => {
    const res = await as.admin.patch('/api/team/m1', { role: 'Developer' });
    assert.equal(res.status, 403);
    assert.equal(errorCode(res), 'self_demotion');
  });

  it('an Owner can promote a second Owner and demote them again', async () => {
    const promote = await as.admin.patch<MemberRow>('/api/team/m3', { role: 'Owner' });
    assert.equal(promote.status, 200);
    assert.equal(promote.json.role, 'Owner');
    const priya = await fullSignIn(app, 'priya@techorg.io');
    assert.equal(
      (await priya.get('/api/access/grants')).status,
      200,
      'new role applies on next sign-in',
    );
    const demote = await as.admin.patch<MemberRow>('/api/team/m3', { role: 'Project manager' });
    assert.equal(demote.status, 200);
    assert.equal(
      (await priya.get('/api/auth/session')).status,
      401,
      'demotion revoked her sessions',
    );
  });

  it('a privilege change revokes all of the target’s sessions immediately', async () => {
    const target = await fullSignIn(app, 'yuki@techorg.io');
    assert.equal((await target.get('/api/tasks')).status, 200);
    const res = await as.admin.patch<MemberRow>('/api/team/m7', { products: ['mirror'] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.products, ['mirror']);
    assert.equal((await target.get('/api/tasks')).status, 401);
    const again = await fullSignIn(app, 'yuki@techorg.io');
    const tasks = await again.get<{ items: { product: string }[] }>('/api/tasks?limit=200');
    assert.ok(
      tasks.json.items.every((t) => t.product === 'mirror'),
      'new scope applies',
    );
  });

  it('deactivated members are locked out', async () => {
    const target = await fullSignIn(app, 'tomas@techorg.io');
    assert.equal((await as.admin.patch('/api/team/m6', { status: 'deactivated' })).status, 200);
    assert.equal((await target.get('/api/auth/session')).status, 401);
    const pw = await app
      .client()
      .post('/api/auth/sign-in', { email: 'tomas@techorg.io', password: 'devhq-demo' });
    assert.equal(pw.status, 401);
  });

  it('validates role, products and status', async () => {
    for (const body of [
      { role: 'Root' },
      { products: ['other'] },
      { status: 'invited' },
      { email: 'x@y.zz' },
    ])
      assert.equal((await as.admin.patch('/api/team/m8', body)).status, 422, JSON.stringify(body));
  });

  it('invites validate input, refuse Owner and duplicates', async () => {
    const base = { email: 'someone.new@techorg.io', role: 'Developer', products: ['blog'] };
    assert.equal(
      (await as.admin.post('/api/team/invites', { ...base, role: 'Owner' })).status,
      422,
    );
    assert.equal((await as.admin.post('/api/team/invites', { ...base, products: [] })).status, 422);
    assert.equal(
      (await as.admin.post('/api/team/invites', { ...base, email: 'kofi@techorg.io' })).status,
      409,
    );
    const ok = await as.admin.post<MemberRow & { inviteLink: string }>('/api/team/invites', base);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.status, 'invited');
    assert.match(ok.json.inviteLink, /^\/accept-invite\?token=[A-Za-z0-9_-]{43}$/);
    assert.equal('inviteTokenHash' in ok.json, false);
  });
});

describe('team — just-in-time production access', () => {
  const reason = 'Investigate INC-31 payment failures';

  it('request → self-approval refused → non-approver refused → approved → elevation live → revoked', async () => {
    const req = await as.developer.post<Grant>('/api/access/grants', {
      scope: 'production:renewberry',
      reason,
      durationMinutes: 30,
    });
    assert.equal(req.status, 200, req.text);
    assert.equal(req.json.status, 'pending');

    const tester = await as.tester.post(`/api/access/grants/${req.json.id}/approve`);
    assert.equal(tester.status, 403, 'only Owner/Operations approve');

    const approved = await as.operations.post<Grant>(`/api/access/grants/${req.json.id}/approve`);
    assert.equal(approved.status, 200);
    assert.equal(approved.json.status, 'active');
    assert.equal(approved.json.approvedBy, 'm11');

    const caps = await as.developer.get<{ elevations: string[] }>('/api/me/capabilities');
    assert.deepEqual(caps.json.elevations, ['production:renewberry']);

    const revoked = await as.operations.post<Grant>(`/api/access/grants/${req.json.id}/revoke`);
    assert.equal(revoked.json.status, 'revoked');
    const after = await as.developer.get<{ elevations: string[] }>('/api/me/capabilities');
    assert.deepEqual(after.json.elevations, []);
  });

  it('approvers cannot approve their own request', async () => {
    const req = await as.operations.post<Grant>('/api/access/grants', {
      scope: 'production:blog',
      reason,
      durationMinutes: 15,
    });
    const self = await as.operations.post(`/api/access/grants/${req.json.id}/approve`);
    assert.equal(self.status, 403);
    assert.equal(errorCode(self), 'self_approval');
    const denied = await as.admin.post<Grant>(`/api/access/grants/${req.json.id}/revoke`);
    assert.equal(denied.json.status, 'denied', 'revoking a pending grant denies it');
  });

  it('refuses out-of-scope products, unknown scopes, short reasons and bad durations', async () => {
    const cases: [Record<string, unknown>, number][] = [
      [{ scope: 'production:blog', reason, durationMinutes: 30 }, 403],
      [{ scope: 'staging:renewberry', reason, durationMinutes: 30 }, 422],
      [{ scope: 'production:renewberry', reason: 'too short', durationMinutes: 30 }, 422],
      [{ scope: 'production:renewberry', reason, durationMinutes: 14 }, 422],
      [{ scope: 'production:renewberry', reason, durationMinutes: 481 }, 422],
    ];
    for (const [body, status] of cases)
      assert.equal(
        (await as.developer.post('/api/access/grants', body)).status,
        status,
        JSON.stringify(body),
      );
  });

  it('approved grants expire after exactly the requested duration', async () => {
    const req = await as.tester.post<Grant>('/api/access/grants', {
      scope: 'production:mirror',
      reason,
      durationMinutes: 15,
    });
    const ok = await as.admin.post<Grant>(`/api/access/grants/${req.json.id}/approve`);
    const ttl = ok.json.expiresAt! - Date.now();
    assert.ok(ttl > 14 * 60_000 && ttl <= 15 * 60_000, String(ttl));
  });
});

describe('team — the workspace always keeps an active Owner', () => {
  // FINDING B-7 (routes/team.routes.ts:221-232): the last-owner and
  // self-demotion guards only look at `role`. The only active Owner can set
  // their own `status` to 'deactivated' (200), which revokes their sessions
  // and leaves the workspace with no active Owner — nobody can administer it
  // any more. The same request should be refused like a self-demotion.
  it(
    'the last active Owner cannot deactivate themselves',
    async () => {
      const res = await as.admin.patch('/api/team/m1', { status: 'deactivated' });
      assert.ok(res.status === 403 || res.status === 409, `got ${res.status}`);
    },
  );
});
