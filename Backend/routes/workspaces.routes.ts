/**
 * Workspaces with membership.
 *
 *  - Visible to their members; Organization:admin sees all. Others get 404.
 *  - Create: Organization:admin.
 *  - Update: workspace owner/admin or Organization:admin. Scheduling deletion
 *    and turning off required MFA are Organization:admin + step-up.
 */

import type { Ctx, Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { can, requireArea, requireStepUp } from '../auth/rbac.ts';
import { randomToken } from '../security/crypto.ts';
import { audit } from '../audit/auditLog.ts';
import { repos } from '../data/index.ts';
import { HttpError, type Principal } from '../types.ts';
import { workspaces } from '../domain/collab/store.ts';
import { ensureCollabSeed } from '../domain/collab/seed.ts';
import type { ModuleKey, WorkspaceRecord } from '../domain/collab/types.ts';

const moduleKeys = [
  'projects',
  'engineering',
  'delivery',
  'operations',
  'automation',
  'assistant',
] as const;
const templates: Record<string, ModuleKey[]> = {
  product: ['projects', 'engineering', 'delivery', 'operations', 'assistant'],
  agency: ['projects', 'engineering', 'delivery'],
  regulated: ['projects', 'engineering', 'delivery', 'operations', 'automation', 'assistant'],
  startup: ['projects', 'engineering'],
};
const memberId = () => v.string({ min: 1, max: 40, pattern: /^[A-Za-z0-9_-]+$/ });
const wsRole = v.enumOf(['admin', 'member'] as const);

const createBody = v.object({
  name: v.string({ min: 2, max: 60 }),
  slug: v.string({ min: 2, max: 40, pattern: /^[a-z0-9][a-z0-9-]*$/ }),
  color: v.optional(v.string({ pattern: /^#[0-9A-Fa-f]{6}$/ })),
  template: v.enumOf(Object.keys(templates) as [string, ...string[]]),
  modules: v.optional(v.array(v.enumOf(moduleKeys), { max: 6 })),
  mfaRequired: v.optional(v.boolean()),
  members: v.optional(v.array(memberId(), { max: 500 })),
  products: v.optional(v.array(v.enumOf(['renewberry', 'blog', 'mirror'] as const), { max: 3 })),
});

const patchBody = v.object({
  name: v.optional(v.string({ min: 2, max: 60 })),
  color: v.optional(v.string({ pattern: /^#[0-9A-Fa-f]{6}$/ })),
  modules: v.optional(v.array(v.enumOf(moduleKeys), { max: 6 })),
  mfaRequired: v.optional(v.boolean()),
  addMembers: v.optional(v.array(memberId(), { max: 500 })),
  removeMembers: v.optional(v.array(memberId(), { max: 500 })),
  setRole: v.optional(v.object({ memberId: memberId(), role: wsRole })),
  scheduleDeletion: v.optional(v.boolean()),
});

function membership(ws: WorkspaceRecord, id: string) {
  return ws.members.find((m) => m.memberId === id);
}

function visible(p: Principal, ws: WorkspaceRecord) {
  return !!membership(ws, p.memberId) || can(p, 'Organization', 'admin');
}

function view(p: Principal, ws: WorkspaceRecord) {
  const mine = membership(ws, p.memberId);
  return {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    color: ws.color,
    template: ws.template,
    modules: ws.modules,
    mfaRequired: ws.mfaRequired,
    ownerId: ws.ownerId,
    members: ws.members.length,
    products: ws.products.length,
    memberIds: ws.members.map((m) => m.memberId),
    memberRoles: ws.members,
    productIds: ws.products,
    role: mine?.role === 'owner' ? 'Owner' : mine?.role === 'admin' ? 'Admin' : p.role,
    pendingDeletionAt: ws.pendingDeletionAt,
    createdAt: ws.createdAt,
    updatedAt: ws.updatedAt,
  };
}

async function activeIds(ids: string[]): Promise<string[]> {
  for (const id of ids) {
    const m = await repos.members.get(id);
    if (!m || m.status !== 'active')
      throw new HttpError(422, 'validation_failed', `members: ${id} is not an active member`);
  }
  return [...new Set(ids)];
}

function withModules(list: ModuleKey[]): ModuleKey[] {
  return [...new Set<ModuleKey>(['projects', ...list])];
}

async function stepUp(ctx: Ctx) {
  await requireStepUp()(ctx, () => Promise.resolve(undefined));
}

export function registerWorkspaceRoutes(r: Router) {
  const tag = 'workspaces';

  r.add(
    'GET',
    '/api/workspaces',
    { summary: 'Workspaces the caller belongs to', tag },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      return {
        items: [...workspaces.values()].filter((ws) => visible(p, ws)).map((ws) => view(p, ws)),
      };
    },
  );

  r.add(
    'GET',
    '/api/workspaces/:id',
    { summary: 'One workspace', tag, responses: [401, 404] },
    authenticate,
    (ctx) => {
      ensureCollabSeed();
      const ws = workspaces.get(ctx.params.id);
      if (!ws || !visible(ctx.principal!, ws)) throw new HttpError(404, 'not_found', 'Not found');
      return view(ctx.principal!, ws);
    },
  );

  r.add(
    'POST',
    '/api/workspaces',
    { summary: 'Create a workspace (Organization:admin)', tag, responses: [401, 403, 409, 422] },
    authenticate,
    requireArea('Organization', 'admin'),
    async (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const body = parse(createBody, ctx.body);
      if ([...workspaces.values()].some((ws) => ws.slug === body.slug))
        throw new HttpError(409, 'slug_taken', 'That workspace address is taken');
      const now = new Date().toISOString();
      const others = (await activeIds(body.members ?? [])).filter((id) => id !== p.memberId);
      const ws: WorkspaceRecord = {
        id: `ws-${randomToken(6)}`,
        name: body.name,
        slug: body.slug,
        color: body.color ?? '#4F46E5',
        template: body.template,
        modules: withModules(body.modules ?? templates[body.template]),
        mfaRequired: body.mfaRequired ?? true,
        ownerId: p.memberId,
        members: [
          { memberId: p.memberId, role: 'owner' },
          ...others.map((id) => ({ memberId: id, role: 'member' as const })),
        ],
        products: [...new Set(body.products ?? [])],
        createdAt: now,
        updatedAt: now,
      };
      workspaces.set(ws.id, ws);
      audit.append({
        actor: p.memberId,
        action: 'workspace.created',
        target: `${ws.name} (${ws.slug}) · ${ws.members.length} members`,
        requestId: ctx.requestId,
      });
      ctx.status = 201;
      return view(p, ws);
    },
  );

  r.add(
    'PATCH',
    '/api/workspaces/:id',
    {
      summary: 'Update a workspace, its modules or membership',
      tag,
      responses: [401, 403, 404, 409, 422],
    },
    authenticate,
    async (ctx) => {
      ensureCollabSeed();
      const p = ctx.principal!;
      const body = parse(patchBody, ctx.body);
      const ws = workspaces.get(ctx.params.id);
      if (!ws || !visible(p, ws)) throw new HttpError(404, 'not_found', 'Not found');
      const orgAdmin = can(p, 'Organization', 'admin');
      const role = membership(ws, p.memberId)?.role;
      if (!orgAdmin && role !== 'owner' && role !== 'admin')
        throw new HttpError(403, 'forbidden', 'Only workspace admins can change this workspace');
      const sensitive = body.scheduleDeletion !== undefined || body.mfaRequired === false;
      if (sensitive) {
        if (!orgAdmin) throw new HttpError(403, 'forbidden', 'Requires admin on Organization');
        await stepUp(ctx);
      }

      if (body.name !== undefined) ws.name = body.name;
      if (body.color !== undefined) ws.color = body.color;
      if (body.modules !== undefined) ws.modules = withModules(body.modules);
      if (body.mfaRequired !== undefined) ws.mfaRequired = body.mfaRequired;
      if (body.addMembers)
        for (const id of await activeIds(body.addMembers))
          if (!membership(ws, id)) ws.members.push({ memberId: id, role: 'member' });
      if (body.removeMembers) {
        if (body.removeMembers.includes(ws.ownerId))
          throw new HttpError(
            409,
            'owner_required',
            'Transfer ownership before removing the owner',
          );
        const drop = new Set(body.removeMembers);
        ws.members = ws.members.filter((m) => !drop.has(m.memberId));
      }
      if (body.setRole) {
        const target = membership(ws, body.setRole.memberId);
        if (!target) throw new HttpError(404, 'not_found', 'Not a workspace member');
        if (target.role === 'owner')
          throw new HttpError(409, 'owner_required', 'The owner’s role can’t change');
        target.role = body.setRole.role;
      }
      if (body.scheduleDeletion !== undefined)
        ws.pendingDeletionAt = body.scheduleDeletion
          ? new Date(Date.now() + 7 * 86_400_000).toISOString()
          : undefined;
      ws.updatedAt = new Date().toISOString();
      workspaces.save(ws.id);
      audit.append({
        actor: p.memberId,
        action: body.scheduleDeletion ? 'workspace.deletion_scheduled' : 'workspace.updated',
        target: `${ws.name} (${ws.slug}) · ${Object.keys(body)
          .filter((k) => body[k as keyof typeof body] !== undefined)
          .join(', ')}`,
        sensitive,
        requestId: ctx.requestId,
      });
      return view(p, ws);
    },
  );
}
