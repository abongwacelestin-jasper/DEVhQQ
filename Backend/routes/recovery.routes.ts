/**
 * Password recovery.
 *
 * Request (public): always 202 with the same body, padded to a fixed minimum
 * duration, so the response reveals nothing about whether an account exists
 * (no enumeration by status, body or timing). Mail is sent fire-and-forget so
 * SMTP latency can't leak either. Per-IP limit → 429; per-email limit → the
 * same silent 202 (no mail).
 *
 * Token: 256-bit random, single-use, 30-minute expiry; only its SHA-256 is
 * stored. A new request supersedes older tokens. The link is built from
 * APP_ORIGIN only (never the Host header).
 *
 * Reset (public): same password policy as accept-invite, rehash, clear the
 * lockout, revoke every session, audit, and tell the user by email.
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { config } from '../config/env.ts';
import { hashPassword, hashToken, randomToken } from '../security/crypto.ts';
import { revokeAllFor } from '../auth/sessions.ts';
import { audit } from '../audit/auditLog.ts';
import { db, findMemberByEmail } from '../store/db.ts';
import { HttpError } from '../types.ts';
import { sendMail } from '../mail/index.ts';
import { passwordChangedEmail, recoveryEmail } from '../mail/templates.ts';
import { recoveryTokens, saveMember } from '../domain/collab/store.ts';
import { passwordProblem } from '../domain/collab/passwordPolicy.ts';
import {
  recoveryEmailAllowed,
  recoveryIpLimiter,
  recoveryResetLimiter,
} from '../domain/collab/limits.ts';

const TOKEN_TTL_MS = 30 * 60_000;
/** Every request answers no sooner than this — longer than any branch takes. */
export const RECOVERY_MIN_MS = 350;
const tokenPattern = /^[A-Za-z0-9_-]{20,200}$/;

const requestBody = v.object({ email: v.email() });
const resetBody = v.object({
  token: v.string({ max: 200, pattern: tokenPattern }),
  password: v.string({ min: 1, max: 400, trim: false }),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function burnTokensFor(memberId: string, except?: string) {
  for (const [hash, t] of recoveryTokens)
    if (t.memberId === memberId && hash !== except && !t.usedAt) recoveryTokens.delete(hash);
}

export function registerRecoveryRoutes(r: Router) {
  const tag = 'auth';

  r.add(
    'POST',
    '/api/auth/recovery/request',
    {
      summary: 'Request a password reset link (always 202, no enumeration)',
      tag,
      auth: 'public',
      responses: [202, 422, 429],
    },
    recoveryIpLimiter,
    async (ctx) => {
      const started = Date.now();
      const { email } = parse(requestBody, ctx.body);
      const allowed = await recoveryEmailAllowed(ctx, email);
      const member = findMemberByEmail(email);
      const raw = randomToken(32);
      const hash = hashToken(raw); // computed on every path so the work is identical

      if (member && member.status === 'active' && allowed) {
        burnTokensFor(member.id);
        recoveryTokens.set(hash, {
          hash,
          memberId: member.id,
          createdAt: Date.now(),
          expiresAt: Date.now() + TOKEN_TTL_MS,
          ip: ctx.ip,
        });
        const link = `${config.appOrigin}/reset-password?token=${encodeURIComponent(raw)}`;
        void sendMail({
          to: member.email,
          ...recoveryEmail(member.name, link, TOKEN_TTL_MS / 60_000),
        });
        audit.append({
          actor: member.id,
          action: 'auth.recovery_requested',
          target: ctx.ip,
          sensitive: true,
          requestId: ctx.requestId,
        });
      } else {
        audit.append({
          actor: 'anonymous',
          action: 'auth.recovery_requested',
          target: `${allowed ? 'no active account' : 'email rate-limited'} · ${ctx.ip}`,
          sensitive: true,
          requestId: ctx.requestId,
        });
      }

      const wait = RECOVERY_MIN_MS - (Date.now() - started);
      if (wait > 0) await sleep(wait);
      ctx.status = 202;
      return {
        ok: true,
        message:
          'If an account exists for that email, a reset link is on its way. It works once, for 30 minutes.',
      };
    },
  );

  r.add(
    'POST',
    '/api/auth/recovery/reset',
    {
      summary: 'Set a new password from a reset link (signs out every session)',
      tag,
      auth: 'public',
      responses: [400, 410, 422, 429],
    },
    recoveryResetLimiter,
    async (ctx) => {
      const body = parse(resetBody, ctx.body);
      const hash = hashToken(body.token);
      const rec = recoveryTokens.get(hash);
      const member = rec && db.members.get(rec.memberId);
      if (!rec || rec.usedAt || !member || member.status !== 'active')
        throw new HttpError(400, 'reset_invalid', 'This reset link is no longer valid');
      if (rec.expiresAt < Date.now())
        throw new HttpError(
          410,
          'reset_expired',
          'This reset link has expired — request a new one',
        );
      const problem = passwordProblem(body.password, member.email);
      if (problem) throw new HttpError(422, 'weak_password', problem);

      // Burn first: a concurrent second use fails even while the KDF runs.
      rec.usedAt = Date.now();
      recoveryTokens.save(hash);
      burnTokensFor(member.id, hash);

      member.passwordHash = await hashPassword(body.password);
      member.failedLogins = 0;
      member.lockedUntil = undefined;
      saveMember(member.id);
      const revoked = revokeAllFor(member.id);
      const at = new Date().toISOString();
      audit.append({
        actor: member.id,
        action: 'auth.password_reset',
        target: `${revoked} session(s) revoked · ${ctx.ip}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      void sendMail({ to: member.email, ...passwordChangedEmail(member.name, ctx.ip, at) });
      return { ok: true, email: member.email, revokedSessions: revoked };
    },
  );
}

// Expired and used tokens are kept for a day (forensics), then dropped.
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60_000;
  for (const [hash, t] of recoveryTokens) if (t.expiresAt < cutoff) recoveryTokens.delete(hash);
}, 10 * 60_000).unref();
