/**
 * Incident recovery steps and follow-up action items.
 *
 *   GET    /api/incidents/:id/actions             anyone who can see the incident
 *   POST   /api/incidents/:id/actions             Infrastructure:contribute
 *   PATCH  /api/incidents/:id/actions/:actionId   Infrastructure:contribute
 *   DELETE /api/incidents/:id/actions/:actionId   Infrastructure:manage
 *
 * Scope is checked before the role: an incident in a product the caller is
 * not assigned to answers 404 whatever their role, so its existence is never
 * revealed. The owner must be an active member who can see the product.
 *
 * Every write appends an incident timeline entry and an audit entry, and
 * publishes the `incident` bus event so other viewers re-read. Assigning an
 * owner notifies them (kind `assignment`).
 */

import type { Ctx, Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { can, canSeeProduct } from '../auth/rbac.ts';
import { audit } from '../audit/auditLog.ts';
import { publish } from '../lib/events.ts';
import { db } from '../store/db.ts';
import { asPrincipal, excerpt, notify } from '../domain/collab/notify.ts';
import { sortableId } from '../domain/collab/store.ts';
import {
  ACTION_KINDS,
  ACTION_STATUSES,
  MAX_ACTIONS_PER_INCIDENT,
  actionsOf,
  incidentActions,
  type IncidentAction,
} from '../domain/incidents/actions.ts';
import { HttpError, type Incident, type PermissionLevel, type Principal } from '../types.ts';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` that is a real calendar date; `null` or `''` clears it. */
function dueDate(val: unknown, path: string): string | null {
  if (val === null || val === '') return null;
  const s = v.string({ max: 10, pattern: DAY })(val, path);
  const [, y, m, d] = DAY.exec(s)!;
  const t = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (
    t.getUTCFullYear() !== Number(y) ||
    t.getUTCMonth() !== Number(m) - 1 ||
    t.getUTCDate() !== Number(d)
  )
    throw new HttpError(422, 'validation_failed', `${path} is not a calendar date`);
  return s;
}

/** Optional free text; `null` or blank clears it. */
function detailText(val: unknown, path: string): string | null {
  if (val === null) return null;
  const s = v.string({ max: 2000 })(val, path);
  return s || null;
}

const memberId = v.string({ min: 1, max: 40, pattern: /^[\w-]+$/ });

const createBody = v.object({
  title: v.string({ min: 1, max: 200 }),
  detail: v.optional(detailText),
  owner: v.optional(memberId),
  due: v.optional(dueDate),
  kind: v.optional(v.enumOf(ACTION_KINDS)),
});

const patchBody = v.object({
  title: v.optional(v.string({ min: 1, max: 200 })),
  detail: v.optional(detailText),
  owner: v.optional(memberId),
  due: v.optional(dueDate),
  status: v.optional(v.enumOf(ACTION_STATUSES)),
  kind: v.optional(v.enumOf(ACTION_KINDS)),
});

/** The incident named in the URL, or 404 when it is missing or outside the caller's products. */
function visibleIncident(p: Principal, id: string): Incident {
  const i = db.incidents.get(id.toUpperCase());
  if (!i || !canSeeProduct(p, i.product)) throw new HttpError(404, 'not_found', 'Not found');
  return i;
}

function requireInfra(p: Principal, level: PermissionLevel) {
  if (!can(p, 'Infrastructure', level))
    throw new HttpError(403, 'forbidden', `Requires ${level} on Infrastructure`);
}

function actionOf(i: Incident, actionId: string): IncidentAction {
  const a = incidentActions.get(actionId);
  if (!a || a.incidentId !== i.id) throw new HttpError(404, 'not_found', 'Not found');
  return a;
}

/** Owners are active members who can see the incident's product. */
function assertOwner(i: Incident, owner: string) {
  const m = db.members.get(owner);
  if (!m || m.status !== 'active' || !canSeeProduct(asPrincipal(m), i.product))
    throw new HttpError(
      422,
      'invalid_owner',
      'owner must be an active member who can see this product',
    );
}

const nameOf = (id: string) => db.members.get(id)?.name ?? id;
const quoted = (title: string) => `“${excerpt(title, 80)}”`;

/** Timeline entry + audit entry + bus event: the record every write leaves. */
function record(
  ctx: Ctx,
  i: Incident,
  a: IncidentAction,
  action: string,
  note: string,
  at: string,
) {
  const actor = ctx.principal!.memberId;
  i.timeline.push({ at, by: actor, note });
  db.incidents.save(i.id);
  audit.append({
    actor,
    action,
    target: `${i.id} ${a.id}: ${note}`,
    requestId: ctx.requestId,
  });
  publish('incident', { id: i.id, status: i.status, product: i.product, actionId: a.id });
}

function notifyOwner(i: Incident, a: IncidentAction, actor: string) {
  notify({
    memberId: a.owner,
    kind: 'assignment',
    title: `${i.id}: ${a.kind === 'mitigation' ? 'mitigation step' : 'follow-up'} assigned to you`,
    body: a.title,
    link: `/incidents/${encodeURIComponent(i.id)}`,
    refId: `incident-action:${a.id}:owner:${a.owner}`,
    actor,
  });
}

export function registerIncidentActionRoutes(r: Router) {
  const tag = 'incidents';

  r.add(
    'GET',
    '/api/incidents/:id/actions',
    {
      summary: 'Recovery steps and follow-ups of an incident, oldest first',
      tag,
      responses: [401, 404],
    },
    authenticate,
    (ctx) => actionsOf(visibleIncident(ctx.principal!, ctx.params.id).id),
  );

  r.add(
    'POST',
    '/api/incidents/:id/actions',
    {
      summary: 'Add a recovery step or follow-up (Infrastructure ≥ contribute)',
      tag,
      responses: [401, 403, 404, 409, 422],
    },
    authenticate,
    (ctx) => {
      const p = ctx.principal!;
      const i = visibleIncident(p, ctx.params.id);
      requireInfra(p, 'contribute');
      const body = parse(createBody, ctx.body);
      const owner = body.owner ?? p.memberId;
      assertOwner(i, owner);
      if (actionsOf(i.id).length >= MAX_ACTIONS_PER_INCIDENT)
        throw new HttpError(
          409,
          'too_many_actions',
          `An incident can have at most ${MAX_ACTIONS_PER_INCIDENT} actions`,
        );
      const at = new Date().toISOString();
      const a: IncidentAction = {
        id: sortableId('act'),
        incidentId: i.id,
        title: body.title,
        detail: body.detail ?? null,
        owner,
        due: body.due ?? null,
        status: 'open',
        kind: body.kind ?? 'mitigation',
        createdBy: p.memberId,
        createdAt: at,
        updatedAt: at,
        doneAt: null,
      };
      incidentActions.set(a.id, a);
      const label = a.kind === 'mitigation' ? 'Mitigation' : 'Follow-up';
      record(
        ctx,
        i,
        a,
        'incident.action_added',
        `Action added · ${label}: ${quoted(a.title)} → ${nameOf(a.owner)}${a.due ? ` · due ${a.due}` : ''}`,
        at,
      );
      notifyOwner(i, a, p.memberId);
      ctx.status = 201;
      return a;
    },
  );

  r.add(
    'PATCH',
    '/api/incidents/:id/actions/:actionId',
    {
      summary: 'Update, complete, reopen or reassign an action (Infrastructure ≥ contribute)',
      tag,
      responses: [401, 403, 404, 422],
    },
    authenticate,
    (ctx) => {
      const p = ctx.principal!;
      const i = visibleIncident(p, ctx.params.id);
      const a = actionOf(i, ctx.params.actionId);
      requireInfra(p, 'contribute');
      const patch = parse(patchBody, ctx.body);
      if (patch.owner !== undefined && patch.owner !== a.owner) assertOwner(i, patch.owner);

      const at = new Date().toISOString();
      const notes: string[] = [];
      const edited: string[] = [];
      let auditAction = 'incident.action_updated';
      if (patch.title !== undefined && patch.title !== a.title) {
        edited.push('title');
        a.title = patch.title;
      }
      if (patch.detail !== undefined && patch.detail !== a.detail) {
        edited.push('detail');
        a.detail = patch.detail;
      }
      if (patch.due !== undefined && patch.due !== a.due) {
        edited.push(patch.due ? `due ${patch.due}` : 'due date cleared');
        a.due = patch.due;
      }
      if (patch.kind !== undefined && patch.kind !== a.kind) {
        edited.push(patch.kind === 'mitigation' ? 'moved to mitigation' : 'moved to follow-ups');
        a.kind = patch.kind;
      }
      if (patch.status !== undefined && patch.status !== a.status) {
        const was = a.status;
        a.status = patch.status;
        if (patch.status === 'done') {
          a.doneAt = at;
          auditAction = 'incident.action_completed';
          notes.push(`Action completed: ${quoted(a.title)}`);
        } else {
          a.doneAt = null;
          if (was === 'done') {
            auditAction = 'incident.action_reopened';
            notes.push(`Action reopened: ${quoted(a.title)}`);
          } else notes.push(`Action started: ${quoted(a.title)}`);
        }
      }
      const reassigned = patch.owner !== undefined && patch.owner !== a.owner;
      if (reassigned) {
        a.owner = patch.owner!;
        notes.push(`Action reassigned: ${quoted(a.title)} → ${nameOf(a.owner)}`);
      }
      if (edited.length) notes.push(`Action updated: ${quoted(a.title)} (${edited.join(', ')})`);
      if (!notes.length) throw new HttpError(422, 'no_change', 'Nothing to update');

      a.updatedAt = at;
      incidentActions.save(a.id);
      record(ctx, i, a, auditAction, notes.join(' · '), at);
      if (reassigned) notifyOwner(i, a, p.memberId);
      return a;
    },
  );

  r.add(
    'DELETE',
    '/api/incidents/:id/actions/:actionId',
    {
      summary: 'Remove an action (Infrastructure ≥ manage)',
      tag,
      responses: [401, 403, 404],
    },
    authenticate,
    (ctx) => {
      const p = ctx.principal!;
      const i = visibleIncident(p, ctx.params.id);
      const a = actionOf(i, ctx.params.actionId);
      requireInfra(p, 'manage');
      incidentActions.delete(a.id);
      record(
        ctx,
        i,
        a,
        'incident.action_removed',
        `Action removed: ${quoted(a.title)}`,
        new Date().toISOString(),
      );
      ctx.status = 204;
      return undefined;
    },
  );
}
