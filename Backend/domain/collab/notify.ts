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
import { jobEnabled } from '../../lib/jobs.ts';
import { scheduleEvery } from '../../lib/scheduler.ts';
import { config } from '../../config/env.ts';
import { db } from '../../store/db.ts';
import { repos } from '../../data/index.ts';
import type { Member, Principal } from '../../types.ts';
import { sendMail } from '../../mail/index.ts';
import { digestEmail } from '../../mail/templates.ts';
import { appLink } from '../../mail/layout.ts';
import { emailForNotification, observeMailEvents } from '../../mail/events.ts';
import { seesProduct } from './access.ts';
import { emit } from './realtime.ts';
import { sortableId } from './store.ts';
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

export async function notify(input: {
  memberId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string;
  refId: string;
  actor: string;
}): Promise<Notification | undefined> {
  if (input.memberId === input.actor) return undefined;
  const target = await repos.members.get(input.memberId);
  if (!target || target.status !== 'active') return undefined;
  // Collapse duplicates of the same unread event (e.g. an edit re-mentioning someone).
  const dup = await repos.notifications.findUnread(input.memberId, input.kind, input.refId);
  if (dup) return dup;
  const n: Notification = {
    ...input,
    id: sortableId('ntf'),
    title: excerpt(input.title, 140),
    body: excerpt(input.body),
    at: new Date().toISOString(),
  };
  await repos.notifications.insert(n);
  emit('notification.created', { memberId: n.memberId }, publicNotification(n));
  void emailForNotification(n);
  return n;
}

/** `@m4`-style mentions of existing, active members. */
export async function parseMentions(text: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^\w@])@([A-Za-z0-9][\w-]{0,39})/g)) ids.add(m[1]);
  if (!ids.size) return [];
  const found = await repos.members.getMany(ids);
  return [...ids].filter((id) => found.get(id)?.status === 'active');
}

function viewerOf(m: Member) {
  return { memberId: m.id, role: m.role, products: m.products };
}

export function asPrincipal(m: Member): Principal {
  return { ...viewerOf(m), sessionId: '', verifiedAt: 0, elevations: [] };
}

async function onTask(data: Record<string, unknown>) {
  const key = typeof data.key === 'string' ? data.key : '';
  const change = typeof data.change === 'string' ? data.change.split(',') : [];
  if (!key) return;
  const created = change.includes('created');
  const assigned = created || change.includes('assignee');
  const reviewing = change.includes('reviewer');
  if (!assigned && !reviewing) return;
  const task = await repos.tasks.get(key);
  if (!task) return;
  if (assigned) {
    const actor = created
      ? task.createdBy
      : ((await repos.taskEvents.latestActor(key, 'assignee')) ?? 'system');
    await notify({
      memberId: task.assignee,
      kind: 'assignment',
      title: `${key} assigned to you`,
      body: task.title,
      link: `/tasks/${encodeURIComponent(key)}`,
      refId: `task:${key}:assignee:${task.assignee}`,
      actor,
    });
  }
  if (reviewing && task.reviewer) {
    await notify({
      memberId: task.reviewer,
      kind: 'assignment',
      title: `Review requested on ${key}`,
      body: task.title,
      link: `/tasks/${encodeURIComponent(key)}`,
      refId: `task:${key}:reviewer:${task.reviewer}`,
      actor: (await repos.taskEvents.latestActor(key, 'reviewer')) ?? 'system',
    });
  }
}

async function onDeployment(data: Record<string, unknown>) {
  const id = typeof data.id === 'string' ? data.id : '';
  const d = db.deployments.get(id);
  if (!d) return;
  if (d.status === 'awaiting-approval') {
    const members = await repos.members.list();
    const requester = members.find((m) => m.id === d.requestedBy);
    for (const m of members) {
      if (m.status !== 'active' || m.id === d.requestedBy) continue;
      if (!can(asPrincipal(m), 'Deployment', 'manage') || !seesProduct(viewerOf(m), d.product))
        continue;
      await notify({
        memberId: m.id,
        kind: 'approval',
        title: `Approval needed: ${d.product} ${d.version} → ${d.env}`,
        body: `Requested by ${requester?.name ?? d.requestedBy}`,
        link: '/deployments',
        refId: `deployment:${d.id}`,
        actor: d.requestedBy,
      });
    }
    return;
  }
  // Decided elsewhere: approval requests are no longer actionable.
  await repos.notifications.markRefRead('approval', `deployment:${d.id}`, new Date().toISOString());
}

/** Domain observers still running (tests and graceful shutdown can await them). */
const inFlight = new Set<Promise<void>>();

/** Resolves once every domain-event observer started so far has finished. */
export async function settleObservers(): Promise<void> {
  while (inFlight.size) await Promise.allSettled([...inFlight]);
}

let observing = false;

/** Subscribes once per process to task and deployment events. */
export function observeDomainEvents() {
  if (observing) return;
  observing = true;
  subscribe((e) => {
    const run =
      e.type === 'task' ? onTask(e.data) : e.type === 'deployment' ? onDeployment(e.data) : null;
    if (!run) return;
    const p = run.catch((err: unknown) =>
      logger.error('notification observer failed', { type: e.type, err: String(err) }),
    );
    inFlight.add(p);
    void p.finally(() => inFlight.delete(p));
  });
  observeMailEvents();
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

const DAY_MS = 24 * 60 * 60_000;

/**
 * Optional email digest (MAIL_DIGEST_MINUTES, unset = off; 1440 = daily
 * summary, 10080 = weekly): unread
 * notifications older than one interval, filtered by the member's profile
 * alert choices, batched into one email per member.
 */
export async function runDigest(minAgeMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - minAgeMs).toISOString();
  const byMember = new Map<string, Notification[]>();
  const pending = await repos.notifications.pendingDigest(cutoff);
  const members = await repos.members.getMany(pending.map((n) => n.memberId));
  for (const n of pending) {
    const m = members.get(n.memberId);
    const prefs = m?.profile?.notify;
    if (!m || m.status !== 'active' || (prefs && !prefs.includes(notifyPref[n.kind]))) continue;
    byMember.set(n.memberId, [...(byMember.get(n.memberId) ?? []), n]);
  }
  let sent = 0;
  for (const [memberId, list] of byMember) {
    const m = members.get(memberId)!;
    const mail = digestEmail(
      m.profile?.displayName ?? m.name,
      list.slice(0, 20).map((n) => ({
        title: n.title,
        body: n.body,
        link: appLink(config.mail.brand, n.link),
        at: n.at,
      })),
      {
        period: minAgeMs >= 7 * DAY_MS ? 'weekly' : minAgeMs >= DAY_MS ? 'daily' : undefined,
        timeZone: m.profile?.timezone,
      },
    );
    if (await sendMail({ to: m.email, ...mail })) {
      await repos.notifications.markEmailed(
        list.map((n) => n.id),
        new Date().toISOString(),
      );
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
  if (!jobEnabled('digest')) return;
  const minutes = Number(process.env.MAIL_DIGEST_MINUTES ?? 0);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  const ms = minutes * 60_000;
  // One digest per interval across replicas (lib/scheduler.ts lease).
  scheduleEvery('digest', ms, () => runDigest(ms));
}
