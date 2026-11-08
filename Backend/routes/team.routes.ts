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
import { can, canSeeProduct, permissionMatrix, requireArea, requireStepUp } from '../auth/rbac.ts';
import { asPrincipal, notify } from '../domain/collab/notify.ts';
import {
  APPROVER_ROLES,
  approveGrant,
  grantsOf,
  listGrants,
  requestGrant,
  revokeGrant,
  getGrant,
  grantProduct,
} from '../auth/jit.ts';
import { revokeAllFor } from '../auth/sessions.ts';
import { revokeStandingAccess } from '../security/pats.ts';
import { audit } from '../audit/auditLog.ts';
import { hashToken, randomToken } from '../security/crypto.ts';
import { db, findMemberByEmail, publicMember } from '../store/db.ts';
import { repos } from '../data/index.ts';
import { sendInvite } from '../mail/events.ts';
import {
  HttpError,
  type Member,
  type PermissionArea,
  type Principal,
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

const accessRequestBody = v.object({
  /** In-app path the member was refused, e.g. `/audit`. */
  path: v.string({ min: 1, max: 200 }),
  reason: v.optional(v.string({ max: 500 })),
});

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

/**
 * Creates an invited member under the next free `mN` id, so seeded and invited
 * members share one numbering scheme. The unique keys decide, not a prior
 * read: two replicas inviting at once get different ids, and a duplicate
 * email is refused (409) even when both pass the pre-check.
 */
async function insertWithNextId(member: Member): Promise<Member> {
  let n = (await repos.members.count()) + 1;
  for (;;) {
    const candidate = { ...member, id: `m${n}` };
    const result = await repos.members.insert(candidate);
    if (result === 'ok') return candidate;
    if (result === 'email_taken')
      throw new HttpError(409, 'member_exists', 'A member with that email already exists');
    n += 1;
  }
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

/**
 * Approving or revoking a grant needs sight of its product: an approver outside the
 * product must not satisfy the two-person rule there, and gets the same 404 as for
 * a grant that does not exist (W5-02).
 */
function grantInScope(p: Principal, grantId: string): string {
  const g = getGrant(grantId);
  if (!g || !canSeeProduct(p, grantProduct(g)))
    throw new HttpError(404, 'not_found', 'No such grant');
  return g.id;
}

export function registerTeamRoutes(r: Router) {
  r.add(
    'GET',
    '/api/team',
    'Members who share a product with the caller',
    authenticate,
    requireArea('Organization', 'view'),
    async (ctx) => {
      const p = ctx.principal!;
      const project = ctx.query.get('projectId');
      const scopedProduct = project ? db.projects.get(project)?.product : undefined;
      return (await repos.members.list())
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
    async (ctx) => {
      const body = parse(inviteBody, ctx.body);
      if (body.products.length === 0)
        throw new HttpError(422, 'validation_failed', 'products must have at least one item');
      const principal = ctx.principal!;
      for (const product of body.products) {
        if (!canSeeProduct(principal, product))
          throw new HttpError(403, 'forbidden', 'You are not assigned to that product');
      }
      if (await findMemberByEmail(body.email))
        throw new HttpError(409, 'member_exists', 'A member with that email already exists');

      const inviteToken = randomToken(32);
      const member = await insertWithNextId({
        id: '',
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
      });
      audit.append({
        actor: principal.memberId,
        action: 'team.invited',
        target: `${member.email} · ${member.role} · ${member.products.join(', ')}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      void sendInvite(member, principal.memberId, inviteToken);
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
    async (ctx) => {
      const patch = parse(updateBody, ctx.body);
      const target = await repos.members.get(ctx.params.memberId);
      if (!target) throw new HttpError(404, 'not_found', 'Not found');
      if (target.id === ctx.principal!.memberId && patch.role && patch.role !== target.role)
        throw new HttpError(403, 'self_demotion', 'Ask another Owner to change your role');
      if (target.id === ctx.principal!.memberId && patch.status && patch.status !== target.status)
        throw new HttpError(403, 'self_demotion', 'Ask another Owner to change your status');
      // Demoting or deactivating the last active Owner would leave nobody to administer the
      // workspace (FINDING B-7).
      if (
        target.role === 'Owner' &&
        target.status === 'active' &&
        ((patch.role && patch.role !== 'Owner') || (patch.status && patch.status !== 'active')) &&
        (await repos.members.count({ role: 'Owner', status: 'active' })) === 1
      ) {
        throw new HttpError(409, 'last_owner', 'The workspace needs at least one Owner');
      }
      const before = { role: target.role, products: [...target.products], status: target.status };
      if (patch.role) target.role = patch.role as RoleName;
      if (patch.products) target.products = patch.products as ProductId[];
      if (patch.status) target.status = patch.status;
      await repos.members.put(target);
      const revoked = await revokeAllFor(target.id);
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

  // "Request access" on the web app's no-access page: audited, and every member who
  // can manage the team is notified. Granting stays a role/product change on the
  // member's page (step-up). Repeats collapse into the same unread notification.
  r.add(
    'POST',
    '/api/access/requests',
    {
      summary: 'Ask the admins for access to an area of the app',
      tag: 'team',
      responses: [401, 422],
    },
    authenticate,
    async (ctx) => {
      const p = ctx.principal!;
      const body = parse(accessRequestBody, ctx.body);
      if (!body.path.startsWith('/'))
        throw new HttpError(422, 'validation_failed', 'path must be an in-app path');
      const members = await repos.members.list();
      const me = members.find((m) => m.id === p.memberId);
      const reason = body.reason?.trim();
      audit.append({
        actor: p.memberId,
        action: 'access.requested',
        target: `${body.path}${reason ? ` · ${reason}` : ''}`,
        requestId: ctx.requestId,
      });
      let notified = 0;
      for (const m of members) {
        if (m.status !== 'active' || m.id === p.memberId) continue;
        if (!can(asPrincipal(m), 'Administration', 'manage')) continue;
        const n = await notify({
          memberId: m.id,
          kind: 'approval',
          title: `${me?.name ?? p.memberId} requested access to ${body.path}`,
          body: reason || 'No reason given.',
          link: `/team/${p.memberId}`,
          refId: `access:${p.memberId}:${body.path}`,
          actor: p.memberId,
        });
        if (n) notified++;
      }
      return { requested: body.path, notified };
    },
  );

  // Just-in-time production access.
  r.add(
    'GET',
    '/api/access/grants',
    'All JIT grants',
    authenticate,
    requireArea('Administration', 'view'),
    // Only grants for products the caller can see: reasons and requesters are not
    // shared across products (W5-02).
    (ctx) => listGrants().filter((g) => canSeeProduct(ctx.principal!, grantProduct(g))),
  );

  // The requester's own grants (pending, active, ended), so the place where they act can
  // show what is waiting and how long is left. Never anyone else's.
  r.add(
    'GET',
    '/api/access/grants/mine',
    { summary: 'My JIT grants', tag: 'team', responses: [401] },
    authenticate,
    (ctx) => grantsOf(ctx.principal!.memberId),
  );

  r.add(
    'POST',
    '/api/access/grants',
    'Request time-boxed production access',
    authenticate,
    requireStepUp(),
    async (ctx) => {
      const body = parse(grantBody, ctx.body);
      const product = body.scope.split(':')[1] as ProductId;
      const p = ctx.principal!;
      if (!canSeeProduct(p, product))
        throw new HttpError(403, 'forbidden', 'You are not assigned to this product');
      const grant = requestGrant(
        p.memberId,
        body.scope,
        body.reason,
        body.durationMinutes * 60_000,
        ctx.requestId,
      );
      // Tell every approver in scope; they decide on the Security page (two-person rule).
      const members = await repos.members.list();
      const me = members.find((m) => m.id === p.memberId);
      for (const m of members) {
        if (m.status !== 'active' || m.id === p.memberId || !APPROVER_ROLES.includes(m.role))
          continue;
        if (!canSeeProduct(asPrincipal(m), product)) continue;
        await notify({
          memberId: m.id,
          kind: 'approval',
          title: `${me?.name ?? p.memberId} requested ${grant.scope} access`,
          body: `${Math.round(grant.durationMs / 60_000)} min · ${grant.reason}`,
          link: '/security',
          refId: `jit:${grant.id}`,
          actor: p.memberId,
        });
      }
      return grant;
    },
  );

  r.add(
    'POST',
    '/api/access/grants/:grantId/approve',
    'Approve a JIT grant (two-person rule)',
    authenticate,
    requireStepUp(),
    (ctx) =>
      approveGrant(
        grantInScope(ctx.principal!, ctx.params.grantId),
        {
          memberId: ctx.principal!.memberId,
          role: ctx.principal!.role,
        },
        ctx.requestId,
      ),
  );

  r.add(
    'POST',
    '/api/access/grants/:grantId/revoke',
    'Revoke or deny a JIT grant',
    authenticate,
    requireArea('Deployment', 'manage'),
    requireStepUp(),
    (ctx) =>
      revokeGrant(
        grantInScope(ctx.principal!, ctx.params.grantId),
        ctx.principal!.memberId,
        ctx.requestId,
      ),
  );
}
