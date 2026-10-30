/**
 * Authentication routes.
 *
 * Flow: password → second factor (passkey preferred, TOTP fallback) → verified
 * session. Passkeys can also be used as a single, phishing-resistant step.
 * Outside production, demo accounts sign in with one call (same accounts as
 * the web app's demo buttons).
 *
 * Abuse controls:
 *  - tight rate limit on every route here,
 *  - identical responses and timing for unknown email vs wrong password,
 *  - account lock after 5 consecutive failures (15 minutes),
 *  - location risk scoring (impossible travel, Tor/VPN/datacenter IPs),
 *  - session token rotated on every privilege change.
 *
 * Token delivery: browsers get an HttpOnly `__Host-` cookie. Clients that send
 * `X-DevHQ-Client: console` (the backend console, CLIs) also receive the token
 * in the JSON body so they can build `Authorization: Bearer` snippets.
 */

import type { Ctx, Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authLimiter } from '../security/rateLimit.ts';
import { dummyPasswordHash, hashPassword, safeEqual, verifyPassword } from '../security/crypto.ts';
import { verifyTotp } from '../auth/totp.ts';
import { issueChallenge, verifyAssertion, verifyRegistration } from '../auth/webauthn.ts';
import {
  createSession,
  findSessionByPrefix,
  listSessions,
  markVerified,
  revoke,
  revokeAllFor,
  validateSession,
} from '../auth/sessions.ts';
import {
  authenticate,
  authenticatePartial,
  clearSessionCookie,
  readToken,
  sessionCookie,
} from '../middleware/authenticate.ts';
import { assessRisk, lookupIp, riskDecision } from '../lib/geo.ts';
import { publish } from '../lib/events.ts';
import { audit } from '../audit/auditLog.ts';
import { db, DEMO, demoAccounts, findMemberByEmail, publicMember } from '../store/db.ts';
import { config } from '../config/env.ts';
import { HttpError, type Member, type SignInRecord } from '../types.ts';
import { randomToken } from '../security/crypto.ts';

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const cookieAge = Math.floor(config.sessionAbsoluteMs / 1000);

const signInBody = v.object({
  email: v.email(),
  password: v.string({ min: 1, max: 512, trim: false }),
});
const totpBody = v.object({ code: v.string({ pattern: /^\d{6}$/ }) });
const demoBody = v.object({
  role: v.enumOf(demoAccounts.map((a) => a.key) as [string, ...string[]]),
});
const b64 = () => v.string({ max: 4096, pattern: /^[A-Za-z0-9_-]+$/ });
const assertionBody = v.object({
  challengeId: b64(),
  credentialId: b64(),
  clientDataJSON: b64(),
  authenticatorData: b64(),
  signature: b64(),
});
const registrationBody = v.object({
  challengeId: b64(),
  credentialId: b64(),
  clientDataJSON: b64(),
  authenticatorData: b64(),
  publicKey: b64(),
  algorithm: v.int(),
  label: v.string({ min: 1, max: 60 }),
});

function wantsToken(ctx: Ctx) {
  return String(ctx.req.headers['x-devhq-client'] ?? '').toLowerCase() === 'console';
}

function deliver(ctx: Ctx, token: string, maxAge: number, extra: Record<string, unknown> = {}) {
  ctx.res.setHeader('Set-Cookie', sessionCookie(token, maxAge));
  return {
    ...extra,
    ...(wantsToken(ctx) ? { token, tokenType: 'Bearer', expiresIn: maxAge } : {}),
  };
}

function recordSignIn(
  member: Member | undefined,
  ctx: Ctx,
  method: SignInRecord['method'],
  result: SignInRecord['result'],
): SignInRecord {
  const location = lookupIp(ctx.ip);
  const history = member ? db.signIns.filter((s) => s.memberId === member.id) : [];
  const risk = assessRisk(location, history);
  const rec: SignInRecord = {
    id: randomToken(8),
    memberId: member?.id ?? 'unknown',
    at: new Date().toISOString(),
    ip: ctx.ip,
    method,
    result,
    location,
    risk,
  };
  db.signIns.unshift(rec);
  if (db.signIns.length > 2000) db.signIns.length = 2000;
  publish('signin', {
    memberId: rec.memberId,
    result,
    city: location.city,
    country: location.country,
    risk: risk.score,
  });
  return rec;
}

