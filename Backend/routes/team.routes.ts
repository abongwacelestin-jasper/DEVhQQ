/**
 * Team & roles routes.
 *
 * Reading the directory is scoped to shared products. Changing roles or
 * product access is an Organization-admin action that also requires a fresh
 * step-up verification; any privilege change revokes the target's sessions
 * so the new permissions apply immediately.
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { canSeeProduct, permissionMatrix, requireArea, requireStepUp } from '../auth/rbac.ts';
import { approveGrant, listGrants, requestGrant, revokeGrant } from '../auth/jit.ts';
import { revokeAllFor } from '../auth/sessions.ts';
import { audit } from '../audit/auditLog.ts';
import { db } from '../store/db.ts';
import {
  HttpError,
  type PermissionArea,
  type PermissionLevel,
  type ProductId,
  type RoleName,
} from '../types.ts';

const roles = [
  'Owner',
  'Project manager',
  'Developer',
  'Designer',
  'Tester',
  'Operations',
] as const;
const productIds = ['renewberry', 'blog', 'mirror'] as const;

const updateBody = v.object({
  role: v.optional(v.enumOf(roles)),
  products: v.optional(v.array(v.enumOf(productIds), { max: 3 })),
  status: v.optional(v.enumOf(['active', 'deactivated'] as const)),
});
const grantBody = v.object({
  scope: v.string({ max: 40 }),
  reason: v.string({ min: 10, max: 500 }),
  durationMinutes: v.int({ min: 15, max: 480 }),
});

export function registerTeamRoutes(r: Router) {
  r.add(
    'GET',
    '/api/team',
    'Members who share a product with the caller',
    authenticate,
    requireArea('Organization', 'view'),
    (ctx) => {
      const p = ctx.principal!;
      const project = ctx.query.get('projectId');
      const scopedProduct = project ? db.projects.get(project)?.product : undefined;
      return [...db.members.values()]
        .filter(
          (m) =>
            m.products.some((x) => canSeeProduct(p, x)) &&
            (!scopedProduct || m.products.includes(scopedProduct)),
        )
        .map(({ id, name, email, role, products, status, passkeys, totpSecret }) => ({
          id,
          name,
          email,
          role,
          products,
          status,
          mfa: passkeys.length > 0 || !!totpSecret,
          passkey: passkeys.length > 0,
        }));
    },
  );

  r.add(
    'GET',
    '/api/team/roles',
    'Role × area permission matrix',
    authenticate,
    () => permissionMatrix,
  );

  /**
   * The caller's own effective permissions, so the web app can render navigation and
   * buttons from the server's matrix instead of a second copy of it. Scoped to the
   * caller's role — it never returns another member's capabilities.
   */
  r.add(
    'GET',
    '/api/me/capabilities',
    { summary: 'Effective permissions for the signed-in member', tag: 'auth' },
    authenticate,
    (ctx) => {
      const p = ctx.principal!;
      const levels: PermissionLevel[] = ['none', 'view', 'contribute', 'manage', 'admin'];
      const matrix = Object.fromEntries(
        (Object.keys(permissionMatrix) as PermissionArea[]).map((area) => [
          area,
          permissionMatrix[area][p.role],
        ]),
      );
      return {
        role: p.role,
        products: p.products,
        matrix,
        levels,
        verifiedAt: p.verifiedAt,
        elevations: p.elevations,
      };
    },
  );

  r.add(
    'PATCH',
    '/api/team/:memberId',
    'Change role, products or status',
    authenticate,
    requireArea('Organization', 'admin'),
    requireStepUp(),
    (ctx) => {
      const patch = parse(updateBody, ctx.body);
      const target = db.members.get(ctx.params.memberId);
      if (!target) throw new HttpError(404, 'not_found', 'Not found');
      if (target.id === ctx.principal!.memberId && patch.role && patch.role !== target.role)
        throw new HttpError(403, 'self_demotion', 'Ask another Owner to change your role');
      if (
        target.role === 'Owner' &&
        patch.role &&
        patch.role !== 'Owner' &&
        [...db.members.values()].filter((m) => m.role === 'Owner' && m.status === 'active')
          .length === 1
      ) {
        throw new HttpError(409, 'last_owner', 'The workspace needs at least one Owner');
      }
      const before = { role: target.role, products: [...target.products], status: target.status };
      if (patch.role) target.role = patch.role as RoleName;
      if (patch.products) target.products = patch.products as ProductId[];
      if (patch.status) target.status = patch.status;
      const revoked = revokeAllFor(target.id);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'team.updated',
        target: `${target.name}: ${JSON.stringify(before)} → ${JSON.stringify(patch)} · ${revoked} session(s) revoked`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      return { id: target.id, role: target.role, products: target.products, status: target.status };
    },
  );

  // Just-in-time production access.
  r.add(
    'GET',
    '/api/access/grants',
    'All JIT grants',
    authenticate,
    requireArea('Administration', 'view'),
    () => listGrants(),
  );

  r.add(
    'POST',
    '/api/access/grants',
    'Request time-boxed production access',
    authenticate,
    requireStepUp(),
    (ctx) => {
      const body = parse(grantBody, ctx.body);
      const product = body.scope.split(':')[1] as ProductId;
      if (!canSeeProduct(ctx.principal!, product))
        throw new HttpError(403, 'forbidden', 'You are not assigned to this product');
      return requestGrant(
        ctx.principal!.memberId,
        body.scope,
        body.reason,
        body.durationMinutes * 60_000,
      );
    },
  );

  r.add(
    'POST',
    '/api/access/grants/:grantId/approve',
    'Approve a JIT grant (two-person rule)',
    authenticate,
    requireStepUp(),
    (ctx) =>
      approveGrant(ctx.params.grantId, {
        memberId: ctx.principal!.memberId,
        role: ctx.principal!.role,
      }),
  );

  r.add(
    'POST',
    '/api/access/grants/:grantId/revoke',
    'Revoke or deny a JIT grant',
    authenticate,
    requireArea('Deployment', 'manage'),
    requireStepUp(),
    (ctx) => revokeGrant(ctx.params.grantId, ctx.principal!.memberId),
  );
}
