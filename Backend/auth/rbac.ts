/**
 * Role-based access control with product and project scope.
 *
 * Zero trust: authorization runs on every request. A role grants a level per
 * area, but only within the products the member is assigned to. Production
 * access is never part of a role (except Owner) — it comes from a
 * time-boxed JIT elevation (see auth/jit.ts).
 *
 * Kept in sync with the frontend matrix in data/team.ts.
 */

import type { Middleware } from '../lib/http.ts';
import { audit } from '../audit/auditLog.ts';
import { activeGrantFor } from './jit.ts';
import {
  HttpError,
  type PermissionArea,
  type PermissionLevel,
  type Principal,
  type ProductId,
  type RoleName,
} from '../types.ts';

const rank: Record<PermissionLevel, number> = {
  none: 0,
  view: 1,
  contribute: 2,
  manage: 3,
  admin: 4,
};

export const permissionMatrix: Record<PermissionArea, Record<RoleName, PermissionLevel>> = {
  Organization: {
    Owner: 'admin',
    'Project manager': 'view',
    Developer: 'view',
    Designer: 'view',
    Tester: 'view',
    Operations: 'view',
  },
  Product: {
    Owner: 'admin',
    'Project manager': 'manage',
    Developer: 'contribute',
    Designer: 'contribute',
    Tester: 'contribute',
    Operations: 'view',
  },
  Project: {
    Owner: 'admin',
    'Project manager': 'manage',
    Developer: 'contribute',
    Designer: 'contribute',
    Tester: 'contribute',
    Operations: 'view',
  },
  Repository: {
    Owner: 'admin',
    'Project manager': 'view',
    Developer: 'contribute',
    Designer: 'view',
    Tester: 'view',
    Operations: 'view',
  },
  Deployment: {
    Owner: 'admin',
    'Project manager': 'view',
    Developer: 'view',
    Designer: 'none',
    Tester: 'view',
    Operations: 'manage',
  },
  Infrastructure: {
    Owner: 'admin',
    'Project manager': 'none',
    Developer: 'view',
    Designer: 'none',
    Tester: 'none',
    Operations: 'manage',
  },
  Administration: {
    Owner: 'admin',
    'Project manager': 'none',
    Developer: 'none',
    Designer: 'none',
    Tester: 'none',
    Operations: 'view',
  },
};

/**
 * How a principal authenticated. Sessions come from the sign-in flow; PATs
 * are personal access tokens for CLIs and scripts. Kept beside the Principal
 * (a WeakMap keyed by the principal object) so the shared Principal type does
 * not change for other lanes.
 */
export type PrincipalAuth =
  | { kind: 'session' }
  | { kind: 'pat'; tokenId: string; scopes: Partial<Record<PermissionArea, PermissionLevel>> };

const principalAuth = new WeakMap<Principal, PrincipalAuth>();

export function setPrincipalAuth(p: Principal, auth: PrincipalAuth) {
  principalAuth.set(p, auth);
}

export function principalAuthOf(p: Principal): PrincipalAuth {
  return principalAuth.get(p) ?? { kind: 'session' };
}

export function isPat(p: Principal): boolean {
  return principalAuthOf(p).kind === 'pat';
}

export const PERMISSION_AREAS = Object.keys(permissionMatrix) as PermissionArea[];
export const GRANTABLE_LEVELS = ['view', 'contribute', 'manage', 'admin'] as const;

function minLevel(a: PermissionLevel, b: PermissionLevel): PermissionLevel {
  return rank[a] <= rank[b] ? a : b;
}

/**
 * The level a principal actually holds in an area: the role's level, and for
 * a PAT the intersection of the role with the token's scope (an area missing
 * from the token's scopes is `none`). Roles are read live, so a demotion
 * immediately narrows every token the member has issued.
 */
export function effectiveLevel(p: Principal, area: PermissionArea): PermissionLevel {
  const roleLevel = permissionMatrix[area][p.role];
  const auth = principalAuthOf(p);
  if (auth.kind === 'session') return roleLevel;
  return minLevel(roleLevel, auth.scopes[area] ?? 'none');
}

export function levelAtLeast(have: PermissionLevel, want: PermissionLevel): boolean {
  return rank[have] >= rank[want];
}

export function can(p: Principal, area: PermissionArea, level: PermissionLevel): boolean {
  return rank[effectiveLevel(p, area)] >= rank[level];
}

/**
 * Owner-only shortcuts (see every product, every session) honour PAT scope: an
 * Owner's token needs `organization:admin` to use them.
 */
export function hasOwnerPowers(p: Principal): boolean {
  return p.role === 'Owner' && effectiveLevel(p, 'Organization') === 'admin';
}

