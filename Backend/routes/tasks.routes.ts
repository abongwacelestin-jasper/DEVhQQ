/**
 * Task routes — the unit of work every project view is built from.
 *
 * Reads are scoped to the caller's products (out-of-scope keys return 404).
 * Writes need Project:contribute; deletes need Project:manage. Moving a task
 * to "done" is reserved for reviewers, leads and managers so nobody can close
 * their own work without a second pair of eyes.
 *
 * Every change also writes an immutable task event, so the activity feed and
 * the task timeline are derived from the same record instead of being kept in
 * sync by hand.
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { assertProduct, can, canSeeProduct, requireArea } from '../auth/rbac.ts';
import { audit } from '../audit/auditLog.ts';
import { publish } from '../lib/events.ts';
import { db, touch } from '../store/db.ts';
import { HttpError, type Principal, type Task, type TaskEventKind } from '../types.ts';

const statuses = ['backlog', 'in-progress', 'review', 'done'] as const;
const priorities = ['urgent', 'high', 'medium', 'low'] as const;
const types = ['feature', 'bug', 'design', 'task'] as const;
const date = () => v.string({ pattern: /^\d{4}-\d{2}-\d{2}$/ });

const createBody = v.object({
  projectId: v.string({ max: 40 }),
  title: v.string({ min: 3, max: 160 }),
  type: v.enumOf(types),
  status: v.optional(v.enumOf(statuses)),
  priority: v.enumOf(priorities),
  assignee: v.string({ max: 20 }),
  reviewer: v.optional(v.string({ max: 20 })),
  due: date(),
  estimate: v.int({ min: 1, max: 40 }),
  description: v.optional(v.string({ max: 5000 })),
});

const updateBody = v.object({
  title: v.optional(v.string({ min: 3, max: 160 })),
  status: v.optional(v.enumOf(statuses)),
  priority: v.optional(v.enumOf(priorities)),
  assignee: v.optional(v.string({ max: 20 })),
  reviewer: v.optional(v.string({ max: 20 })),
  due: v.optional(date()),
  estimate: v.optional(v.int({ min: 1, max: 40 })),
  description: v.optional(v.string({ max: 5000 })),
});

const commentBody = v.object({ text: v.string({ min: 1, max: 4000 }) });
const subtaskBody = v.object({ title: v.string({ min: 1, max: 160 }) });
const subtaskPatch = v.object({ done: v.boolean() });
const timeBody = v.object({
  minutes: v.int({ min: 1, max: 24 * 60 }),
  note: v.optional(v.string({ max: 500 })),
});

function prefixFor(product: Task['product']) {
  return product === 'renewberry' ? 'RB' : product === 'blog' ? 'BL' : 'MA';
}

function nextKey(product: Task['product']) {
  const prefix = prefixFor(product);
  const max = [...db.tasks.keys()]
    .filter((k) => k.startsWith(`${prefix}-`))
    .map((k) => Number(k.split('-')[1]))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}-${max + 1}`;
}

function assertAssignable(memberId: string, product: Task['product']) {
  const m = db.members.get(memberId);
  if (!m || m.status !== 'active' || !m.products.includes(product))
    throw new HttpError(
      422,
      'assignee_invalid',
      `${memberId} isn't an active member of this product`,
    );
}

let seq = 0;
const nextId = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 4)}`;

/** Records who changed what, so the timeline never has to be reconstructed. */
function record(
  task: Task,
  actor: string,
  kind: TaskEventKind,
  from?: string,
  to?: string,
  note?: string,
) {
  const event = {
    id: nextId('ev'),
    taskKey: task.key,
    actor,
    at: new Date().toISOString(),
    kind,
    from,
    to,
    note,
  };
  db.taskEvents.set(event.id, event);
  return event;
}

/** A task plus the derived fields every list view needs. */
function withDerived(t: Task) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...t,
    comments: [...db.taskComments.values()].filter((c) => c.taskKey === t.key).length,
    overdue: t.status !== 'done' && t.due < today,
  };
}

/** The task if the caller may see it; 404 (never 403) otherwise. */
function visibleTask(p: Principal, key: string) {
  const t = db.tasks.get(key.toUpperCase());
  if (!t || !canSeeProduct(p, t.product)) throw new HttpError(404, 'not_found', 'Not found');
  return t;
}

