/**
 * Authentication middleware — builds the request Principal.
 *
 * Accepts:
 *  - the session token from an HttpOnly, Secure, SameSite=Strict `__Host-`
 *    cookie (browsers — the token is never readable by page script),
 *  - `Authorization: Bearer <session token>` (CLIs that signed in with
 *    `X-DevHQ-Client: cli`, see routes/auth.routes.ts → wantsBodyToken),
 *  - `Authorization: Bearer dhq_pat_…` personal access tokens (scoped,
 *    never step-up capable and never JIT-elevated — see security/pats.ts).
 * A session's `elevations` are rebuilt from the grant store on every request,
 * so a grant that expires or is revoked stops applying on the next request.
 * Sessions that haven't completed MFA can only reach the MFA endpoints.
 */

import type { Middleware } from '../lib/http.ts';
import { validateSession } from '../auth/sessions.ts';
import { activeElevations } from '../auth/jit.ts';
import { setPrincipalAuth } from '../auth/rbac.ts';
import { looksLikePat, parseScopes, verifyPat } from '../security/pats.ts';
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
    if (looksLikePat(token)) {
      // A PAT is a complete credential but never a partial (MFA-pending) session.
      if (allowPartial)
        throw new HttpError(403, 'session_required', 'This action needs an interactive session');
      const pat = verifyPat(token, ctx.ip);
      const member = db.members.get(pat.memberId)!;
      ctx.principal = {
        memberId: member.id,
        role: member.role,
        products: member.products,
        sessionId: `pat:${pat.id}`,
        verifiedAt: 0,
        // A token never carries a JIT elevation, even while its owner holds a grant:
        // production access needs a person in an interactive session (assertElevation).
        elevations: [],
      };
      setPrincipalAuth(ctx.principal, {
        kind: 'pat',
        tokenId: pat.id,
        scopes: parseScopes(pat.scopes),
      });
      return next();
    }
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
    setPrincipalAuth(ctx.principal, { kind: 'session' });
    if (stepUpRequired) ctx.res.setHeader('X-Step-Up-Required', '1');
    return next();
  };
}

/** Fully authenticated (password + second factor). */
export const authenticate = authenticateWith(false);
/** Password accepted, second factor pending — only for /auth/mfa/* routes. */
export const authenticatePartial = authenticateWith(true);
