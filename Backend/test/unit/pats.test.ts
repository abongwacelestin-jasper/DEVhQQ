import '../setup.ts';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../../store/db.ts';
import { repos } from '../../data/index.ts';
import {
  PAT_PREFIX,
  PAT_SCOPES,
  activeTokenCount,
  assertScopesWithinRole,
  issueToken,
  looksLikePat,
  parseScopes,
  personalAccessTokens,
  publicToken,
  revokeStandingAccess,
  revokeToken,
  revokeTokensFor,
  sweepInactiveMembers,
  verifyPat,
} from '../../security/pats.ts';
import { hashToken } from '../../security/crypto.ts';
import { audit } from '../../audit/auditLog.ts';
import { publish } from '../../lib/events.ts';
import { approveGrant, listGrants, requestGrant } from '../../auth/jit.ts';
import { GRANTABLE_LEVELS, PERMISSION_AREAS, permissionMatrix } from '../../auth/rbac.ts';
import { HttpError, type RoleName } from '../../types.ts';

const DAY = 86_400_000;

/** Works for sync throws and async rejections alike. */
async function rejects(fn: () => unknown, status: number, code: string) {
  await assert.rejects(
    async () => fn(),
    (e: unknown) => {
      assert.ok(e instanceof HttpError, `HttpError expected, got ${String(e)}`);
      assert.equal(e.status, status);
      assert.equal(e.code, code);
      return true;
    },
  );
}

/** Changes a member's status in the repository (rows are copies, so write it back). */
async function setStatus(id: string, status: 'active' | 'deactivated') {
  const m = (await repos.members.get(id))!;
  m.status = status;
  await repos.members.put(m);
}

function issue(
  memberId = 'm4',
  over: Partial<{ scopes: string[]; expiresInDays: number; name: string }> = {},
) {
  return issueToken({
    memberId,
    name: over.name ?? 'ci',
    scopes: over.scopes ?? ['project:view'],
    expiresInDays: over.expiresInDays ?? 30,
  });
}

before(async () => {
  await seed();
});

describe('security/pats — format and storage', () => {
  it('issues dhq_pat_<16 hex>_<43 b64url> and stores only the SHA-256', () => {
    const { record, token } = issue();
    assert.match(token, /^dhq_pat_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
    assert.ok(token.startsWith(`${PAT_PREFIX}${record.id}_`));
    assert.equal(record.hash, hashToken(token));
    const stored = personalAccessTokens.get(record.id)!;
    assert.ok(!JSON.stringify(stored).includes(token.split('_').at(-1)!), 'secret never stored');
    assert.ok(looksLikePat(token));
    assert.ok(!looksLikePat('abc.def'));
  });

  it('dedupes and sorts scopes; expiry is createdAt + N days', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-07T00:00:00Z') });
    const { record } = issue('m4', {
      scopes: ['repository:view', 'project:view', 'repository:view'],
      expiresInDays: 7,
    });
    assert.deepEqual(record.scopes, ['project:view', 'repository:view']);
    assert.equal(Date.parse(record.expiresAt) - Date.parse(record.createdAt), 7 * DAY);
  });

  it('every issued id/secret is unique', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => issue('m5').token));
    assert.equal(tokens.size, 50);
  });

  it('the public view never exposes the hash and reports status', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
    const { record } = issue('m4', { expiresInDays: 1 });
    const view = publicToken(record);
    assert.equal('hash' in view, false);
    assert.equal(view.prefix, `${PAT_PREFIX}${record.id}`);
    assert.equal(view.status, 'active');
    t.mock.timers.tick(DAY);
    assert.equal(publicToken(record).status, 'expired');
    revokeToken(record, 'm4', 'test');
    assert.equal(publicToken(record).status, 'revoked');
  });
});