export function registerTaskRoutes(r: Router) {
  r.add(
    'GET',
    '/api/tasks',
    {
      summary:
        'List tasks (filter: product, projectId, status, priority, assignee, q, limit, offset)',
      tag: 'tasks',
    },
    authenticate,
    requireArea('Project', 'view'),
    (ctx) => {
      const p = ctx.principal!;
      const q = ctx.query;
      const needle = q.get('q')?.toLowerCase().slice(0, 100);
      const rows = [...db.tasks.values()].filter(
        (t) =>
          canSeeProduct(p, t.product) &&
          (!q.get('product') || t.product === q.get('product')) &&
          (!q.get('projectId') || t.projectId === q.get('projectId')) &&
          (!q.get('status') || q.get('status')!.split(',').includes(t.status)) &&
          (!q.get('priority') || q.get('priority')!.split(',').includes(t.priority)) &&
          (!q.get('assignee') ||
            t.assignee === (q.get('assignee') === 'me' ? p.memberId : q.get('assignee'))) &&
          (!needle || `${t.key} ${t.title} ${t.description ?? ''}`.toLowerCase().includes(needle)),
      );
      const limit = Math.min(200, Math.max(1, Number(q.get('limit') ?? 50)));
      const offset = Math.max(0, Number(q.get('offset') ?? 0));
      ctx.res.setHeader('X-Total-Count', String(rows.length));
      return {
        total: rows.length,
        limit,
        offset,
        items: rows
          .sort((a, b) => a.due.localeCompare(b.due))
          .slice(offset, offset + limit)
          .map(withDerived),
      };
    },
  );

  /**
   * Activity for every task the caller can see, in one round trip: the work
   * views need events, comments, subtasks and time logs together, and issuing
   * four calls per task would be a request storm.
   */
  r.add(
    'GET',
    '/api/tasks/_activity',
    { summary: 'Events, comments, subtasks and time logs for visible tasks', tag: 'tasks' },
    authenticate,
    requireArea('Project', 'view'),
    (ctx) => {
      const p = ctx.principal!;
      const visible = new Set(
        [...db.tasks.values()].filter((t) => canSeeProduct(p, t.product)).map((t) => t.key),
      );
      const byTask = <T extends { taskKey: string; at: string }>(rows: T[]) =>
        rows.filter((x) => visible.has(x.taskKey)).sort((a, b) => a.at.localeCompare(b.at));
      return {
        events: byTask([...db.taskEvents.values()]),
        comments: byTask([...db.taskComments.values()]),
        subtasks: [...db.subtasks.values()].filter((s) => visible.has(s.taskKey)),
        timeLogs: byTask([...db.timeLogs.values()]),
      };
    },
  );

  r.add(
    'GET',
    '/api/tasks/:key',
    { summary: 'One task', tag: 'tasks', responses: [401, 404] },
    authenticate,
    (ctx) => withDerived(visibleTask(ctx.principal!, ctx.params.key)),
  );

  r.add(
    'POST',
    '/api/tasks',
    { summary: 'Create a task', tag: 'tasks', responses: [401, 403, 404, 422] },
    authenticate,
    requireArea('Project', 'contribute'),
    (ctx) => {
      const body = parse(createBody, ctx.body);
      const project = db.projects.get(body.projectId);
      if (!project) throw new HttpError(404, 'not_found', 'Project not found');
      assertProduct(ctx.principal!, project.product);
      assertAssignable(body.assignee, project.product);
      if (body.reviewer) assertAssignable(body.reviewer, project.product);
      const now = new Date().toISOString();
      const task: Task = {
        key: nextKey(project.product),
        product: project.product,
        createdBy: ctx.principal!.memberId,
        createdAt: now,
        updatedAt: now,
        ...body,
        status: body.status ?? 'backlog',
      };
      db.tasks.set(task.key, task);
      record(task, ctx.principal!.memberId, 'created');
      if (body.reviewer) record(task, ctx.principal!.memberId, 'reviewer', undefined, body.reviewer);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'task.created',
        target: `${task.key} · ${task.title}`,
        requestId: ctx.requestId,
      });
      publish('task', { key: task.key, change: 'created' });
      ctx.status = 201;
      ctx.res.setHeader('Location', `/api/tasks/${task.key}`);
      return withDerived(task);
    },
  );

  r.add(
    'PATCH',
    '/api/tasks/:key',
    {
      summary: 'Update a task (status, assignee, priority…)',
      tag: 'tasks',
      responses: [401, 403, 404, 422],
    },
    authenticate,
    requireArea('Project', 'contribute'),
    (ctx) => {
      const patch = parse(updateBody, ctx.body);
      const p = ctx.principal!;
      const t = visibleTask(p, ctx.params.key);
      if (patch.status === 'done' && t.assignee === p.memberId && !can(p, 'Project', 'manage')) {
        throw new HttpError(
          403,
          'self_close',
          'A reviewer or manager must move your own task to done',
        );
      }
      if (patch.assignee) assertAssignable(patch.assignee, t.product);
      if (patch.reviewer) assertAssignable(patch.reviewer, t.product);
      const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter(
        (k) => patch[k] !== undefined && patch[k] !== t[k],
      );
      for (const field of changed) {
        const from = t[field];
        const to = patch[field];
        record(
          t,
          p.memberId,
          field as TaskEventKind,
          from === undefined ? undefined : String(from),
          to === undefined ? undefined : String(to),
        );
      }
      Object.assign(
        t,
        Object.fromEntries(changed.map((k) => [k, patch[k]])),
      );
      touch(t);
      db.tasks.save(t.key);
      audit.append({
        actor: p.memberId,
        action: 'task.updated',
        target: `${t.key}: ${changed.join(', ') || 'no change'}`,
        requestId: ctx.requestId,
      });
      publish('task', { key: t.key, change: changed.join(',') });
      return withDerived(t);
    },
  );

  r.add(
    'DELETE',
    '/api/tasks/:key',
    { summary: 'Delete a task', tag: 'tasks', responses: [401, 403, 404] },
    authenticate,
    requireArea('Project', 'manage'),
    (ctx) => {
      const t = visibleTask(ctx.principal!, ctx.params.key);
      db.tasks.delete(t.key);
      for (const [id, e] of db.taskEvents) if (e.taskKey === t.key) db.taskEvents.delete(id);
      for (const [id, c] of db.taskComments) if (c.taskKey === t.key) db.taskComments.delete(id);
      for (const [id, s] of db.subtasks) if (s.taskKey === t.key) db.subtasks.delete(id);
      for (const [id, l] of db.timeLogs) if (l.taskKey === t.key) db.timeLogs.delete(id);
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'task.deleted',
        target: `${t.key} · ${t.title}`,
        sensitive: true,
        requestId: ctx.requestId,
      });
    },
  );

  r.add(
    'POST',
    '/api/tasks/:key/comments',
    { summary: 'Comment on a task', tag: 'tasks', responses: [401, 403, 404, 422] },
    authenticate,
    requireArea('Project', 'contribute'),
    (ctx) => {
      const body = parse(commentBody, ctx.body);
      const t = visibleTask(ctx.principal!, ctx.params.key);
      const comment = {
        id: nextId('tc'),
        taskKey: t.key,
        author: ctx.principal!.memberId,
        text: body.text,
        at: new Date().toISOString(),
      };
      db.taskComments.set(comment.id, comment);
      record(
        t,
        ctx.principal!.memberId,
        'comment',
        undefined,
        undefined,
        body.text.length > 80 ? `${body.text.slice(0, 80)}…` : body.text,
      );
      publish('task', { key: t.key, change: 'comment' });
      ctx.status = 201;
      return comment;
    },
  );

  r.add(
    'POST',
    '/api/tasks/:key/subtasks',
    { summary: 'Add a subtask', tag: 'tasks', responses: [401, 403, 404, 422] },
    authenticate,
    requireArea('Project', 'contribute'),
    (ctx) => {
      const body = parse(subtaskBody, ctx.body);
      const t = visibleTask(ctx.principal!, ctx.params.key);
      const subtask = { id: nextId('st'), taskKey: t.key, title: body.title, done: false };
      db.subtasks.set(subtask.id, subtask);
      record(t, ctx.principal!.memberId, 'subtask', undefined, 'added', body.title);
      ctx.status = 201;
      return subtask;
    },
  );

  r.add(
    'PATCH',
    '/api/tasks/:key/subtasks/:subtaskId',
    { summary: 'Complete or reopen a subtask', tag: 'tasks', responses: [401, 403, 404, 422] },
    authenticate,
    requireArea('Project', 'contribute'),
    (ctx) => {
      const body = parse(subtaskPatch, ctx.body);
      const t = visibleTask(ctx.principal!, ctx.params.key);
      const s = db.subtasks.get(ctx.params.subtaskId);
      if (!s || s.taskKey !== t.key) throw new HttpError(404, 'not_found', 'Subtask not found');
      s.done = body.done;
      s.doneBy = body.done ? ctx.principal!.memberId : undefined;
      s.doneAt = body.done ? new Date().toISOString() : undefined;
      db.subtasks.save(s.id);
      record(
        t,
        ctx.principal!.memberId,
        'subtask',
        undefined,
        body.done ? 'completed' : 'reopened',
        s.title,
      );
      return s;
    },
  );

  r.add(
    'POST',
    '/api/tasks/:key/time',
    { summary: 'Log time against a task', tag: 'tasks', responses: [401, 403, 404, 422] },
    authenticate,
    requireArea('Project', 'contribute'),
    (ctx) => {
      const body = parse(timeBody, ctx.body);
      const t = visibleTask(ctx.principal!, ctx.params.key);
      const log = {
        id: nextId('tl'),
        taskKey: t.key,
        member: ctx.principal!.memberId,
        minutes: body.minutes,
        at: new Date().toISOString(),
        note: body.note,
      };
      db.timeLogs.set(log.id, log);
      record(t, ctx.principal!.memberId, 'time', undefined, String(body.minutes), body.note);
      ctx.status = 201;
      return log;
    },
  );
}
