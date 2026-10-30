/**
 * Authentication middleware — builds the request Principal.
 *
 * Accepts the session token from an HttpOnly, Secure, SameSite=Strict cookie
 * (browsers) or an `Authorization: Bearer` header (CLI / service tokens).
 * Sessions that haven't completed MFA can only reach the MFA endpoints.
 */

import type { Middleware } from '../lib/http.ts';
import { validateSession } from '../auth/sessions.ts';
import { activeElevations } from '../auth/jit.ts';
import { db } from '../store/db.ts';
import { HttpError } from '../types.ts';

export const SESSION_COOKIE = '__Host-devhq_session';

export function readToken(
  cookieHeader: string | undefined,
  auth: string | undefined,
): string | undefined {
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const match = cookieHeader
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : undefined;
}

/** `__Host-` prefix forces Secure, Path=/ and no Domain — the cookie can't be scoped to subdomains. */
export function sessionCookie(token: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function authenticateWith(allowPartial: boolean): Middleware {
  return (ctx, next) => {
    const token = readToken(ctx.req.headers.cookie, ctx.req.headers.authorization);
    if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in required');
    const { session, stepUpRequired } = validateSession(token, ctx.req, ctx.ip);
    if (session.stage !== 'verified' && !allowPartial)
      throw new HttpError(401, 'mfa_required', 'Complete MFA to continue');
    const member = db.members.get(session.memberId);
    if (!member || member.status !== 'active')
      throw new HttpError(401, 'account_inactive', 'Account is not active');
    ctx.token = token;
    ctx.principal = {
      memberId: member.id,
      role: member.role,
      products: member.products,
      sessionId: session.id,
      verifiedAt: stepUpRequired ? 0 : session.verifiedAt,
      elevations: activeElevations(member.id),
    };
    if (stepUpRequired) ctx.res.setHeader('X-Step-Up-Required', '1');
    return next();
  };
}

/** Fully authenticated (password + second factor). */
export const authenticate = authenticateWith(false);
/** Password accepted, second factor pending — only for /auth/mfa/* routes. */
export const authenticatePartial = authenticateWith(true);
