/**
 * Authentication routes.
 *
 * Flow: password → second factor (passkey preferred, TOTP fallback) → verified
 * session. Passkeys can also be used as a single, phishing-resistant step.
 * Outside production, demo accounts sign in with one call (same accounts as
 * the web app's demo buttons).
 *
 * Abuse controls:
 *  - per-IP and per-account rate limits on every credential check,
 *  - identical responses and timing for unknown email vs wrong password,
 *  - account lock after 5 consecutive failures (15 minutes),
 *  - location risk scoring (impossible travel, Tor/VPN/datacenter IPs),
 *  - session token rotated on every privilege change,
 *  - TOTP replay protection per member (across sessions), secrets sealed at rest.
 *
 * Token delivery (decided on the server, never by a client flag alone):
 *  - Browsers get only the HttpOnly `__Host-` cookie. Page script never sees a
 *    session token, so XSS cannot exfiltrate one.
 *  - A non-browser client may receive the token in the JSON body for
 *    `Authorization: Bearer` use, only when it sends `X-DevHQ-Client: cli`
 *    and carries none of the headers every browser attaches (`Origin`,
 *    `Sec-Fetch-Site`). Long-lived automation should use personal access
 *    tokens instead (routes/tokens.routes.ts).
 */

import type { Ctx, Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { accountLimiter, authLimiter, chargeAccount } from '../security/rateLimit.ts';
import {
  dummyPasswordHash,
  hashPassword,
  hashToken,
  safeEqual,
  verifyPassword,
} from '../security/crypto.ts';
import {
  ENROLLMENT_TTL_MS,
  beginEnrollment,
  confirmEnrollment,
  migrateTotpSecret,
  verifyMemberTotp,
} from '../auth/totp.ts';
import {
  issueAssertionChallenge,
  issueRegistrationChallenge,
  isSuspended,
  takeChallenge,
  verifyAssertion,
  verifyRegistration,
  type AssertionResult,
  type StoredPasskey,
} from '../auth/webauthn.ts';
import {
  createSession,
  findSessionByPrefix,
  listSessions,
  markVerified,
  revoke,
  revokeAllFor,
  validateSession,
  type SessionRecord,
} from '../auth/sessions.ts';
import {
  authenticate,
  authenticatePartial,
  clearSessionCookie,
  readToken,
  sessionCookie,
} from '../middleware/authenticate.ts';
import { requireSession, requireStepUp } from '../auth/rbac.ts';
import { persistMember } from '../security/persist.ts';
import { passwordProblem } from '../security/passwordPolicy.ts';
import { looksLikePat } from '../security/pats.ts';
import { assessRisk, lookupIp, riskDecision } from '../lib/geo.ts';
import { publish } from '../lib/events.ts';
import { audit } from '../audit/auditLog.ts';
import {
  db,
  DEMO,
  DEMO_MEMBER_IDS,
  demoAccounts,
  findMemberByEmail,
  publicMember,
} from '../store/db.ts';
import { config } from '../config/env.ts';
import { HttpError, type Member, type SignInRecord } from '../types.ts';
import { randomToken } from '../security/crypto.ts';
import {
  BACKUP_CODE_COUNT,
  consumeBackupCode,
  generateBackupCodes,
  remainingBackupCodes,
} from '../security/backupCodes.ts';
import {
  describeDevice,
  sendAccountLocked,
  sendBackupCodeUsed,
  sendBackupCodesGenerated,
  sendFactorChanged,
  sendSignInAlert,
} from '../mail/events.ts';

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const cookieAge = Math.floor(config.sessionAbsoluteMs / 1000);

const signInBody = v.object({
  email: v.email(),
  password: v.string({ min: 1, max: 512, trim: false }),
});
const totpBody = v.object({ code: v.string({ pattern: /^\d{6}$/ }) });
const backupBody = v.object({
  code: v.string({ pattern: /^[A-Za-z0-9]{4}[\s-]?[A-Za-z0-9]{4}$/ }),
});
const demoBody = v.object({
  role: v.enumOf(demoAccounts.map((a) => a.key) as [string, ...string[]]),
});
const inviteTokenPattern = /^[A-Za-z0-9_-]{20,200}$/;
const acceptInviteBody = v.object({
  token: v.string({ max: 200, pattern: inviteTokenPattern }),
  // The full policy is applied after parsing so the user gets a concrete reason.
  password: v.string({ min: 1, max: 400, trim: false }),
});
const b64 = (max = 4096) => v.string({ max, pattern: /^[A-Za-z0-9_-]+$/ });
const assertionBody = v.object({
  challengeId: b64(64),
  credentialId: b64(1400),
  clientDataJSON: b64(),
  authenticatorData: b64(),
  signature: b64(),
  // Empty string is what some browsers send for a null userHandle.
  userHandle: v.optional(v.string({ max: 128, pattern: /^[A-Za-z0-9_-]*$/ })),
});
const assertionOptionsBody = v.object({
  purpose: v.optional(v.enumOf(['sign-in', 'mfa', 'step-up'] as const)),
});
const TRANSPORTS = ['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card'] as const;
const registrationBody = v.object({
  challengeId: b64(64),
  credentialId: b64(1400),
  clientDataJSON: b64(),
  authenticatorData: b64(8192),
  publicKey: b64(),
  algorithm: v.int(),
  label: v.string({ min: 1, max: 60 }),
  transports: v.optional(v.array(v.enumOf(TRANSPORTS), { max: 6 })),
});

/**
 * Resolves the member an invite token belongs to. Invites are few and short
 * lived, so a scan over the member map is cheaper than a second index.
 */
function findInvite(token: string): Member | undefined {
  const hash = hashToken(token);
  for (const m of db.members.values())
    if (m.inviteTokenHash && safeEqual(m.inviteTokenHash, hash)) return m;
  return undefined;
}

/** Shared by the preview and accept routes: unknown, used and expired tokens all fail closed. */
function requireInvite(token: string): Member {
  const member = findInvite(token);
  if (!member || member.status !== 'invited' || !member.inviteExpiresAt)
    throw new HttpError(400, 'invite_invalid', 'This invite link is no longer valid');
  if (member.inviteExpiresAt < Date.now())
    throw new HttpError(410, 'invite_expired', 'This invite link has expired — ask for a new one');
  return member;
}

/**
 * True only for an explicit non-browser client. Every browser attaches
 * `Origin` to POSTs and `Sec-Fetch-Site` to every request, and page script
 * cannot remove them, so script running in a page (including injected
 * script) can never obtain a token in a response body.
 */
export function wantsBodyToken(ctx: Ctx): boolean {
  const h = ctx.req.headers;
  return (
    String(h['x-devhq-client'] ?? '').toLowerCase() === 'cli' &&
    h.origin === undefined &&
    h['sec-fetch-site'] === undefined
  );
}

function deliver(ctx: Ctx, token: string, maxAge: number, extra: Record<string, unknown> = {}) {
  ctx.res.setHeader('Set-Cookie', sessionCookie(token, maxAge));
  return {
    ...extra,
    ...(wantsBodyToken(ctx) ? { token, tokenType: 'Bearer', expiresIn: maxAge } : {}),
  };
}

/**
 * The shared demo code is a convenience for seeded accounts with no factor of
 * their own. It never stands in for a member's real TOTP secret or passkey.
 */
function demoCodeAllowed(member: Member): boolean {
  // Seeded demo accounts only: an invited real member must enroll a real factor (CYBER-002).
  return (
    DEMO.enabled &&
    DEMO_MEMBER_IDS.has(member.id) &&
    !member.totpSecret &&
    member.passkeys.length === 0
  );
}

function usablePasskeys(member: Member) {
  return member.passkeys.filter((k) => !isSuspended(k));
}

function secondFactors(member: Member): string[] {
  return [
    ...(usablePasskeys(member).length ? ['passkey'] : []),
    ...(member.totpSecret || demoCodeAllowed(member) ? ['totp'] : []),
  ];
}

/**
 * True when a member has no usable second factor (no authenticator, no passkey,
 * no demo code). Such a member can only finish sign-in by enrolling one: the
 * password step was already proven, and the account was activated through a
 * single-use invite or recovery link, so this is first-factor enrollment, not
 * a bypass. Members who already have a factor can never use this path.
 */
function needsEnrollment(member: Member): boolean {
  return secondFactors(member).length === 0;
}

/** Resolves the session behind the request for handlers that also accept anonymous callers. */
function currentSession(ctx: Ctx): SessionRecord | undefined {
  const token = readToken(ctx.req.headers.cookie, ctx.req.headers.authorization);
  if (!token || looksLikePat(token)) return undefined;
  return validateSession(token, ctx.req, ctx.ip).session;
}

/** Re-reads the caller's session record (authenticate already validated it). */
function sessionOf(ctx: Ctx): SessionRecord {
  const s = currentSession(ctx);
  if (!s || s.id !== ctx.principal?.sessionId)
    throw new HttpError(403, 'session_required', 'This action needs an interactive session');
  return s;
}

/** Upgrades legacy plaintext / old-key TOTP secrets to the current data key and persists. */
function migrateSecrets(member: Member) {
  if (migrateTotpSecret(member)) persistMember(member.id);
}

function checkTotp(member: Member, session: SessionRecord, code: string) {
  migrateSecrets(member);
  const counter = verifyMemberTotp(member, code, session.lastTotpCounter);
  const demoOk = counter === null && demoCodeAllowed(member) && safeEqual(code, DEMO.mfaCode);
  return { counter, demoOk, ok: counter !== null || demoOk };
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
    device: describeDevice(ctx.req.headers['user-agent']),
  };
  db.signIns.unshift(rec);
  if (member && result === 'success') void sendSignInAlert(member, rec, history);
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
  // Seal any legacy plaintext TOTP secrets (e.g. DEMO_TOTP_SECRET seeds, or
  // rows written before encryption at rest) and re-seal rows under retired keys.
  let migrated = 0;
  for (const m of db.members.values())
    if (migrateTotpSecret(m)) {
      persistMember(m.id);
      migrated++;
    }
  if (migrated)
    audit.append({
      actor: 'system',
      action: 'security.totp_secrets_sealed',
      target: `${migrated} member(s)`,
      sensitive: true,
    });

  /**
   * Invite preview: lets the accept screen greet the invitee by name and say
   * which account the link belongs to before they choose a password.
   */
  r.add(
    'GET',
    '/api/auth/invite',
    {
      summary: 'Inspect an invite link before accepting it',
      tag: 'auth',
      auth: 'public',
      responses: [400, 410, 429],
    },
    authLimiter,
    (ctx) => {
      const token = ctx.query.get('token') ?? '';
      if (!inviteTokenPattern.test(token))
        throw new HttpError(400, 'invite_invalid', 'This invite link is no longer valid');
      const member = requireInvite(token);
      return {
        email: member.email,
        name: member.name,
        role: member.role,
        products: member.products,
        expiresAt: new Date(member.inviteExpiresAt!).toISOString(),
      };
    },
  );

  /**
   * Invite acceptance: the invited person sets their own password and the
   * account goes live. The token is single-use and consumed here, and the
   * response deliberately carries no session — they still sign in (and pass
   * the second factor) through the normal flow.
   */
  r.add(
    'POST',
    '/api/auth/accept-invite',
    {
      summary: 'Set a password and activate an invited account',
      tag: 'auth',
      auth: 'public',
      responses: [400, 410, 422, 429],
    },
    authLimiter,
    async (ctx) => {
      const body = parse(acceptInviteBody, ctx.body);
      const member = requireInvite(body.token);
      const problem = passwordProblem(body.password, member.email);
      if (problem) throw new HttpError(422, 'weak_password', problem);

      member.passwordHash = await hashPassword(body.password);
      member.status = 'active';
      member.failedLogins = 0;
      member.lockedUntil = undefined;
      // Burn the link: one invite, one activation.
      member.inviteTokenHash = undefined;
      member.inviteExpiresAt = undefined;
      persistMember(member.id);

      audit.append({
        actor: member.id,
        action: 'auth.invite_accepted',
        target: `${member.email} · ${member.role} · ${member.products.join(', ')}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      publish('team', { memberId: member.id, status: member.status });
      return { ok: true, email: member.email, member: publicMember(member) };
    },
  );

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
          void sendAccountLocked(member, ctx, MAX_FAILURES, member.lockedUntil);
        }
        persistMember(member.id);
        throw generic;
      }

      member.failedLogins = 0;
      if (needsRehash) member.passwordHash = await hashPassword(password);
      migrateSecrets(member);
      persistMember(member.id);
      const { decision, reasons } = gate(member, ctx, 'password');
      const { token } = createSession(member.id, ctx.req, ctx.ip, 'password', 'password');
      recordSignIn(member, ctx, 'password', 'challenged');
      audit.append({
        actor: member.id,
        action: 'auth.password_ok',
        target: ctx.ip,
        requestId: ctx.requestId,
      });
      const methods = secondFactors(member);
      return deliver(ctx, token, 10 * 60, {
        next: methods[0] ?? 'enroll',
        methods,
        enrollRequired: methods.length === 0,
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
      const methods = secondFactors(member);
      return { member: publicMember(member), methods, enrollRequired: methods.length === 0 };
    },
  );

  r.add(
    'POST',
    '/api/auth/mfa/enroll',
    {
      summary:
        'First authenticator enrollment during sign-in (only for members with no second factor)',
      tag: 'auth',
      auth: 'partial',
      responses: [401, 403, 409, 429],
    },
    authLimiter,
    authenticatePartial,
    accountLimiter,
    (ctx) => {
      const member = db.members.get(ctx.principal!.memberId)!;
      const session = sessionOf(ctx);
      if (!needsEnrollment(member))
        throw new HttpError(
          409,
          'factor_exists',
          'Verify with your existing authenticator or passkey',
        );
      const { secret, otpauthUri, expiresAt } = beginEnrollment(member, session.id);
      audit.append({
        actor: member.id,
        action: 'auth.totp_enroll_started',
        target: 'first authenticator (during sign-in)',
        sensitive: true,
        requestId: ctx.requestId,
      });
      ctx.status = 201;
      return {
        secret,
        otpauthUri,
        expiresAt: new Date(expiresAt).toISOString(),
        expiresInSec: Math.floor(ENROLLMENT_TTL_MS / 1000),
      };
    },
  );

  r.add(
    'POST',
    '/api/auth/mfa/enroll/confirm',
    {
      summary: 'Confirm the first authenticator with one valid code and finish sign-in',
      tag: 'auth',
      auth: 'partial',
      responses: [400, 401, 403, 409, 422, 429],
    },
    authLimiter,
    authenticatePartial,
    accountLimiter,
    (ctx) => {
      const { code } = parse(totpBody, ctx.body);
      const member = db.members.get(ctx.principal!.memberId)!;
      const session = sessionOf(ctx);
      if (!needsEnrollment(member))
        throw new HttpError(
          409,
          'factor_exists',
          'Verify with your existing authenticator or passkey',
        );
      const result = confirmEnrollment(member, session.id, code);
      if (!result.ok) {
        audit.append({
          actor: member.id,
          action: 'auth.totp_enroll_failed',
          target: result.reason,
          sensitive: true,
          requestId: ctx.requestId,
        });
        if (result.reason === 'invalid_code')
          throw new HttpError(401, 'mfa_invalid', 'Code is incorrect or expired');
        throw new HttpError(
          409,
          'enrollment_invalid',
          'No enrollment in progress for this session — start again',
          {
            reason: result.reason,
          },
        );
      }
      member.totpSecret = result.sealedSecret;
      persistMember(member.id);
      const { token } = markVerified(session, result.counter);
      recordSignIn(member, ctx, 'password', 'success');
      audit.append({
        actor: member.id,
        action: 'auth.totp_enrolled',
        target: 'authenticator app (first factor, during sign-in)',
        sensitive: true,
        requestId: ctx.requestId,
      });
      void sendFactorChanged(member, ctx, { factor: 'authenticator app', replaced: false });
      return deliver(ctx, token, cookieAge, { ok: true, member: publicMember(member) });
    },
  );

  r.add(
    'POST',
    '/api/auth/mfa/totp',
    {
      summary: 'Verify a 6-digit authenticator code (step 2 of 2)',
      tag: 'auth',
      auth: 'partial',
      responses: [400, 401, 403, 422, 429],
    },
    authLimiter,
    authenticatePartial,
    accountLimiter,
    (ctx) => {
      const { code } = parse(totpBody, ctx.body);
      const member = db.members.get(ctx.principal!.memberId)!;
      const session = sessionOf(ctx);
      const { counter, demoOk, ok } = checkTotp(member, session, code);
      if (!ok) {
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
    '/api/auth/mfa/backup',
    {
      summary: 'Use a one-time backup code as the second factor (step 2 of 2)',
      tag: 'auth',
      auth: 'partial',
      responses: [400, 401, 403, 422, 429],
    },
    authLimiter,
    authenticatePartial,
    accountLimiter,
    (ctx) => {
      const { code } = parse(backupBody, ctx.body);
      const member = db.members.get(ctx.principal!.memberId)!;
      const session = sessionOf(ctx);
      if (!consumeBackupCode(member, code)) {
        audit.append({
          actor: member.id,
          action: 'auth.mfa_failed',
          target: 'backup code',
          sensitive: true,
          requestId: ctx.requestId,
        });
        throw new HttpError(401, 'mfa_invalid', 'Code is incorrect or already used');
      }
      const { token } = markVerified(session);
      recordSignIn(member, ctx, 'password', 'success');
      const remaining = remainingBackupCodes(member);
      audit.append({
        actor: member.id,
        action: 'auth.mfa_ok',
        target: `backup code · ${remaining} left`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      void sendBackupCodeUsed(
        member,
        ctx,
        remaining,
        member.backupCodes?.length ?? BACKUP_CODE_COUNT,
      );
      return deliver(ctx, token, cookieAge, {
        ok: true,
        member: publicMember(member),
        backupCodesRemaining: remaining,
      });
    },
  );

  r.add(
    'GET',
    '/api/auth/backup-codes',
    { summary: 'How many unused backup codes you have', tag: 'auth', responses: [401, 403] },
    authenticate,
    requireSession,
    (ctx) => ({ remaining: remainingBackupCodes(db.members.get(ctx.principal!.memberId)!) }),
  );

  r.add(
    'POST',
    '/api/auth/backup-codes',
    {
      summary:
        'Generate a new set of one-time backup codes — returned once, replaces the old set (step-up)',
      tag: 'auth',
      responses: [401, 403, 429],
    },
    authLimiter,
    authenticate,
    requireSession,
    requireStepUp(),
    (ctx) => {
      const member = db.members.get(ctx.principal!.memberId)!;
      const replaced = remainingBackupCodes(member);
      const codes = generateBackupCodes(member);
      audit.append({
        actor: member.id,
        action: 'auth.backup_codes_generated',
        target: `${BACKUP_CODE_COUNT} codes${replaced ? ` · ${replaced} unused replaced` : ''}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      void sendBackupCodesGenerated(member, ctx, codes.length, replaced);
      ctx.status = 201;
      return { codes, count: codes.length };
    },
  );

  r.add(
    'POST',
    '/api/auth/step-up',
    {
      summary: 'Re-verify with an authenticator code for sensitive actions or to unlock',
      tag: 'auth',
      responses: [401, 403, 422, 429],
    },
    authLimiter,
    authenticate,
    requireSession,
    accountLimiter,
    (ctx) => {
      const { code } = parse(totpBody, ctx.body);
      const member = db.members.get(ctx.principal!.memberId)!;
      const session = sessionOf(ctx);
      const { counter, demoOk, ok } = checkTotp(member, session, code);
      if (!ok) {
        audit.append({
          actor: member.id,
          action: 'auth.step_up_failed',
          target: 'totp',
          sensitive: true,
          requestId: ctx.requestId,
        });
        throw new HttpError(401, 'mfa_invalid', 'Code is incorrect or expired');
      }
      const { token } = markVerified(session, counter ?? undefined);
      audit.append({
        actor: member.id,
        action: 'auth.step_up',
        target: demoOk ? 'demo code' : 'totp',
        sensitive: true,
        requestId: ctx.requestId,
      });
      return deliver(ctx, token, cookieAge, { ok: true, verifiedFor: '5m' });
    },
  );

  // ---------------------------------------------------------------------------
  // TOTP enrollment
  // ---------------------------------------------------------------------------

  r.add(
    'POST',
    '/api/auth/totp/enroll',
    {
      summary: 'Start authenticator-app enrollment — returns the secret once (step-up)',
      tag: 'auth',
      responses: [401, 403, 429],
    },
    authLimiter,
    authenticate,
    requireSession,
    requireStepUp(),
    (ctx) => {
      const member = db.members.get(ctx.principal!.memberId)!;
      const { secret, otpauthUri, expiresAt } = beginEnrollment(member, ctx.principal!.sessionId);
      audit.append({
        actor: member.id,
        action: 'auth.totp_enroll_started',
        target: member.totpSecret ? 'replacing existing authenticator' : 'first authenticator',
        sensitive: true,
        requestId: ctx.requestId,
      });
      ctx.status = 201;
      return {
        secret,
        otpauthUri,
        expiresAt: new Date(expiresAt).toISOString(),
        expiresInSec: Math.floor(ENROLLMENT_TTL_MS / 1000),
        replacesExisting: !!member.totpSecret,
      };
    },
  );

  r.add(
    'POST',
    '/api/auth/totp/confirm',
    {
      summary: 'Finish authenticator-app enrollment with one valid code',
      tag: 'auth',
      responses: [400, 401, 403, 409, 422, 429],
    },
    authLimiter,
    authenticate,
    requireSession,
    accountLimiter,
    (ctx) => {
      const { code } = parse(totpBody, ctx.body);
      const member = db.members.get(ctx.principal!.memberId)!;
      const result = confirmEnrollment(member, ctx.principal!.sessionId, code);
      if (!result.ok) {
        audit.append({
          actor: member.id,
          action: 'auth.totp_enroll_failed',
          target: result.reason,
          sensitive: true,
          requestId: ctx.requestId,
        });
        if (result.reason === 'invalid_code')
          throw new HttpError(401, 'mfa_invalid', 'Code is incorrect or expired');
        throw new HttpError(
          409,
          'enrollment_invalid',
          'No enrollment in progress for this session — start again',
          { reason: result.reason },
        );
      }
      const replaced = !!member.totpSecret;
      member.totpSecret = result.sealedSecret;
      persistMember(member.id);
      audit.append({
        actor: member.id,
        action: replaced ? 'auth.totp_replaced' : 'auth.totp_enrolled',
        target: 'authenticator app',
        sensitive: true,
        requestId: ctx.requestId,
      });
      void sendFactorChanged(member, ctx, { factor: 'authenticator app', replaced });
      return { ok: true, member: publicMember(member) };
    },
  );

  // ---------------------------------------------------------------------------
  // Passkeys (WebAuthn) — contract for clients: docs/security/webauthn-client.md
  // ---------------------------------------------------------------------------

  r.add(
    'POST',
    '/api/auth/webauthn/options',
    {
      summary: 'Passkey challenge for sign-in, second factor or step-up/unlock',
      tag: 'auth',
      auth: 'public',
      responses: [401, 403, 409, 422, 429],
    },
    authLimiter,
    (ctx) => {
      const { purpose = 'sign-in' } = parse(assertionOptionsBody, ctx.body ?? {});
      if (purpose === 'sign-in') return issueAssertionChallenge('sign-in');
      const session = currentSession(ctx);
      if (!session) throw new HttpError(401, 'unauthenticated', 'Sign in required');
      if (purpose === 'mfa' && session.stage !== 'password')
        throw new HttpError(409, 'already_verified', 'This session already passed MFA');
      if (purpose === 'step-up' && session.stage !== 'verified')
        throw new HttpError(401, 'mfa_required', 'Complete MFA to continue');
      const member = db.members.get(session.memberId);
      if (!member || member.status !== 'active')
        throw new HttpError(401, 'account_inactive', 'Account is not active');
      if (!usablePasskeys(member).length)
        throw new HttpError(409, 'no_passkey', 'No passkey is registered for this account');
      return issueAssertionChallenge(purpose, member, session.id);
    },
  );

  r.add(
    'POST',
    '/api/auth/webauthn/verify',
    {
      summary: 'Passkey sign-in, second factor or step-up/unlock verification',
      tag: 'auth',
      auth: 'public',
      responses: [400, 401, 403, 422, 429],
    },
    authLimiter,
    async (ctx) => {
      const body = parse(assertionBody, ctx.body);
      // Consumed first: a challenge is single use even if anything below fails.
      const challenge = takeChallenge(body.challengeId, 'get');
      let session: SessionRecord | undefined;
      if (challenge.purpose !== 'sign-in') {
        session = currentSession(ctx);
        if (!session || session.id !== challenge.sessionId)
          throw new HttpError(401, 'challenge_invalid', 'Challenge was issued to another session');
      }
      const candidates = challenge.memberId
        ? [db.members.get(challenge.memberId)].filter((m): m is Member => !!m)
        : [...db.members.values()];
      const member = candidates.find((m) => m.passkeys.some((k) => k.id === body.credentialId));
      if (!member || member.status !== 'active') {
        recordSignIn(undefined, ctx, 'passkey', 'failed');
        throw new HttpError(401, 'invalid_credentials', 'Passkey not recognised');
      }
      await chargeAccount(member.id);
      const cred = member.passkeys.find((k) => k.id === body.credentialId)!;
      let result: AssertionResult;
      try {
        result = verifyAssertion(cred, member.id, challenge, body);
      } catch (err) {
        recordSignIn(member, ctx, 'passkey', 'failed');
        audit.append({
          actor: member.id,
          action: 'auth.passkey_failed',
          target: `${cred.label} · ${err instanceof HttpError ? err.code : 'error'}`,
          sensitive: true,
          requestId: ctx.requestId,
        });
        throw err;
      }
      if (!result.ok) {
        const suspended: StoredPasskey = { ...cred, suspendedAt: new Date().toISOString() };
        member.passkeys = member.passkeys.map((k) => (k.id === cred.id ? suspended : k));
        persistMember(member.id);
        recordSignIn(member, ctx, 'passkey', 'blocked');
        audit.append({
          actor: member.id,
          action: 'auth.passkey_suspended',
          target: `${cred.label} · sign count ${result.signCount} ≤ ${cred.signCount} (possible clone)`,
          sensitive: true,
          requestId: ctx.requestId,
        });
        throw new HttpError(
          401,
          'counter_regressed',
          'Possible cloned authenticator — credential suspended',
        );
      }
      const used: StoredPasskey = {
        ...cred,
        signCount: result.signCount,
        lastUsedAt: new Date().toISOString(),
      };
      member.passkeys = member.passkeys.map((k) => (k.id === cred.id ? used : k));
      persistMember(member.id);

      let token: string;
      if (challenge.purpose === 'sign-in') {
        gate(member, ctx, 'passkey');
        token = createSession(member.id, ctx.req, ctx.ip, 'passkey', 'verified').token;
        recordSignIn(member, ctx, 'passkey', 'success');
      } else {
        if (challenge.purpose === 'mfa') gate(member, ctx, 'passkey');
        token = markVerified(session!).token;
        if (challenge.purpose === 'mfa') recordSignIn(member, ctx, 'passkey', 'success');
      }
      audit.append({
        actor: member.id,
        action: challenge.purpose === 'step-up' ? 'auth.step_up' : 'auth.passkey_ok',
        target: `passkey · ${cred.label} · ${challenge.purpose}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      return deliver(ctx, token, cookieAge, {
        ok: true,
        purpose: challenge.purpose,
        member: publicMember(member),
        ...(challenge.purpose === 'step-up' ? { verifiedFor: '5m' } : {}),
      });
    },
  );

  r.add(
    'GET',
    '/api/auth/passkeys',
    { summary: 'Your registered passkeys', tag: 'auth', responses: [401, 403] },
    authenticate,
    requireSession,
    (ctx) => {
      const m = db.members.get(ctx.principal!.memberId)!;
      return {
        items: m.passkeys.map((k) => ({
          id: k.id,
          label: k.label,
          algorithm: k.algorithm,
          createdAt: k.createdAt,
          lastUsedAt: 'lastUsedAt' in k && typeof k.lastUsedAt === 'string' ? k.lastUsedAt : null,
          suspended: isSuspended(k),
        })),
      };
    },
  );

  r.add(
    'POST',
    '/api/auth/passkeys/options',
    { summary: 'Begin passkey registration (step-up)', tag: 'auth', responses: [401, 403, 429] },
    authLimiter,
    authenticate,
    requireSession,
    requireStepUp(),
    (ctx) => {
      const m = db.members.get(ctx.principal!.memberId)!;
      return issueRegistrationChallenge(m, ctx.principal!.sessionId);
    },
  );

  r.add(
    'POST',
    '/api/auth/passkeys',
    {
      summary: 'Complete passkey registration',
      tag: 'auth',
      responses: [400, 401, 403, 409, 422, 429],
    },
    authLimiter,
    authenticate,
    requireSession,
    (ctx) => {
      const body = parse(registrationBody, ctx.body);
      const m = db.members.get(ctx.principal!.memberId)!;
      const cred = verifyRegistration(m.id, ctx.principal!.sessionId, body);
      // Credential ids are globally unique: refuse one already bound to any account.
      for (const other of db.members.values())
        if (other.passkeys.some((k) => k.id === cred.id))
          throw new HttpError(409, 'exists', 'Passkey already registered');
      m.passkeys.push(cred);
      persistMember(m.id);
      audit.append({
        actor: m.id,
        action: 'auth.passkey_registered',
        target: `${cred.label} · alg ${cred.algorithm}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      void sendFactorChanged(m, ctx, { factor: 'passkey', replaced: false, label: cred.label });
      ctx.status = 201;
      return { id: cred.id, label: cred.label, createdAt: cred.createdAt };
    },
  );

  r.add(
    'DELETE',
    '/api/auth/passkeys/:credentialId',
    {
      summary: 'Remove one of your passkeys (step-up)',
      tag: 'auth',
      responses: [401, 403, 404, 409],
    },
    authenticate,
    requireSession,
    requireStepUp(),
    (ctx) => {
      const m = db.members.get(ctx.principal!.memberId)!;
      const remaining = m.passkeys.filter((k) => k.id !== ctx.params.credentialId);
      if (remaining.length === m.passkeys.length)
        throw new HttpError(404, 'not_found', 'Passkey not found');
      if (!remaining.length && !m.totpSecret && !DEMO.enabled)
        throw new HttpError(
          409,
          'last_factor',
          'Enroll an authenticator app before removing your last passkey',
        );
      m.passkeys = remaining;
      persistMember(m.id);
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
    { summary: 'Revoke one of your other sessions', tag: 'auth', responses: [401, 403, 404] },
    authenticate,
    requireSession,
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
    requireSession,
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