/** Applies location risk to a successful credential check. Returns false if blocked. */
function gate(member: Member, ctx: Ctx, method: SignInRecord['method']) {
  const location = lookupIp(ctx.ip);
  const { score, reasons } = assessRisk(
    location,
    db.signIns.filter((s) => s.memberId === member.id),
  );
  const decision = riskDecision(score);
  if (decision === 'block') {
    recordSignIn(member, ctx, method, 'blocked');
    audit.append({
      actor: member.id,
      action: 'auth.blocked_risk',
      target: `${location.city}, ${location.country} · ${reasons.join('; ')}`,
      sensitive: true,
      requestId: ctx.requestId,
    });
    throw new HttpError(
      403,
      'risk_blocked',
      'Sign-in blocked by location risk policy — contact an Owner',
      { reasons },
    );
  }
  return { decision, reasons, location };
}

export function registerAuthRoutes(r: Router) {
  r.add(
    'GET',
    '/api/auth/demo-accounts',
    { summary: 'Demo accounts available outside production', tag: 'auth', auth: 'public' },
    () => {
      if (!DEMO.enabled) return { enabled: false, accounts: [] };
      return {
        enabled: true,
        password: DEMO.password,
        mfaCode: DEMO.mfaCode,
        accounts: demoAccounts.map((a) => {
          const m = db.members.get(a.memberId)!;
          return {
            key: a.key,
            label: a.label,
            memberId: m.id,
            name: m.name,
            email: m.email,
            role: m.role,
          };
        }),
      };
    },
  );

  r.add(
    'POST',
    '/api/auth/demo',
    {
      summary: 'One-step demo sign-in by role (non-production only)',
      tag: 'auth',
      auth: 'public',
      responses: [404, 422, 429],
    },
    authLimiter,
    (ctx) => {
      if (!DEMO.enabled) throw new HttpError(404, 'not_found', 'Route not found');
      const { role } = parse(demoBody, ctx.body);
      const account = demoAccounts.find((a) => a.key === role)!;
      const member = db.members.get(account.memberId)!;
      const { token } = createSession(member.id, ctx.req, ctx.ip, 'password', 'verified');
      recordSignIn(member, ctx, 'demo', 'success');
      audit.append({
        actor: member.id,
        action: 'auth.demo_sign_in',
        target: `${account.label} · ${ctx.ip}`,
        requestId: ctx.requestId,
      });
      return deliver(ctx, token, cookieAge, { ok: true, member: publicMember(member) });
    },
  );

  r.add(
    'POST',
    '/api/auth/sign-in',
    {
      summary: 'Password sign-in (step 1 of 2)',
      tag: 'auth',
      auth: 'public',
      responses: [401, 403, 422, 423, 429],
    },
    authLimiter,
    async (ctx) => {
      const { email, password } = parse(signInBody, ctx.body);
      const member = findMemberByEmail(email);
      const generic = new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');

      if (!member) {
        await verifyPassword(password, await dummyPasswordHash()); // equalize timing
        recordSignIn(undefined, ctx, 'password', 'failed');
        throw generic;
      }
      if (member.lockedUntil && member.lockedUntil > Date.now()) {
        throw new HttpError(423, 'locked', 'Too many attempts — try again later', {
          retryAfterSec: Math.ceil((member.lockedUntil - Date.now()) / 1000),
        });
      }

      const { ok, needsRehash } = await verifyPassword(password, member.passwordHash);
      if (!ok || member.status !== 'active') {
        member.failedLogins += 1;
        recordSignIn(member, ctx, 'password', 'failed');
        if (member.failedLogins >= MAX_FAILURES) {
          member.lockedUntil = Date.now() + LOCK_MS;
          member.failedLogins = 0;
          audit.append({
            actor: member.id,
            action: 'auth.locked',
            target: `${MAX_FAILURES} failed attempts from ${ctx.ip}`,
            sensitive: true,
            requestId: ctx.requestId,
          });
        }
        throw generic;
      }

      member.failedLogins = 0;
      if (needsRehash) member.passwordHash = await hashPassword(password);
      const { decision, reasons } = gate(member, ctx, 'password');
      const { token } = createSession(member.id, ctx.req, ctx.ip, 'password', 'password');
      recordSignIn(member, ctx, 'password', 'challenged');
      audit.append({
        actor: member.id,
        action: 'auth.password_ok',
        target: ctx.ip,
        requestId: ctx.requestId,
      });
      const methods = [
        ...(member.passkeys.length ? ['passkey'] : []),
        ...(member.totpSecret || DEMO.enabled ? ['totp'] : []),
      ];
      return deliver(ctx, token, 10 * 60, {
        next: member.passkeys.length ? 'passkey' : 'totp',
        methods,
        risk: decision === 'challenge' ? { reasons } : undefined,
      });
    },
  );

  /**
   * Who is half-way through sign-in. The password step issues a partial session;
   * this lets the verification screen show the real member without revealing
   * anything beyond their public projection, and only to that partial session.
   */
  r.add(
    'GET',
    '/api/auth/pending',
    {
      summary: 'Member for the current password-only session',
      tag: 'auth',
      auth: 'partial',
      responses: [401],
    },
    authenticatePartial,
    (ctx) => {
      const member = db.members.get(ctx.principal!.memberId)!;
      return {
        member: publicMember(member),
        methods: [
          ...(member.passkeys.length ? ['passkey'] : []),
          ...(member.totpSecret || DEMO.enabled ? ['totp'] : []),
        ],
      };
    },
  );

  r.add(
    'POST',
    '/api/auth/mfa/totp',
    {
      summary: 'Verify a 6-digit authenticator code (step 2 of 2)',
      tag: 'auth',
      auth: 'partial',
      responses: [400, 401, 422, 429],
    },
    authLimiter,
    authenticatePartial,
    (ctx) => {
      const { code } = parse(totpBody, ctx.body);
      const member = db.members.get(ctx.principal!.memberId)!;
      const { session } = validateSession(ctx.token!, ctx.req, ctx.ip);
      let counter: number | null = null;
      if (member.totpSecret) counter = verifyTotp(member.totpSecret, code, session.lastTotpCounter);
      // Demo environments accept the shared demo code so every demo account works out of the box.
      const demoOk = counter === null && DEMO.enabled && safeEqual(code, DEMO.mfaCode);
      if (counter === null && !demoOk) {
        audit.append({
          actor: member.id,
          action: 'auth.mfa_failed',
          target: 'totp',
          sensitive: true,
          requestId: ctx.requestId,
        });
        throw new HttpError(401, 'mfa_invalid', 'Code is incorrect or expired');
      }
      const { token } = markVerified(session, counter ?? undefined);
      recordSignIn(member, ctx, 'password', 'success');
      audit.append({
        actor: member.id,
        action: 'auth.mfa_ok',
        target: demoOk ? 'demo code' : 'totp',
        sensitive: true,
        requestId: ctx.requestId,
      });
      return deliver(ctx, token, cookieAge, { ok: true, member: publicMember(member) });
    },
  );

  r.add(
    'POST',
    '/api/auth/step-up',
    {
      summary: 'Re-verify with an authenticator code for sensitive actions',
      tag: 'auth',
      responses: [401, 422],
    },
    authLimiter,
    authenticate,
    (ctx) => {
      const { code } = parse(totpBody, ctx.body);
      const member = db.members.get(ctx.principal!.memberId)!;
      const { session } = validateSession(ctx.token!, ctx.req, ctx.ip);
      const counter = member.totpSecret
        ? verifyTotp(member.totpSecret, code, session.lastTotpCounter)
        : null;
      if (counter === null && !(DEMO.enabled && safeEqual(code, DEMO.mfaCode)))
        throw new HttpError(401, 'mfa_invalid', 'Code is incorrect or expired');
      const { token } = markVerified(session, counter ?? undefined);
      audit.append({
        actor: member.id,
        action: 'auth.step_up',
        target: 'totp',
        sensitive: true,
        requestId: ctx.requestId,
      });
      return deliver(ctx, token, cookieAge, { ok: true, verifiedFor: '5m' });
    },
  );

  r.add(
    'POST',
    '/api/auth/webauthn/options',
    { summary: 'Passkey challenge for sign-in or step-up', tag: 'auth', auth: 'public' },
    authLimiter,
    () => issueChallenge('get'),
  );

  r.add(
    'POST',
    '/api/auth/webauthn/verify',
    {
      summary: 'Passkey sign-in or step-up verification',
      tag: 'auth',
      auth: 'public',
      responses: [400, 401, 403, 422],
    },
    authLimiter,
    (ctx) => {
      const body = parse(assertionBody, ctx.body);
      const member = [...db.members.values()].find((m) =>
        m.passkeys.some((k) => k.id === body.credentialId),
      );
      if (!member || member.status !== 'active')
        throw new HttpError(401, 'invalid_credentials', 'Passkey not recognised');
      const cred = member.passkeys.find((k) => k.id === body.credentialId)!;
      cred.signCount = verifyAssertion(cred, body);
      gate(member, ctx, 'passkey');

      const existing = readToken(ctx.req.headers.cookie, ctx.req.headers.authorization);
      let token: string;
      if (existing) {
        const { session } = validateSession(existing, ctx.req, ctx.ip);
        if (session.memberId !== member.id)
          throw new HttpError(401, 'invalid_credentials', 'Passkey belongs to another account');
        token = markVerified(session).token;
      } else {
        token = createSession(member.id, ctx.req, ctx.ip, 'passkey', 'verified').token;
      }
      recordSignIn(member, ctx, 'passkey', 'success');
      audit.append({
        actor: member.id,
        action: 'auth.passkey_ok',
        target: cred.label,
        sensitive: true,
        requestId: ctx.requestId,
      });
      return deliver(ctx, token, cookieAge, { ok: true });
    },
  );

  r.add(
    'POST',
    '/api/auth/passkeys/options',
    { summary: 'Begin passkey registration', tag: 'auth' },
    authenticate,
    (ctx) => {
      const m = db.members.get(ctx.principal!.memberId)!;
      const opts = issueChallenge('create', m.id);
      return {
        ...opts,
        user: { id: Buffer.from(m.id).toString('base64url'), name: m.email, displayName: m.name },
        excludeCredentials: m.passkeys.map((k) => ({ type: 'public-key', id: k.id })),
      };
    },
  );

  r.add(
    'POST',
    '/api/auth/passkeys',
    { summary: 'Complete passkey registration', tag: 'auth', responses: [400, 401, 409, 422] },
    authenticate,
    (ctx) => {
      const body = parse(registrationBody, ctx.body);
      const m = db.members.get(ctx.principal!.memberId)!;
      const cred = verifyRegistration(m.id, body);
      if (m.passkeys.some((k) => k.id === cred.id))
        throw new HttpError(409, 'exists', 'Passkey already registered');
      m.passkeys.push(cred);
      audit.append({
        actor: m.id,
        action: 'auth.passkey_registered',
        target: cred.label,
        sensitive: true,
        requestId: ctx.requestId,
      });
      ctx.status = 201;
      return { id: cred.id, label: cred.label, createdAt: cred.createdAt };
    },
  );

  r.add(
    'DELETE',
    '/api/auth/passkeys/:credentialId',
    { summary: 'Remove one of your passkeys', tag: 'auth', responses: [401, 404] },
    authenticate,
    (ctx) => {
      const m = db.members.get(ctx.principal!.memberId)!;
      const before = m.passkeys.length;
      m.passkeys = m.passkeys.filter((k) => k.id !== ctx.params.credentialId);
      if (m.passkeys.length === before) throw new HttpError(404, 'not_found', 'Passkey not found');
      audit.append({
        actor: m.id,
        action: 'auth.passkey_removed',
        target: ctx.params.credentialId.slice(0, 10),
        sensitive: true,
        requestId: ctx.requestId,
      });
    },
  );

  r.add(
    'GET',
    '/api/auth/session',
    { summary: 'Current principal, sessions and elevations', tag: 'auth' },
    authenticate,
    (ctx) => {
      const p = ctx.principal!;
      const m = db.members.get(p.memberId)!;
      return {
        member: publicMember(m),
        stepUpRequired: !p.verifiedAt,
        elevations: p.elevations,
        sessions: listSessions(m.id, p.sessionId),
        location: lookupIp(ctx.ip),
      };
    },
  );

  r.add(
    'DELETE',
    '/api/auth/sessions/:sessionPrefix',
    { summary: 'Revoke one of your other sessions', tag: 'auth', responses: [401, 404] },
    authenticate,
    (ctx) => {
      const target = findSessionByPrefix(ctx.principal!.memberId, ctx.params.sessionPrefix);
      if (!target) throw new HttpError(404, 'not_found', 'Session not found');
      revoke(target.id);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'auth.session_revoked',
        target: `${target.id.slice(0, 8)} · ${target.location.city}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
    },
  );

  r.add(
    'POST',
    '/api/auth/sign-out',
    { summary: 'End this session', tag: 'auth', auth: 'partial' },
    authenticatePartial,
    (ctx) => {
      revoke(ctx.principal!.sessionId);
      ctx.res.setHeader('Set-Cookie', clearSessionCookie());
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'auth.signed_out',
        target: 'this device',
        requestId: ctx.requestId,
      });
    },
  );

  r.add(
    'POST',
    '/api/auth/sign-out-everywhere',
    { summary: 'Revoke all sessions for this account', tag: 'auth' },
    authenticate,
    (ctx) => {
      const n = revokeAllFor(ctx.principal!.memberId);
      ctx.res.setHeader('Set-Cookie', clearSessionCookie());
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'auth.revoked_all',
        target: `${n} session(s)`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      return { revoked: n };
    },
  );
}