describe('security/pats — verification', () => {
  it('accepts a live token and records last use (throttled to once a minute per IP)', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_810_000_000_000 });
    const { record, token } = issue();
    assert.equal((await verifyPat(token, '10.0.0.1')).id, record.id);
    const first = record.lastUsedAt;
    assert.equal(record.lastUsedIp, '10.0.0.1');
    t.mock.timers.tick(30_000);
    await verifyPat(token, '10.0.0.1');
    assert.equal(record.lastUsedAt, first, 'not rewritten within a minute');
    await verifyPat(token, '10.0.0.2');
    assert.equal(record.lastUsedIp, '10.0.0.2', 'a new IP is always recorded');
    t.mock.timers.tick(61_000);
    await verifyPat(token, '10.0.0.2');
    assert.notEqual(record.lastUsedAt, first);
  });

  it('rejects malformed, unknown and tampered tokens with the same 401', async () => {
    const { token } = issue();
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    const unknownId = token.replace(/^dhq_pat_[0-9a-f]{16}/, 'dhq_pat_0000000000000000');
    for (const bad of [
      '',
      'dhq_pat_',
      token + 'x',
      token.toUpperCase(),
      flipped,
      unknownId,
      `Bearer ${token}`,
    ])
      await rejects(() => verifyPat(bad, '1.1.1.1'), 401, 'invalid_token');
  });

  it('rejects expired tokens at exactly the expiry instant', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_820_000_000_000 });
    const { token } = issue('m4', { expiresInDays: 1 });
    t.mock.timers.tick(DAY - 1);
    assert.ok(await verifyPat(token, 'ip'));
    t.mock.timers.tick(1);
    await rejects(() => verifyPat(token, 'ip'), 401, 'token_expired');
  });

  it('rejects revoked tokens; revocation is idempotent and audited as sensitive', async () => {
    const { record, token } = issue();
    assert.equal(revokeToken(record, 'm1', 'leaked', 'req-1'), true);
    assert.equal(revokeToken(record, 'm1', 'again'), false);
    assert.equal(record.revokedReason, 'leaked');
    await rejects(() => verifyPat(token, 'ip'), 401, 'token_revoked');
    const entry = audit
      .list({ limit: 20 })
      .find((e) => e.action === 'token.revoked' && e.target.includes(record.id));
    assert.ok(entry?.sensitive);
    assert.equal(entry?.requestId, 'req-1');
  });

  it('a token of an inactive member is refused and revoked on first use', async () => {
    const { record, token } = issue('m8');
    await setStatus('m8', 'deactivated');
    try {
      await rejects(() => verifyPat(token, 'ip'), 401, 'account_inactive');
      assert.equal(record.revokedReason, 'member_inactive');
      await rejects(() => verifyPat(token, 'ip'), 401, 'token_revoked');
    } finally {
      await setStatus('m8', 'active');
    }
  });

  it('a token whose owner record is gone is refused', async () => {
    const { token } = issue('ghost-member');
    await rejects(() => verifyPat(token, 'ip'), 401, 'account_inactive');
  });
});

describe('security/pats — scopes', () => {
  it('PAT_SCOPES is every area × grantable level, lower-case', () => {
    assert.equal(PAT_SCOPES.length, PERMISSION_AREAS.length * GRANTABLE_LEVELS.length);
    for (const s of PAT_SCOPES) assert.match(s, /^[a-z]+:(view|contribute|manage|admin)$/);
    assert.ok(!PAT_SCOPES.some((s) => s.endsWith(':none')));
  });

  it('parses every listed scope and rejects unknown, mis-cased, none and duplicate areas', async () => {
    for (const s of PAT_SCOPES) assert.equal(Object.keys(parseScopes([s])).length, 1);
    for (const bad of [
      ['project:none'],
      ['Project:view'],
      ['proj:view'],
      ['project'],
      [''],
      ['project:view', 'project:manage'],
    ])
      await rejects(() => parseScopes(bad), 422, 'validation_failed');
    assert.deepEqual(parseScopes(['project:view', 'repository:contribute']), {
      Project: 'view',
      Repository: 'contribute',
    });
  });

  it('a scope is accepted iff the role grants at least that level (full table)', () => {
    const roles = Object.keys(permissionMatrix.Organization) as RoleName[];
    const rank = ['none', 'view', 'contribute', 'manage', 'admin'];
    for (const role of roles)
      for (const area of PERMISSION_AREAS)
        for (const level of GRANTABLE_LEVELS) {
          const scope = `${area.toLowerCase()}:${level}`;
          const allowed = rank.indexOf(permissionMatrix[area][role]) >= rank.indexOf(level);
          if (allowed)
            assert.doesNotThrow(() => assertScopesWithinRole([scope], role), `${role} ${scope}`);
          else rejects(() => assertScopesWithinRole([scope], role), 422, 'scope_exceeds_role');
        }
  });

  it('reports every over-reaching scope at once', () => {
    assert.throws(
      () =>
        assertScopesWithinRole(
          ['deployment:manage', 'administration:view', 'project:view'],
          'Developer',
        ),
      (e: unknown) =>
        e instanceof HttpError &&
        JSON.stringify((e.details as { scopes: string[] }).scopes) ===
          JSON.stringify(['deployment:manage', 'administration:view']),
    );
  });
});

