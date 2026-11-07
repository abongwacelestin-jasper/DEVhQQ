/**
 * Offboarding (resignations), matching Frontend/src/contexts/OffboardingContext.tsx.
 *
 *   POST  /api/offboarding/:memberId  start (a member may resign themselves;
 *                                     anyone else needs Administration:manage)
 *   PATCH /api/offboarding/:memberId  checklist step, accept, withdraw, complete
 *
 * Every write requires a fresh step-up. Completion deactivates the member and
 * revokes their sessions and JIT grants, then emits `member.deactivated` on the
 * bus so the token module (SEC lane, PATs) revokes personal access tokens.
 */

import type { Ctx, Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { can, requireStepUp } from '../auth/rbac.ts';
import { revokeAllFor } from '../auth/sessions.ts';
import { listGrants, revokeGrant } from '../auth/jit.ts';
import { publish } from '../lib/events.ts';
import { audit } from '../audit/auditLog.ts';
import { db } from '../store/db.ts';
import { HttpError, type Member, type Principal } from '../types.ts';
import { sendMail } from '../mail/index.ts';
import { offboardingCompletedEmail } from '../mail/templates.ts';
import { resignations, saveMember, sortableId } from '../domain/collab/store.ts';
import { notify } from '../domain/collab/notify.ts';
import type { Resignation } from '../domain/collab/types.ts';

const memberIdCheck = () => v.string({ min: 1, max: 40, pattern: /^[A-Za-z0-9_-]+$/ });
const date = () => v.string({ pattern: /^\d{4}-\d{2}-\d{2}$/ });

const startBody = v.object({
  lastDay: date(),
  reason: v.string({ min: 2, max: 200 }),
  note: v.optional(v.string({ max: 1_000 })),
  handoverTo: memberIdCheck(),
});

const patchBody = v.object({
  step: v.optional(v.object({ id: v.string({ min: 1, max: 40 }), done: v.boolean() })),
  status: v.optional(v.enumOf(['accepted', 'withdrawn', 'completed'] as const)),
  lastDay: v.optional(date()),
  handoverTo: v.optional(memberIdCheck()),
});

const baseChecklist = (): Resignation['checklist'] => [
  { id: 'tasks', label: 'Open tasks reassigned', done: false },
  { id: 'docs', label: 'Handover doc written', done: false },
  { id: 'tokens', label: 'Personal API tokens revoked', done: false },
  { id: 'devices', label: 'Trusted devices removed', done: false },
  { id: 'access', label: 'Repository & production access removed', done: false },
  { id: 'nda', label: 'NDA exit confirmation signed', done: false },
];

function isAdmin(p: Principal) {
  return can(p, 'Administration', 'manage');
}

function current(memberId: string): Resignation | undefined {
  let best: Resignation | undefined;
  for (const r of resignations.values())
    if (r.memberId === memberId && (!best || r.submittedAt > best.submittedAt)) best = r;
  return best;
}

function active(id: string, field: string): Member {
  const m = db.members.get(id);
  if (!m || m.status !== 'active')
    throw new HttpError(422, 'validation_failed', `${field}: ${id} is not an active member`);
  return m;
}

function sync(m: Member, r: Resignation) {
  m.offboarding = {
    id: r.id,
    status: r.status,
    startedAt: r.submittedAt,
    ...(r.status === 'completed' && r.decidedAt ? { completedAt: r.decidedAt } : {}),
  };
  saveMember(m.id);
  resignations.save(r.id);
}

function log(ctx: Ctx, action: string, target: string) {
  audit.append({
    actor: ctx.principal!.memberId,
    action,
    target,
    sensitive: true,
    requestId: ctx.requestId,
  });
}

function complete(ctx: Ctx, m: Member, r: Resignation) {
  const by = ctx.principal!.memberId;
  if (m.id === by)
    throw new HttpError(403, 'self_offboard', 'Another admin must complete your offboarding');
  if (
    m.role === 'Owner' &&
    [...db.members.values()].filter((x) => x.role === 'Owner' && x.status === 'active').length === 1
  )
    throw new HttpError(409, 'last_owner', 'The workspace needs at least one Owner');
  const now = new Date().toISOString();
  r.checklist = r.checklist.map((c) =>
    c.done ? c : { ...c, done: true, doneBy: by, doneAt: now },
  );
  r.status = 'completed';
  r.decidedBy = by;
  r.decidedAt = now;
  m.status = 'deactivated';
  const sessions = revokeAllFor(m.id);
  let grants = 0;
  for (const g of listGrants())
    if (g.memberId === m.id && (g.status === 'active' || g.status === 'pending')) {
      revokeGrant(g.id, by);
      grants++;
    }
  // Personal access tokens belong to the SEC lane's module, which listens for this event.
  publish('member.deactivated', { memberId: m.id, reason: 'offboarding' });
  r.revoked = { sessions, grants, tokens: 'event-emitted' };
  sync(m, r);
  log(
    ctx,
    'offboarding.completed',
    `${m.name} (${m.id}) deactivated · ${sessions} session(s), ${grants} grant(s) revoked`,
  );
  void sendMail({ to: m.email, ...offboardingCompletedEmail(m.name) });
}

export function registerOffboardingRoutes(r: Router) {
  const tag = 'offboarding';

  r.add(
    'GET',
    '/api/offboarding',
    { summary: 'Offboardings: all for Administration:view, otherwise only your own', tag },
    authenticate,
    (ctx) => {
      const p = ctx.principal!;
      const all = can(p, 'Administration', 'view');
      return {
        items: [...resignations.values()]
          .filter((r) => all || r.memberId === p.memberId)
          .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
      };
    },
  );

  r.add(
    'GET',
    '/api/offboarding/:memberId',
    {
      summary: 'A member’s current offboarding (self or Administration:view)',
      tag,
      responses: [401, 404],
    },
    authenticate,
    (ctx) => {
      const p = ctx.principal!;
      if (p.memberId !== ctx.params.memberId && !can(p, 'Administration', 'view'))
        throw new HttpError(404, 'not_found', 'Not found');
      const res = current(ctx.params.memberId);
      if (!res) throw new HttpError(404, 'not_found', 'Not found');
      return res;
    },
  );

  r.add(
    'POST',
    '/api/offboarding/:memberId',
    {
      summary: 'Start offboarding (self-resignation, or Administration:manage) — step-up',
      tag,
      responses: [401, 403, 404, 409, 422],
    },
    authenticate,
    requireStepUp(),
    (ctx) => {
      const p = ctx.principal!;
      const self = p.memberId === ctx.params.memberId;
      if (!self && !isAdmin(p))
        throw new HttpError(403, 'forbidden', 'Requires manage on Administration');
      const target = db.members.get(ctx.params.memberId);
      if (!target || target.status !== 'active') throw new HttpError(404, 'not_found', 'Not found');
      const body = parse(startBody, ctx.body);
      const heir = active(body.handoverTo, 'handoverTo');
      if (heir.id === target.id)
        throw new HttpError(422, 'validation_failed', 'handoverTo must be someone else');
      const open = current(target.id);
      if (open && (open.status === 'pending' || open.status === 'accepted'))
        throw new HttpError(409, 'already_started', 'Offboarding is already in progress');

      const res: Resignation = {
        id: sortableId('rs'),
        memberId: target.id,
        lastDay: body.lastDay,
        reason: body.reason,
        ...(body.note ? { note: body.note } : {}),
        handoverTo: heir.id,
        submittedAt: new Date().toISOString(),
        startedBy: p.memberId,
        status: 'pending',
        checklist: baseChecklist(),
      };
      resignations.set(res.id, res);
      sync(target, res);
      log(
        ctx,
        'offboarding.started',
        `${target.name} (${target.id}) · last day ${res.lastDay} · handover ${heir.id}`,
      );
      notify({
        memberId: heir.id,
        kind: 'offboarding',
        title: `${target.name} is handing work over to you`,
        body: `Last day ${res.lastDay}. ${res.reason}`,
        link: `/team/${encodeURIComponent(target.id)}`,
        refId: `offboarding:${res.id}`,
        actor: p.memberId,
      });
      ctx.status = 201;
      return res;
    },
  );

  r.add(
    'PATCH',
    '/api/offboarding/:memberId',
    {
      summary: 'Update the offboarding checklist or status (Administration:manage) — step-up',
      tag,
      responses: [401, 403, 404, 409, 422],
    },
    authenticate,
    requireStepUp(),
    (ctx) => {
      const p = ctx.principal!;
      const body = parse(patchBody, ctx.body);
      const self = p.memberId === ctx.params.memberId;
      const admin = isAdmin(p);
      const selfWithdraw =
        self && body.status === 'withdrawn' && !body.step && !body.lastDay && !body.handoverTo;
      if (!admin && !selfWithdraw) {
        if (!self) throw new HttpError(403, 'forbidden', 'Requires manage on Administration');
        throw new HttpError(403, 'forbidden', 'You can only withdraw your own resignation');
      }
      const target = db.members.get(ctx.params.memberId);
      const res = current(ctx.params.memberId);
      if (!target || !res) throw new HttpError(404, 'not_found', 'Not found');
      if (res.status === 'completed' || res.status === 'withdrawn')
        throw new HttpError(409, 'closed', `Offboarding is ${res.status}`);

      if (body.lastDay) res.lastDay = body.lastDay;
      if (body.handoverTo) {
        const heir = active(body.handoverTo, 'handoverTo');
        if (heir.id === target.id)
          throw new HttpError(422, 'validation_failed', 'handoverTo must be someone else');
        res.handoverTo = heir.id;
      }
      if (body.step) {
        const step = res.checklist.find((c) => c.id === body.step!.id);
        if (!step) throw new HttpError(404, 'not_found', 'Unknown checklist step');
        step.done = body.step.done;
        if (step.done) {
          step.doneBy = p.memberId;
          step.doneAt = new Date().toISOString();
        } else {
          delete step.doneBy;
          delete step.doneAt;
        }
      }
      if (body.status === 'completed') {
        complete(ctx, target, res);
        return res;
      }
      if (body.status) {
        if (body.status === 'withdrawn' && selfWithdraw && res.status !== 'pending')
          throw new HttpError(
            409,
            'not_pending',
            'Ask an admin to withdraw an accepted resignation',
          );
        res.status = body.status;
        res.decidedBy = p.memberId;
        res.decidedAt = new Date().toISOString();
      }
      sync(target, res);
      log(
        ctx,
        body.status ? `offboarding.${body.status}` : 'offboarding.updated',
        `${target.name} (${target.id})${body.step ? ` · ${body.step.id}=${body.step.done}` : ''}`,
      );
      return res;
    },
  );
}
