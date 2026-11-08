/**
 * Project routes — the backbone of platform-wide project awareness.
 *
 * Every list is filtered server-side to the caller's products before it
 * leaves the API; the frontend scope picker only narrows further. A project
 * the caller can't see returns 404, never 403, so its existence isn't leaked.
 */

import type { Router } from '../lib/http.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { assertProduct, canSeeProduct, requireArea } from '../auth/rbac.ts';
import { db } from '../store/db.ts';
import { repos } from '../data/index.ts';
import { HttpError, type ProductId } from '../types.ts';

/** Display names live with the API so the browser doesn't keep a second catalogue. */
const PRODUCTS: { id: ProductId; name: string; code: string }[] = [
  { id: 'renewberry', name: 'RenewBerry', code: 'RB' },
  { id: 'blog', name: 'Blog', code: 'BL' },
  { id: 'mirror', name: 'Mirror Acture', code: 'MA' },
];

export function registerProjectRoutes(r: Router) {
  r.add(
    'GET',
    '/api/products',
    'Products the caller is assigned to, with live counts',
    authenticate,
    async (ctx) => {
      const p = ctx.principal!;
      const visible = PRODUCTS.filter((x) => canSeeProduct(p, x.id));
      const allTasks = await repos.tasks.list({ products: visible.map((x) => x.id) });
      const active = await repos.members.list({ status: 'active' });
      return visible.map((product) => {
        const projects = [...db.projects.values()].filter((x) => x.product === product.id);
        const tasks = allTasks.filter((t) => t.product === product.id);
        const today = new Date().toISOString().slice(0, 10);
        return {
          ...product,
          projects: projects.length,
          openTasks: tasks.filter((t) => t.status !== 'done').length,
          lateTasks: tasks.filter((t) => t.status !== 'done' && t.due < today).length,
          members: active.filter((m) => m.products.includes(product.id)).length,
        };
      });
    },
  );

  r.add(
    'GET',
    '/api/projects',
    'Projects visible to the caller',
    authenticate,
    requireArea('Project', 'view'),
    (ctx) => {
      const p = ctx.principal!;
      const product = ctx.query.get('product');
      return [...db.projects.values()].filter(
        (x) => canSeeProduct(p, x.product) && (!product || x.product === product),
      );
    },
  );

  r.add(
    'GET',
    '/api/projects/:projectId',
    'One project with its scope summary',
    authenticate,
    requireArea('Project', 'view'),
    async (ctx) => {
      const project = db.projects.get(ctx.params.projectId);
      if (!project) throw new HttpError(404, 'not_found', 'Not found');
      assertProduct(ctx.principal!, project.product);
      const people = (await repos.members.list({ status: 'active', product: project.product })).map(
        (m) => ({ id: m.id, name: m.name, role: m.role }),
      );
      const docs = [...db.docs.values()].filter((d) => d.projectId === project.id).length;
      return { ...project, people, docs };
    },
  );

  /** Single call the frontend uses to hydrate the global scope picker. */
  r.add(
    'GET',
    '/api/scope',
    'Products and projects the caller may scope to',
    authenticate,
    (ctx) => {
      const p = ctx.principal!;
      const projects = [...db.projects.values()].filter((x) => canSeeProduct(p, x.product));
      const products = [...new Set(projects.map((x) => x.product))];
      return { products, projects };
    },
  );
}
