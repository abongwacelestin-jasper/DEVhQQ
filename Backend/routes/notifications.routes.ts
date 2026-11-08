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
import { repos } from '../data/index.ts';
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
    async (ctx) => {
      const me = ctx.principal!.memberId;
      const unreadOnly = ctx.query.get('unread') === '1';
      const kind = ctx.query.get('kind');
      const before = ctx.query.get('before');
      if (before && !/^ntf-[a-z0-9]+$/.test(before))
        throw new HttpError(422, 'validation_failed', 'before is invalid');
      const limit = Math.min(100, Math.max(1, Number(ctx.query.get('limit') ?? 50) || 50));
      const page = await repos.notifications.inbox(me, {
        unreadOnly,
        kind: kind || undefined,
        before: before || undefined,
        limit,
      });
      return {
        items: page.items.map(publicNotification),
        unread: await repos.notifications.countUnread(me),
        ...(page.hasMore ? { nextCursor: page.items[page.items.length - 1].id } : {}),
      };
    },
  );

  r.add(
    'POST',
    '/api/notifications/read',
    { summary: 'Mark notifications read (`ids`, or `all: true`)', tag, responses: [401, 422] },
    authenticate,
    async (ctx) => {
      const me = ctx.principal!.memberId;
      const body = parse(readBody, ctx.body);
      if (!body.all && !body.ids?.length)
        throw new HttpError(422, 'validation_failed', 'Pass ids or all: true');
      const ids = new Set(body.ids ?? []);
      const now = new Date().toISOString();
      const updated = await repos.notifications.markRead(me, body.all ? 'all' : [...ids], now);
      const unread = await repos.notifications.countUnread(me);
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