/** Owners see every product only through `hasOwnerPowers` (so PAT scope applies; FINDING B-8). */
export function canSeeProduct(p: Principal, product: ProductId): boolean {
  return hasOwnerPowers(p) || p.products.includes(product);
}

/** Route guard: rejects personal access tokens (account and credential management are session-only). */
export const requireSession: Middleware = (ctx, next) => {
  if (!ctx.principal) throw new HttpError(401, 'unauthenticated', 'Sign in required');
  if (isPat(ctx.principal))
    throw new HttpError(403, 'session_required', 'This action needs an interactive session');
  return next();
};

/** Route guard: requires an authenticated principal with at least `level` in `area`. */
export function requireArea(area: PermissionArea, level: PermissionLevel): Middleware {
  return (ctx, next) => {
    if (!ctx.principal) throw new HttpError(401, 'unauthenticated', 'Sign in required');
    if (!can(ctx.principal, area, level))
      throw new HttpError(403, 'forbidden', `Requires ${level} on ${area}`);
    return next();
  };
}

/**
 * Step-up guard for sensitive actions (changing roles, revoking access,
 * security policy changes). Requires a strong verification within `maxAgeMs`.
 * Personal access tokens can never pass it.
 */
export function requireStepUp(maxAgeMs = 5 * 60_000): Middleware {
  return (ctx, next) => {
    const p = ctx.principal;
    if (!p) throw new HttpError(401, 'unauthenticated', 'Sign in required');
    // A token cannot prove a human is present, so it never satisfies step-up —
    // 403 (not 401) so clients don't prompt for a re-verification that can't help.
    if (isPat(p))
      throw new HttpError(
        403,
        'step_up_unavailable',
        'Personal access tokens cannot perform step-up actions — use an interactive session',
      );
    if (!p.verifiedAt || Date.now() - p.verifiedAt > maxAgeMs)
      throw new HttpError(
        401,
        'step_up_required',
        'Re-verify with your passkey or authenticator to continue',
      );
    return next();
  };
}

/**
 * The JIT gate for production-impacting actions (see docs/concepts/jit-access.md).
 *
 *  - Personal access tokens never carry an elevation and never pass, not even an
 *    Owner's: `403 elevation_unavailable` (a grant cannot help a token).
 *  - The Owner passes through `hasOwnerPowers` (standing production rights).
 *  - Everyone else needs `scope` in `p.elevations`, which `authenticate` rebuilds
 *    from the grant store on every request, filtered on `expiresAt > now`, so an
 *    expired or revoked grant stops working on the very next request. Otherwise
 *    `403 elevation_required` with `details.scope`, so the client can offer
 *    "Request access" for exactly that scope.
 *
 * Every pass on a grant is audited as `jit.used` (sensitive), with the grant id.
 * Call it after the 404 scope check, so an out-of-scope resource stays a 404.
 */
export function assertElevation(
  p: Principal,
  scope: string,
  use: { action: string; requestId?: string },
): void {
  if (isPat(p))
    throw new HttpError(
      403,
      'elevation_unavailable',
      'Personal access tokens cannot use production access — use an interactive session',
      { scope },
    );
  if (hasOwnerPowers(p)) return;
  if (!p.elevations.includes(scope))
    throw new HttpError(403, 'elevation_required', `Request just-in-time access for ${scope}`, {
      scope,
    });
  const grant = activeGrantFor(p.memberId, scope);
  audit.append({
    actor: p.memberId,
    action: 'jit.used',
    target: `${scope} · ${use.action}${grant ? ` · grant ${grant.id}` : ''}`,
    sensitive: true,
    requestId: use.requestId,
  });
}

/**
 * Route-guard form of `assertElevation`, for a scope that follows from the path
 * alone. Routes whose scope depends on the stored resource (a deployment's
 * product and environment) call `assertElevation` in the handler instead.
 */
export function requireElevation(scopeOf: (params: Record<string, string>) => string): Middleware {
  return (ctx, next) => {
    const p = ctx.principal;
    if (!p) throw new HttpError(401, 'unauthenticated', 'Sign in required');
    assertElevation(p, scopeOf(ctx.params), {
      action: `${ctx.req?.method ?? ''} ${ctx.req?.url ?? ''}`.trim(),
      requestId: ctx.requestId,
    });
    return next();
  };
}

/** Throws 404 (not 403) for out-of-scope resources so their existence isn't revealed. */
export function assertProduct(p: Principal, product: ProductId) {
  if (!canSeeProduct(p, product)) throw new HttpError(404, 'not_found', 'Not found');
}
