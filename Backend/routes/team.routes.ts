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
import { revokeStandingAccess } from '../security/pats.ts';
import { audit } from '../audit/auditLog.ts';
import { hashToken, randomToken } from '../security/crypto.ts';
import { db, findMemberByEmail, publicMember } from '../store/db.ts';
import {
  HttpError,
  type Member,
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

/** How long an invite link stays usable. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

const inviteBody = v.object({
  email: v.email(),
  name: v.optional(v.string({ min: 1, max: 80 })),
  // Owner is never handed out by invite: it can only be transferred by an existing Owner.
  role: v.enumOf(roles.filter((r) => r !== 'Owner') as Exclude<RoleName, 'Owner'>[]),
  products: v.array(v.enumOf(productIds), { max: 3 }),
});

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

/** Next free `mN` id, so seeded and invited members share one numbering scheme. */
function nextMemberId(): string {
  let n = db.members.size + 1;
  while (db.members.has(`m${n}`)) n += 1;
  return `m${n}`;
}

/** "ada.lovelace@corp.dev" → "Ada Lovelace" when no display name is supplied. */
function nameFromEmail(email: string): string {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

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

  /**
   * Invitations create a real member record in the `invited` state plus a
   * single-use accept link.
   *
   * There are no usable credentials yet — the account cannot sign in until the
   * invite is accepted — but the product assignments are real, so the new person
   * appears in the directory and in scope immediately. Only the SHA-256 of the
   * token is stored; the raw link is returned once, to the inviting admin.
   */
  r.add(
    'POST',
    '/api/team/invites',
    {
      summary: 'Invite a member to the workspace',
      tag: 'team',
      responses: [401, 403, 409, 422],
    },
    authenticate,
    requireArea('Organization', 'admin'),
    requireStepUp(),
    (ctx) => {
      const body = parse(inviteBody, ctx.body);
      if (body.products.length === 0)
        throw new HttpError(422, 'validation_failed', 'products must have at least one item');
      const principal = ctx.principal!;
      for (const product of body.products) {
        if (!canSeeProduct(principal, product))
          throw new HttpError(403, 'forbidden', 'You are not assigned to that product');
      }
      if (findMemberByEmail(body.email))
        throw new HttpError(409, 'member_exists', 'A member with that email already exists');

      const id = nextMemberId();
      const inviteToken = randomToken(32);
      const member: Member = {
        id,
        name: body.name?.trim() || nameFromEmail(body.email),
        email: body.email,
        role: body.role,
        products: [...new Set(body.products)],
        status: 'invited',
        // No usable credential: an invited account cannot authenticate.
        passwordHash: '!invited',
        passkeys: [],
        failedLogins: 0,
        inviteTokenHash: hashToken(inviteToken),
        inviteExpiresAt: Date.now() + INVITE_TTL_MS,
      };
      db.members.set(member.id, member);
      audit.append({
        actor: principal.memberId,
        action: 'team.invited',
        target: `${member.email} · ${member.role} · ${member.products.join(', ')}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      return {
        ...publicMember(member),
        // Shown to the inviter once, so the link can be passed on by hand.
        inviteLink: `/accept-invite?token=${inviteToken}`,
        inviteExpiresAt: new Date(member.inviteExpiresAt!).toISOString(),
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
      db.members.save(target.id);
      const revoked = revokeAllFor(target.id);
      // CYBER-010: deactivation also cuts PATs and JIT grants immediately, not only on next use.
      if (patch.status === 'deactivated' && before.status !== 'deactivated')
        revokeStandingAccess(target.id, ctx.principal!.memberId, 'member_inactive', ctx.requestId);
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
