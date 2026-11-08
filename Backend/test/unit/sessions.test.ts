import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { config } from '../../config/env.ts';
import {
  createSession,
  findSessionByPrefix,
  listSessions,
  markVerified,
  revoke,
  revokeAllExcept,
  revokeAllFor,
  rotateSession,
  sessionCount,
  validateSession,
} from '../../auth/sessions.ts';
import { signToken } from '../../security/crypto.ts';
import { HttpError } from '../../types.ts';
import { repos } from '../../data/index.ts';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FIREFOX_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0';

const req = (ua = CHROME_MAC) => ({ headers: { 'user-agent': ua } }) as unknown as IncomingMessage;

let n = 0;
const member = () => `sess-member-${++n}`;

async function expectCode(fn: () => Promise<unknown>, code: string) {
  await assert.rejects(
    fn,
    (e: unknown) => e instanceof HttpError && e.status === 401 && e.code === code,
  );
}

/** The persisted record (the store hands out copies, like the database). */
const stored = (id: string) => repos.sessions.get(id);

describe('auth/sessions — creation and validation', () => {
  it('creates a verified session bound to UA, IP and location', async () => {
    const { token, session } = await createSession(
      member(),
      req(),
      '102.89.1.1',
      'password',
      'verified',
    );
    assert.ok(session.verifiedAt > 0);
    assert.equal(session.client, 'Chrome · macOS');
    assert.equal(session.location.city, 'Lagos');
    assert.equal(session.lastTotpCounter, -1);
    const v = await validateSession(token, req(), '102.89.1.1');
    assert.equal(v.session.id, session.id);
    assert.equal(v.stepUpRequired, false);
  });

  it('a password-stage session starts with verifiedAt = 0 (step-up required)', async () => {
    const { token, session } = await createSession(
      member(),
      req(),
      '127.0.0.1',
      'password',
      'password',
    );
    assert.equal(session.stage, 'password');
    assert.equal((await validateSession(token, req(), '127.0.0.1')).stepUpRequired, true);
  });

  it('rejects forged and unknown tokens before any lookup', async () => {
    const { token } = await createSession(member(), req(), '127.0.0.1', 'password', 'verified');
    await expectCode(() => validateSession(`${token}x`, req(), '127.0.0.1'), 'invalid_token');
    await expectCode(() => validateSession('garbage', req(), '127.0.0.1'), 'invalid_token');
    await expectCode(
      () => validateSession(signToken('never-issued'), req(), '127.0.0.1'),
      'session_revoked',
    );
  });

  it('labels common clients without storing the raw UA', async () => {
    const cases: [string, string][] = [
      ['curl/8.4.0', 'curl'],
      ['HTTPie/3.2', 'HTTPie'],
      ['PostmanRuntime/7.36', 'Postman'],
      [FIREFOX_WIN, 'Firefox · Windows'],
      ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/126 Safari Edg/126', 'Edge · Windows'],
      [
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Version/17 Safari/604',
        'Safari · iOS',
      ],
      ['Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile', 'Chrome · Android'],
      ['Mozilla/5.0 (X11; Linux x86_64) Firefox/128', 'Firefox · Linux'],
      ['', 'Client · Unknown OS'],
    ];
    for (const [ua, label] of cases) {
      const { session } = await createSession(
        member(),
        req(ua),
        '127.0.0.1',
        'password',
        'verified',
      );
      assert.equal(session.client, label, ua);
      assert.ok(!JSON.stringify(session).includes(ua) || ua === '', 'raw UA not stored');
    }
  });
});

