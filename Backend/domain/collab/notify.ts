/**
 * Notifications: creation, mention parsing, and observers for domain events
 * owned by other modules (tasks, deployments) — observed through the bus so
 * those route files stay untouched.
 *
 * Notification bodies are short plain-text excerpts. They are delivered only
 * to the addressed member over GET /api/stream and never to the global bus.
 */

import { can } from '../../auth/rbac.ts';
import { audit } from '../../audit/auditLog.ts';
import { subscribe } from '../../lib/events.ts';
import { logger } from '../../lib/logger.ts';
import { config } from '../../config/env.ts';
import { db } from '../../store/db.ts';
import type { Member, Principal } from '../../types.ts';
import { sendMail } from '../../mail/index.ts';
import { digestEmail } from '../../mail/templates.ts';
import { seesProduct } from './access.ts';
import { emit } from './realtime.ts';
import { notifications, sortableId } from './store.ts';
import type { Notification, NotificationKind } from './types.ts';

export function excerpt(s: string, max = 200): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function publicNotification(n: Notification) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    refId: n.refId,
    actor: n.actor,
    at: n.at,
    read: !!n.readAt,
    readAt: n.readAt,
  };
}

export function notify(input: {
  memberId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  refId: string;
  actor: string;
}): Notification | undefined {
  const target = db.members.get(input.memberId);
  if (!target || target.status !== 'active' || input.memberId === input.actor) return undefined;
  // Collapse duplicates of the same unread event (e.g. an edit re-mentioning someone).
  for (const n of notifications.values())
    if (
      n.memberId === input.memberId &&
      n.refId === input.refId &&
      n.kind === input.kind &&
      !n.readAt
    )
      return n;
  const n: Notification = {
    ...input,
    id: sortableId('ntf'),
    title: excerpt(input.title, 140),
    body: excerpt(input.body),
    at: new Date().toISOString(),
  };
  notifications.set(n.id, n);
  emit('notification.created', { memberId: n.memberId }, publicNotification(n));
  return n;
}

/** `@m4`-style mentions of existing, active members. */
export function parseMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^\w@])@([A-Za-z0-9][\w-]{0,39})/g)) {
    const member = db.members.get(m[1]);
    if (member && member.status === 'active') out.add(member.id);
  }
  return [...out];
}

function viewerOf(m: Member) {
  return { memberId: m.id, role: m.role, products: m.products };
}

export function asPrincipal(m: Member): Principal {
  return { ...viewerOf(m), sessionId: '', verifiedAt: 0, elevations: [] };
}

function latestActor(taskKey: string, kind: string): string | undefined {
  let best: { at: string; actor: string } | undefined;
  for (const e of db.taskEvents.values())
    if (e.taskKey === taskKey && e.kind === kind && (!best || e.at >= best.at)) best = e;
  return best?.actor;
}

function onTask(data: Record<string, unknown>) {
  const key = typeof data.key === 'string' ? data.key : '';
  const change = typeof data.change === 'string' ? data.change.split(',') : [];
  const task = db.tasks.get(key);
  if (!task) return;
  const created = change.includes('created');
  if (created || change.includes('assignee')) {
    const actor = created ? task.createdBy : (latestActor(key, 'assignee') ?? 'system');
    notify({
      memberId: task.assignee,
      kind: 'assignment',
      title: `${key} assigned to you`,
      body: task.title,
      link: `/tasks/${encodeURIComponent(key)}`,
      refId: `task:${key}:assignee:${task.assignee}`,
      actor,
    });
  }
  if (change.includes('reviewer') && task.reviewer) {
    notify({
      memberId: task.reviewer,
      kind: 'assignment',
      title: `Review requested on ${key}`,
      body: task.title,
      link: `/tasks/${encodeURIComponent(key)}`,
      refId: `task:${key}:reviewer:${task.reviewer}`,
      actor: latestActor(key, 'reviewer') ?? 'system',
    });
  }
}

function onDeployment(data: Record<string, unknown>) {
  const id = typeof data.id === 'string' ? data.id : '';
  const d = db.deployments.get(id);
  if (!d) return;
  if (d.status === 'awaiting-approval') {
    for (const m of db.members.values()) {
      if (m.status !== 'active' || m.id === d.requestedBy) continue;
      if (!can(asPrincipal(m), 'Deployment', 'manage') || !seesProduct(viewerOf(m), d.product))
        continue;
      notify({
        memberId: m.id,
        kind: 'approval',
        title: `Approval needed: ${d.product} ${d.version} → ${d.env}`,
        body: `Requested by ${db.members.get(d.requestedBy)?.name ?? d.requestedBy}`,
        link: '/deployments',
        refId: `deployment:${d.id}`,
        actor: d.requestedBy,
      });
    }
    return;
  }
  // Decided elsewhere: approval requests are no longer actionable.
  const now = new Date().toISOString();
  for (const n of notifications.values())
    if (n.kind === 'approval' && n.refId === `deployment:${d.id}` && !n.readAt) {
      n.readAt = now;
      notifications.save(n.id);
    }
}

let observing = false;

/** Subscribes once per process to task and deployment events. */
export function observeDomainEvents() {
  if (observing) return;
  observing = true;
  subscribe((e) => {
    try {
      if (e.type === 'task') onTask(e.data);
      else if (e.type === 'deployment') onDeployment(e.data);
    } catch (err) {
      logger.error('notification observer failed', { type: e.type, err: String(err) });
    }
  });
  startDigest();
}

const notifyPref: Record<NotificationKind, string> = {
  mention: 'mentions',
  'doc-comment': 'mentions',
  assignment: 'assigned',
  approval: 'deploys',
  offboarding: 'assigned',
  security: 'assigned',
};

/**
 * Optional email digest (MAIL_DIGEST_MINUTES, unset = off): unread
 * notifications older than one interval, filtered by the member's profile
 * alert choices, batched into one email per member.
 */
export async function runDigest(minAgeMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - minAgeMs).toISOString();
  const byMember = new Map<string, Notification[]>();
  for (const n of notifications.values()) {
    if (n.readAt || n.emailedAt || n.at > cutoff) continue;
    const m = db.members.get(n.memberId);
    const prefs = m?.profile?.notify;
    if (!m || m.status !== 'active' || (prefs && !prefs.includes(notifyPref[n.kind]))) continue;
    byMember.set(n.memberId, [...(byMember.get(n.memberId) ?? []), n]);
  }
  let sent = 0;
  for (const [memberId, list] of byMember) {
    const m = db.members.get(memberId)!;
    const mail = digestEmail(
      m.profile?.displayName ?? m.name,
      list
        .slice(0, 20)
        .map((n) => ({ title: n.title, body: n.body, link: `${config.appOrigin}${n.link}` })),
    );
    if (await sendMail({ to: m.email, ...mail })) {
      const at = new Date().toISOString();
      for (const n of list) {
        n.emailedAt = at;
        notifications.save(n.id);
      }
      sent++;
      audit.append({
        actor: 'system',
        action: 'notification.digest_sent',
        target: `${memberId} · ${list.length}`,
      });
    }
  }
  return sent;
}

function startDigest() {
  const minutes = Number(process.env.MAIL_DIGEST_MINUTES ?? 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  const ms = minutes * 60_000;
  setInterval(
    () => void runDigest(ms).catch((e) => logger.error('digest failed', { err: String(e) })),
    ms,
  ).unref();
}