describe('security/pats — bulk revocation', () => {
  it('activeTokenCount counts only live tokens of that member', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_830_000_000_000 });
    const before = activeTokenCount('m7');
    const a = issue('m7');
    issue('m7', { expiresInDays: 1 });
    issue('m9');
    assert.equal(activeTokenCount('m7'), before + 2);
    revokeToken(a.record, 'm7', 'x');
    t.mock.timers.tick(DAY);
    assert.equal(activeTokenCount('m7'), before);
  });

  it('revokeTokensFor revokes every live token of one member only', async () => {
    const mine = [issue('m10'), issue('m10')];
    const other = issue('m11');
    assert.ok(revokeTokensFor('m10', 'm1', 'offboarding') >= 2);
    for (const { token } of mine) await rejects(() => verifyPat(token, 'ip'), 401, 'token_revoked');
    assert.ok(await verifyPat(other.token, 'ip'));
  });

  it('sweepInactiveMembers revokes tokens of deactivated members without waiting for use', async () => {
    const { record } = issue('m6');
    await setStatus('m6', 'deactivated');
    try {
      assert.ok((await sweepInactiveMembers()) >= 1);
      assert.equal(record.revokedReason, 'member_inactive');
    } finally {
      await setStatus('m6', 'active');
    }
  });

  it('revokeStandingAccess cuts tokens and active/pending JIT grants, with a summary audit', async () => {
    const { token } = issue('m5');
    const pendingGrant = requestGrant(
      'm5',
      'production:mirror',
      'Investigate incident INC-32 now',
      30 * 60_000,
    );
    const active = requestGrant(
      'm5',
      'production:renewberry',
      'Investigate incident INC-31 now',
      30 * 60_000,
    );
    approveGrant(active.id, { memberId: 'm11', role: 'Operations' });
    const out = revokeStandingAccess('m5', 'm1', 'offboarded', 'req-9');
    assert.ok(out.tokens >= 1);
    assert.equal(out.grants, 2);
    await rejects(() => verifyPat(token, 'ip'), 401, 'token_revoked');
    const g = listGrants().filter((x) => x.id === pendingGrant.id || x.id === active.id);
    assert.deepEqual(g.map((x) => x.status).sort(), ['denied', 'revoked']);
    assert.ok(
      audit
        .list({ limit: 10 })
        .some((e) => e.action === 'security.member_access_revoked' && e.target.startsWith('m5')),
    );
  });

  it('a member.deactivated bus event revokes the member’s standing access', () => {
    const { record } = issue('m3');
    publish('member.deactivated', { memberId: 'm3', reason: 'resigned' });
    assert.equal(record.revokedReason, 'member_deactivated:resigned');
    // Malformed events are ignored.
    const other = issue('m2');
    publish('member.deactivated', { memberId: 42 });
    publish('member.deactivated', {});
    assert.equal(other.record.revokedAt, undefined);
  });
});
