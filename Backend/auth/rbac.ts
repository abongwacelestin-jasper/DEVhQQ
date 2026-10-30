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

export function can(p: Principal, area: PermissionArea, level: PermissionLevel): boolean {
  return rank[permissionMatrix[area][p.role]] >= rank[level];
}

export function canSeeProduct(p: Principal, product: ProductId): boolean {
  return p.role === 'Owner' || p.products.includes(product);
}

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
 */
export function requireStepUp(maxAgeMs = 5 * 60_000): Middleware {
  return (ctx, next) => {
    const p = ctx.principal;
    if (!p) throw new HttpError(401, 'unauthenticated', 'Sign in required');
    if (!p.verifiedAt || Date.now() - p.verifiedAt > maxAgeMs)
      throw new HttpError(
        401,
        'step_up_required',
        'Re-verify with your passkey or authenticator to continue',
      );
    return next();
  };
}

/** Requires an active JIT elevation for a scope derived from the request, e.g. "production:renewberry". */
export function requireElevation(scopeOf: (params: Record<string, string>) => string): Middleware {
  return (ctx, next) => {
    const p = ctx.principal;
    if (!p) throw new HttpError(401, 'unauthenticated', 'Sign in required');
    const scope = scopeOf(ctx.params);
    if (p.role !== 'Owner' && !p.elevations.includes(scope))
      throw new HttpError(403, 'elevation_required', `Request just-in-time access for ${scope}`);
    return next();
  };
}

/** Throws 404 (not 403) for out-of-scope resources so their existence isn't revealed. */
export function assertProduct(p: Principal, product: ProductId) {
  if (!canSeeProduct(p, product)) throw new HttpError(404, 'not_found', 'Not found');
}