describe('auth/sessions — lifetimes (fake time)', () => {
  it('idle past sessionIdleMs keeps the session but demands step-up', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 });
    const { token } = await createSession(member(), req(), '127.0.0.1', 'password', 'verified');
    t.mock.timers.tick(config.sessionIdleMs);
    assert.equal(
      (await validateSession(token, req(), '127.0.0.1')).stepUpRequired,
      false,
      'exactly idle limit',
    );
    t.mock.timers.tick(config.sessionIdleMs + 1);
    const v = await validateSession(token, req(), '127.0.0.1');
    assert.equal(v.stepUpRequired, true);
    assert.equal(v.session.verifiedAt, 0);
    assert.equal(v.session.revoked, false);
  });

  it('activity inside the idle window keeps the session verified', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 });
    const { token } = await createSession(member(), req(), '127.0.0.1', 'password', 'verified');
    for (let i = 0; i < 5; i++) {
      t.mock.timers.tick(config.sessionIdleMs - 1000);
      assert.equal(
        (await validateSession(token, req(), '127.0.0.1')).stepUpRequired,
        false,
        `hop ${i}`,
      );
    }
  });

  it('absolute lifetime ends the session regardless of activity', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 });
    const { token, session } = await createSession(
      member(),
      req(),
      '127.0.0.1',
      'password',
      'verified',
    );
    const hop = Math.floor(config.sessionIdleMs / 2);
    let elapsed = 0;
    while (elapsed + hop <= config.sessionAbsoluteMs) {
      t.mock.timers.tick(hop);
      elapsed += hop;
      await validateSession(token, req(), '127.0.0.1');
    }
    t.mock.timers.tick(config.sessionAbsoluteMs - elapsed + 1);
    await expectCode(() => validateSession(token, req(), '127.0.0.1'), 'session_expired');
    assert.equal(await stored(session.id), undefined, 'expired session deleted from the store');
    await expectCode(() => validateSession(token, req(), '127.0.0.1'), 'session_revoked');
  });
});

describe('auth/sessions — context binding', () => {
  it('a User-Agent change revokes the session (likely token theft)', async () => {
    const { token, session } = await createSession(
      member(),
      req(CHROME_MAC),
      '127.0.0.1',
      'password',
      'verified',
    );
    await expectCode(
      () => validateSession(token, req(FIREFOX_WIN), '127.0.0.1'),
      'session_context_changed',
    );
    assert.equal(await stored(session.id), undefined, 'revoked session deleted from the store');
    await expectCode(() => validateSession(token, req(CHROME_MAC), '127.0.0.1'), 'session_revoked');
  });

  it('an IP change keeps the session, moves its location and clears verifiedAt', async () => {
    const { token, session } = await createSession(
      member(),
      req(),
      '102.89.1.1',
      'password',
      'verified',
    );
    const v = await validateSession(token, req(), '91.64.2.2');
    assert.equal(v.stepUpRequired, true);
    for (const s of [v.session, (await stored(session.id))!]) {
      assert.equal(s.ip, '91.64.2.2');
      assert.equal(s.location.city, 'Berlin');
      assert.equal(s.verifiedAt, 0);
    }
    // Coming back to the old IP does not restore trust.
    assert.equal((await validateSession(token, req(), '102.89.1.1')).stepUpRequired, true);
  });
});

