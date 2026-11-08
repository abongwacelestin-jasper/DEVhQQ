/** One-time backup codes: generate (step-up), sign in with one, never twice. */
import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type TestServer } from '../helpers/server.ts';
import { fullSignIn, passwordOnly } from '../helpers/auth.ts';
import { repos } from '../../data/index.ts';

const EMAIL = 'kofi@techorg.io'; // m4, Developer

let app: TestServer;
before(async () => {
  app = await startApp();
});
after(() => app.close());

describe('backup codes', () => {
  let codes: string[] = [];

  it('generates ten codes once, storing only hashes', async () => {
    const c = await fullSignIn(app, EMAIL);
    const res = await c.post<{ codes: string[]; count: number }>('/api/auth/backup-codes');
    assert.equal(res.status, 201, res.text);
    codes = res.json.codes;
    assert.equal(codes.length, 10);
    assert.equal(new Set(codes).size, 10);
    for (const code of codes) assert.match(code, /^[a-z2-9]{4}-[a-z2-9]{4}$/);
    const stored = JSON.stringify((await repos.members.get('m4'))?.backupCodes);
    for (const code of codes) assert.ok(!stored.includes(code), 'plaintext never stored');
    assert.equal((await c.get<{ remaining: number }>('/api/auth/backup-codes')).json.remaining, 10);
    const me = await c.get('/api/auth/session');
    assert.ok(!me.text.includes('backupCodes'), 'hashes never leave the server');
  });

  it('a backup code completes sign-in once, in any case or spacing', async () => {
    const first = await passwordOnly(app, EMAIL);
    const typed = codes[0].toUpperCase().replace('-', ' ');
    const ok = await first.post<{ token: string; backupCodesRemaining: number }>(
      '/api/auth/mfa/backup',
      { code: typed },
    );
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.backupCodesRemaining, 9);
    first.token = ok.json.token;
    assert.equal((await first.get('/api/tasks')).status, 200, 'fully signed in');

    const again = await passwordOnly(app, EMAIL);
    const reuse = await again.post('/api/auth/mfa/backup', { code: codes[0] });
    assert.equal(reuse.status, 401);
    assert.equal(errorCode(reuse), 'mfa_invalid');
    assert.equal((await again.get('/api/tasks')).status, 401, 'still not signed in');
  });

  it('wrong codes are refused and malformed ones are a validation error', async () => {
    const c = await passwordOnly(app, EMAIL);
    assert.equal((await c.post('/api/auth/mfa/backup', { code: 'zzzz-zzzz' })).status, 401);
    assert.equal((await c.post('/api/auth/mfa/backup', { code: '12' })).status, 422);
  });

  it('generating a new set invalidates the old one', async () => {
    const c = await fullSignIn(app, EMAIL);
    const res = await c.post<{ codes: string[] }>('/api/auth/backup-codes');
    assert.equal(res.status, 201);
    const old = await passwordOnly(app, EMAIL);
    assert.equal((await old.post('/api/auth/mfa/backup', { code: codes[1] })).status, 401);
    const fresh = await passwordOnly(app, EMAIL);
    assert.equal((await fresh.post('/api/auth/mfa/backup', { code: res.json.codes[1] })).status, 200);
  });

  it('a personal access token cannot generate codes', async () => {
    const c = await fullSignIn(app, EMAIL);
    const pat = await c.post<{ token: string }>('/api/tokens', {
      name: 'backup-codes test',
      scopes: ['project:view'],
      expiresInDays: 7,
    });
    assert.equal(pat.status, 201, pat.text);
    const viaPat = app.client();
    viaPat.token = pat.json.token;
    assert.equal((await viaPat.post('/api/auth/backup-codes')).status, 403);
  });
});
