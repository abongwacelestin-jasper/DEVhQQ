/**
 * Delivery & operations routes: deployments and incidents.
 *
 * Production deploys follow the two-person rule: the requester can never be
 * the approver, the approver needs Deployment:manage plus a fresh step-up,
 * and every transition is audited. Rollbacks are always allowed for
 * Deployment:manage so recovery is never blocked by process (MTTR first).
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { assertProduct, canSeeProduct, requireArea, requireStepUp } from '../auth/rbac.ts';
import { audit } from '../audit/auditLog.ts';
import { publish } from '../lib/events.ts';
import { randomToken } from '../security/crypto.ts';
import { db } from '../store/db.ts';
import { HttpError, type Deployment, type Incident } from '../types.ts';

const products = ['renewberry', 'blog', 'mirror'] as const;

const deployBody = v.object({
  product: v.enumOf(products),
  env: v.enumOf(['staging', 'production'] as const),
  version: v.string({ min: 1, max: 40, pattern: /^[\w.-]+$/ }),
  sha: v.string({ pattern: /^[0-9a-f]{7,40}$/ }),
  provider: v.optional(v.string({ min: 1, max: 40 })),
});
const incidentBody = v.object({
  product: v.enumOf(products),
  title: v.string({ min: 5, max: 160 }),
  severity: v.enumOf(['SEV1', 'SEV2', 'SEV3'] as const),
  owner: v.optional(v.string({ max: 20 })),
  service: v.optional(v.string({ min: 1, max: 60 })),
  impact: v.optional(v.string({ max: 1000 })),
});
const incidentUpdate = v.object({
  status: v.optional(v.enumOf(['investigating', 'identified', 'monitoring', 'resolved'] as const)),
  severity: v.optional(v.enumOf(['SEV1', 'SEV2', 'SEV3'] as const)),
  note: v.optional(v.string({ min: 1, max: 1000 })),
});

export function registerOperationsRoutes(r: Router) {
  // ── Deployments ──────────────────────────────────────────────
  r.add(
    'GET',
    '/api/deployments',
    { summary: 'Deployments (filter: product, env, status)', tag: 'deployments' },
    authenticate,
    requireArea('Deployment', 'view'),
    (ctx) => {
      const q = ctx.query;
      return [...db.deployments.values()]
        .filter(
          (d) =>
            canSeeProduct(ctx.principal!, d.product) &&
            (!q.get('product') || d.product === q.get('product')) &&
            (!q.get('env') || d.env === q.get('env')) &&
            (!q.get('status') || d.status === q.get('status')),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
  );

  r.add(
    'POST',
    '/api/deployments',
    {
      summary: 'Request a deployment (production waits for approval)',
      tag: 'deployments',
      responses: [401, 403, 422],
    },
    authenticate,
    requireArea('Deployment', 'contribute'),
    (ctx) => {
      const body = parse(deployBody, ctx.body);
      assertProduct(ctx.principal!, body.product);
      const d: Deployment = {
        id: `d-${randomToken(4)}`,
        ...body,
        provider: body.provider ?? 'GitHub Actions',
        status: body.env === 'production' ? 'awaiting-approval' : 'running',
        requestedBy: ctx.principal!.memberId,
        createdAt: new Date().toISOString(),
      };
      db.deployments.set(d.id, d);
      audit.append({
        actor: d.requestedBy,
        action: 'deploy.requested',
        target: `${d.product} ${d.version} → ${d.env}`,
        sensitive: d.env === 'production',
        requestId: ctx.requestId,
      });
      publish('deployment', { id: d.id, status: d.status, product: d.product, env: d.env });
      ctx.status = 201;
      return d;
    },
  );

  r.add(
    'POST',
    '/api/deployments/:id/approve',
    {
      summary: 'Approve a production deployment (two-person rule, step-up)',
      tag: 'deployments',
      responses: [401, 403, 404, 409],
    },
    authenticate,
    requireArea('Deployment', 'manage'),
    requireStepUp(),
    (ctx) => {
      const d = db.deployments.get(ctx.params.id);
      if (!d || !canSeeProduct(ctx.principal!, d.product))
        throw new HttpError(404, 'not_found', 'Not found');
      if (d.status !== 'awaiting-approval')
        throw new HttpError(409, 'not_pending', `Deployment is ${d.status}`);
      if (d.requestedBy === ctx.principal!.memberId)
        throw new HttpError(403, 'self_approval', 'You can’t approve your own deployment');
      d.status = 'running';
      d.approvedBy = ctx.principal!.memberId;
      db.deployments.save(d.id);
      audit.append({
        actor: d.approvedBy,
        action: 'deploy.approved',
        target: `${d.product} ${d.version}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      publish('deployment', { id: d.id, status: d.status });
      // Simulated rollout completes a few seconds later.
      setTimeout(() => {
        if (d.status === 'running') {
          d.status = 'succeeded';
          db.deployments.save(d.id);
          publish('deployment', { id: d.id, status: d.status });
        }
      }, 4000).unref();
      return d;
    },
  );

  r.add(
    'POST',
    '/api/deployments/:id/rollback',
    { summary: 'Roll back a deployment', tag: 'deployments', responses: [401, 403, 404, 409] },
    authenticate,
    requireArea('Deployment', 'manage'),
    (ctx) => {
      const d = db.deployments.get(ctx.params.id);
      if (!d || !canSeeProduct(ctx.principal!, d.product))
        throw new HttpError(404, 'not_found', 'Not found');
      if (d.status === 'rolled-back')
        throw new HttpError(409, 'already_rolled_back', 'Already rolled back');
      d.status = 'rolled-back';
      db.deployments.save(d.id);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'deploy.rolled_back',
        target: `${d.product} ${d.version}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
      publish('deployment', { id: d.id, status: d.status });
      return d;
    },
  );

  // ── Incidents ────────────────────────────────────────────────
  r.add(
    'GET',
    '/api/incidents',
    { summary: 'Incidents (filter: product, status, severity)', tag: 'incidents' },
    authenticate,
    (ctx) => {
      const q = ctx.query;
      return [...db.incidents.values()]
        .filter(
          (i) =>
            canSeeProduct(ctx.principal!, i.product) &&
            (!q.get('product') || i.product === q.get('product')) &&
            (!q.get('status') || i.status === q.get('status')) &&
            (!q.get('severity') || i.severity === q.get('severity')),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },
  );

  /** MTTR summary — the assume-breach metric we optimise for. Registered before /:id so it isn't shadowed. */
  r.add(
    'GET',
    '/api/incidents/_stats',
    { summary: 'Mean time to recover and open-incident counts', tag: 'incidents' },
    authenticate,
    (ctx) => {
      const list = [...db.incidents.values()].filter((i) =>
        canSeeProduct(ctx.principal!, i.product),
      );
      const resolved = list.filter((i) => i.resolvedAt);
      const mttrMin = resolved.length
        ? Math.round(
            resolved.reduce(
              (n, i) => n + (new Date(i.resolvedAt!).getTime() - new Date(i.startedAt).getTime()),
              0,
            ) /
              resolved.length /
              60_000,
          )
        : null;
      return {
        open: list.filter((i) => i.status !== 'resolved').length,
        resolved: resolved.length,
        mttrMinutes: mttrMin,
        bySeverity: Object.fromEntries(
          ['SEV1', 'SEV2', 'SEV3'].map((s) => [
            s,
            list.filter((i) => i.severity === s && i.status !== 'resolved').length,
          ]),
        ),
      };
    },
  );

  r.add(
    'GET',
    '/api/incidents/:id',
    { summary: 'One incident with timeline', tag: 'incidents', responses: [401, 404] },
    authenticate,
    (ctx) => {
      const i = db.incidents.get(ctx.params.id.toUpperCase());
      if (!i || !canSeeProduct(ctx.principal!, i.product))
        throw new HttpError(404, 'not_found', 'Not found');
      return i;
    },
  );

  r.add(
    'POST',
    '/api/incidents',
    { summary: 'Declare an incident', tag: 'incidents', responses: [401, 403, 422] },
    authenticate,
    (ctx) => {
      const body = parse(incidentBody, ctx.body);
      assertProduct(ctx.principal!, body.product);
      const n =
        [...db.incidents.keys()]
          .map((k) => Number(k.split('-')[1]))
          .reduce((a, b) => Math.max(a, b), 0) + 1;
      const at = new Date().toISOString();
      const i: Incident = {
        id: `INC-${n}`,
        product: body.product,
        title: body.title,
        severity: body.severity,
        status: 'investigating',
        owner: body.owner ?? ctx.principal!.memberId,
        service: body.service ?? `${body.product}-app`,
        impact: body.impact ?? 'Impact under assessment.',
        startedAt: at,
        timeline: [{ at, by: ctx.principal!.memberId, note: 'Declared' }],
      };
      db.incidents.set(i.id, i);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'incident.declared',
        target: `${i.id} ${i.severity} · ${i.title}`,
        sensitive: i.severity === 'SEV1',
        requestId: ctx.requestId,
      });
      publish('incident', { id: i.id, severity: i.severity, status: i.status });
      ctx.status = 201;
      return i;
    },
  );

  r.add(
    'PATCH',
    '/api/incidents/:id',
    {
      summary: 'Update status/severity or add a timeline note',
      tag: 'incidents',
      responses: [401, 404, 422],
    },
    authenticate,
    (ctx) => {
      const patch = parse(incidentUpdate, ctx.body);
      const i = db.incidents.get(ctx.params.id.toUpperCase());
      if (!i || !canSeeProduct(ctx.principal!, i.product))
        throw new HttpError(404, 'not_found', 'Not found');
      const at = new Date().toISOString();
      const notes: string[] = [];
      if (patch.status && patch.status !== i.status) {
        notes.push(`Status → ${patch.status}`);
        i.status = patch.status;
        if (patch.status === 'resolved') i.resolvedAt = at;
      }
      if (patch.severity && patch.severity !== i.severity) {
        notes.push(`Severity → ${patch.severity}`);
        i.severity = patch.severity;
      }
      if (patch.note) notes.push(patch.note);
      if (!notes.length) throw new HttpError(422, 'no_change', 'Nothing to update');
      i.timeline.push({ at, by: ctx.principal!.memberId, note: notes.join(' · ') });
      db.incidents.save(i.id);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'incident.updated',
        target: `${i.id}: ${notes.join(' · ')}`,
        requestId: ctx.requestId,
      });
      publish('incident', { id: i.id, status: i.status });
      return i;
    },
  );
}