describe('auth/sessions — rotation and revocation', () => {
  it('rotation issues a new token and kills the old one (no fixation)', async () => {
    const { token: oldToken, session: old } = await createSession(
      member(),
      req(),
      '127.0.0.1',
      'password',
      'password',
    );
    const { token: newToken, session } = await rotateSession(old, { stage: 'verified' });
    assert.notEqual(session.id, old.id);
    assert.equal(old.revoked, true);
    await expectCode(() => validateSession(oldToken, req(), '127.0.0.1'), 'session_revoked');
    assert.equal((await validateSession(newToken, req(), '127.0.0.1')).session.stage, 'verified');
  });

  it('markVerified rotates, sets verifiedAt and records the TOTP counter', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_500_000_000_000 });
    const { token: pwToken, session } = await createSession(
      member(),
      req(),
      '127.0.0.1',
      'password',
      'password',
    );
    const { token, session: verified } = await markVerified(session, 42);
    assert.equal(verified.stage, 'verified');
    assert.equal(verified.verifiedAt, 1_500_000_000_000);
    assert.equal(verified.lastTotpCounter, 42);
    await expectCode(() => validateSession(pwToken, req(), '127.0.0.1'), 'session_revoked');
    assert.equal((await validateSession(token, req(), '127.0.0.1')).stepUpRequired, false);
    // Without a counter the previous one is kept.
    assert.equal((await markVerified(verified)).session.lastTotpCounter, 42);
  });

  it('revoke and revokeAllFor end sessions; other members are untouched', async () => {
    const a = member();
    const b = member();
    const a1 = await createSession(a, req(), '127.0.0.1', 'password', 'verified');
    const a2 = await createSession(a, req(), '127.0.0.2', 'passkey', 'verified');
    const b1 = await createSession(b, req(), '127.0.0.3', 'password', 'verified');
    const before = await sessionCount();
    await revoke(a1.session.id);
    await expectCode(() => validateSession(a1.token, req(), '127.0.0.1'), 'session_revoked');
    assert.equal(await revokeAllFor(a), 1);
    await expectCode(() => validateSession(a2.token, req(), '127.0.0.2'), 'session_revoked');
    assert.equal((await validateSession(b1.token, req(), '127.0.0.3')).session.memberId, b);
    assert.equal(await sessionCount(), before - 2);
    assert.equal(await revokeAllFor(a), 0);
  });

  it('revokeAllExcept keeps the named session and ends the member’s others only', async () => {
    const a = member();
    const b = member();
    const keep = await createSession(a, req(), '127.0.0.1', 'password', 'verified');
    const other1 = await createSession(a, req(), '127.0.0.2', 'password', 'verified');
    const other2 = await createSession(a, req(FIREFOX_WIN), '127.0.0.3', 'passkey', 'verified');
    const b1 = await createSession(b, req(), '127.0.0.4', 'password', 'verified');
    assert.equal(await revokeAllExcept(a, keep.session.id), 2);
    assert.equal(
      (await validateSession(keep.token, req(), '127.0.0.1')).session.id,
      keep.session.id,
    );
    await expectCode(() => validateSession(other1.token, req(), '127.0.0.2'), 'session_revoked');
    await expectCode(
      () => validateSession(other2.token, req(FIREFOX_WIN), '127.0.0.3'),
      'session_revoked',
    );
    assert.equal((await validateSession(b1.token, req(), '127.0.0.4')).session.memberId, b);
    assert.equal(await revokeAllExcept(a, keep.session.id), 0);
  });

  it('lists only the member’s sessions, newest first, with truncated ids', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_600_000_000_000 });
    const m = member();
    const first = await createSession(m, req(), '127.0.0.1', 'password', 'verified');
    t.mock.timers.tick(1000);
    const second = await createSession(m, req(FIREFOX_WIN), '127.0.0.2', 'passkey', 'verified');
    await createSession(member(), req(), '127.0.0.9', 'password', 'verified');
    const list = await listSessions(m, second.session.id);
    assert.deepEqual(
      list.map((s) => s.id),
      [second.session.id.slice(0, 8), first.session.id.slice(0, 8)],
    );
    assert.deepEqual(
      list.map((s) => s.current),
      [true, false],
    );
    for (const s of list) {
      assert.equal(s.id.length, 8);
      assert.equal(JSON.stringify(s).includes(first.session.id), false, 'full id never listed');
      assert.equal('uaHash' in s, false);
    }
  });

  it('findSessionByPrefix needs ≥ 8 chars and the owning member', async () => {
    const m = member();
    const { session } = await createSession(m, req(), '127.0.0.1', 'password', 'verified');
    assert.equal(await findSessionByPrefix(m, session.id.slice(0, 7)), undefined);
    assert.equal((await findSessionByPrefix(m, session.id.slice(0, 8)))?.id, session.id);
    assert.equal(await findSessionByPrefix('someone-else', session.id.slice(0, 8)), undefined);
  });
});
