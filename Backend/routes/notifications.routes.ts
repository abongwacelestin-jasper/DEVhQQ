/**
 * Notifications for the signed-in member: mentions, task assignments and
 * review requests, deployment approvals awaiting them, doc comments and
 * offboarding steps. Strictly per-member — there is no way to read someone
 * else's notifications, including for Owners.
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { audit } from '../audit/auditLog.ts';
import { HttpError } from '../types.ts';
import { notifications } from '../domain/collab/store.ts';
import { observeDomainEvents, publicNotification } from '../domain/collab/notify.ts';
import { emit } from '../domain/collab/realtime.ts';

const readBody = v.object({
  ids: v.optional(v.array(v.string({ min: 1, max: 80 }), { max: 200 })),
  all: v.optional(v.boolean()),
});

export function registerNotificationRoutes(r: Router) {
  observeDomainEvents();
  const tag = 'notifications';

  r.add(
    'GET',
    '/api/notifications',
    {
      summary: 'Your notifications, newest first (?unread=1&kind=&before=cursor&limit=)',
      tag,
      responses: [401, 422],
    },
    authenticate,
    (ctx) => {
      const me = ctx.principal!.memberId;
      const unreadOnly = ctx.query.get('unread') === '1';
      const kind = ctx.query.get('kind');
      const before = ctx.query.get('before');
      if (before && !/^ntf-[a-z0-9]+$/.test(before))
        throw new HttpError(422, 'validation_failed', 'before is invalid');
      const limit = Math.min(100, Math.max(1, Number(ctx.query.get('limit') ?? 50) || 50));
      const mine = [...notifications.values()].filter((n) => n.memberId === me);
      const list = mine
        .filter(
          (n) =>
            (!unreadOnly || !n.readAt) && (!kind || n.kind === kind) && (!before || n.id < before),
        )
        .sort((a, b) => (a.id < b.id ? 1 : -1));
      const page = list.slice(0, limit);
      return {
        items: page.map(publicNotification),
        unread: mine.filter((n) => !n.readAt).length,
        ...(list.length > page.length ? { nextCursor: page[page.length - 1].id } : {}),
      };
    },
  );

  r.add(
    'POST',
    '/api/notifications/read',
    { summary: 'Mark notifications read (`ids`, or `all: true`)', tag, responses: [401, 422] },
    authenticate,
    (ctx) => {
      const me = ctx.principal!.memberId;
      const body = parse(readBody, ctx.body);
      if (!body.all && !body.ids?.length)
        throw new HttpError(422, 'validation_failed', 'Pass ids or all: true');
      const ids = new Set(body.ids ?? []);
      const now = new Date().toISOString();
      let updated = 0;
      for (const n of notifications.values()) {
        if (n.memberId !== me || n.readAt || (!body.all && !ids.has(n.id))) continue;
        n.readAt = now;
        notifications.save(n.id);
        updated++;
      }
      const unread = [...notifications.values()].filter(
        (n) => n.memberId === me && !n.readAt,
      ).length;
      if (updated) {
        audit.append({
          actor: me,
          action: 'notification.read',
          target: `${updated} notification(s)`,
          requestId: ctx.requestId,
        });
        emit('notification.read', { memberId: me }, { ids: body.all ? 'all' : [...ids], unread });
      }
      return { updated, unread };
    },
  );
}
