/**
 * Project docs routes.
 *
 * Read rules mirror the frontend exactly:
 *  - the doc's product must be one the caller is assigned to,
 *  - `restricted` docs are visible only to their editors (and Owners).
 * Writes require Project:contribute. Bodies are plain markdown; the renderer
 * never injects raw HTML, so stored content can't become stored XSS.
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { assertProduct, canSeeProduct, requireArea } from '../auth/rbac.ts';
import { randomToken } from '../security/crypto.ts';
import { audit } from '../audit/auditLog.ts';
import { db } from '../store/db.ts';
import { HttpError, type Principal, type ProjectDoc } from '../types.ts';

const kinds = ['spec', 'runbook', 'meeting', 'decision', 'guide', 'handover'] as const;
const createBody = v.object({
  projectId: v.string({ max: 40 }),
  title: v.string({ min: 1, max: 140 }),
  kind: v.enumOf(kinds),
  visibility: v.enumOf(['project', 'workspace', 'restricted'] as const),
  body: v.string({ max: 200_000, trim: false }),
});
const updateBody = v.object({
  title: v.optional(v.string({ min: 1, max: 140 })),
  body: v.optional(v.string({ max: 200_000, trim: false })),
  status: v.optional(v.enumOf(['draft', 'in-review', 'published'] as const)),
});

function readable(p: Principal, d: ProjectDoc) {
  return (
    canSeeProduct(p, d.product) &&
    (d.visibility !== 'restricted' || d.editors.includes(p.memberId) || p.role === 'Owner')
  );
}

export function registerDocRoutes(r: Router) {
  r.add(
    'GET',
    '/api/docs',
    'Docs visible to the caller, optionally by project',
    authenticate,
    requireArea('Project', 'view'),
    (ctx) => {
      const p = ctx.principal!;
      const projectId = ctx.query.get('projectId');
      const q = ctx.query.get('q')?.toLowerCase().slice(0, 100);
      return [...db.docs.values()]
        .filter(
          (d) =>
            readable(p, d) &&
            (!projectId || d.projectId === projectId) &&
            (!q || `${d.title} ${d.body}`.toLowerCase().includes(q)),
        )
        .map(({ body: _body, ...meta }) => meta);
    },
  );

  r.add('GET', '/api/docs/:docId', 'One doc', authenticate, (ctx) => {
    const d = db.docs.get(ctx.params.docId);
    if (!d || !readable(ctx.principal!, d)) throw new HttpError(404, 'not_found', 'Not found');
    return d;
  });

  r.add(
    'POST',
    '/api/docs',
    'Create a doc',
    authenticate,
    requireArea('Project', 'contribute'),
    (ctx) => {
      const body = parse(createBody, ctx.body);
      const project = db.projects.get(body.projectId);
      if (!project) throw new HttpError(404, 'not_found', 'Project not found');
      assertProduct(ctx.principal!, project.product);
      const doc: ProjectDoc = {
        id: `doc-${randomToken(8)}`,
        product: project.product,
        status: 'draft',
        editors: [ctx.principal!.memberId],
        updatedBy: ctx.principal!.memberId,
        updatedAt: new Date().toISOString(),
        ...body,
      };
      db.docs.set(doc.id, doc);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'doc.created',
        target: `${doc.title} · ${project.name}`,
        requestId: ctx.requestId,
      });
      return doc;
    },
  );

  r.add(
    'PATCH',
    '/api/docs/:docId',
    'Update a doc',
    authenticate,
    requireArea('Project', 'contribute'),
    (ctx) => {
      const patch = parse(updateBody, ctx.body);
      const d = db.docs.get(ctx.params.docId);
      if (!d || !readable(ctx.principal!, d)) throw new HttpError(404, 'not_found', 'Not found');
      Object.assign(
        d,
        Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined)),
      );
      d.updatedBy = ctx.principal!.memberId;
      d.updatedAt = new Date().toISOString();
      if (!d.editors.includes(d.updatedBy)) d.editors.push(d.updatedBy);
      db.docs.save(d.id);
      audit.append({
        actor: d.updatedBy,
        action: 'doc.updated',
        target: d.title,
        requestId: ctx.requestId,
      });
      return d;
    },
  );

  r.add(
    'DELETE',
    '/api/docs/:docId',
    'Delete a doc',
    authenticate,
    requireArea('Project', 'manage'),
    (ctx) => {
      const d = db.docs.get(ctx.params.docId);
      if (!d || !readable(ctx.principal!, d)) throw new HttpError(404, 'not_found', 'Not found');
      db.docs.delete(d.id);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'doc.deleted',
        target: d.title,
        sensitive: true,
        requestId: ctx.requestId,
      });
    },
  );
}
