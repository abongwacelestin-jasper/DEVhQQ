/**
 * Event → email wiring. Routes call one small function at the place an event
 * already happens (next to its `audit.append`); this module looks up what
 * the template needs, applies the recipient's notification preferences and
 * sends. Keeping the logic here keeps the route edits to one line each.
 *
 * Rules:
 *  - Security notices (sign-in alert, password, two-step verification,
 *    backup codes, lock-out) are always sent: preferences do not apply.
 *  - Work notifications respect `member.profile.notify` when the member has
 *    chosen alerts: `assigned`, `review`, `deploys`, `incidents`. A member
 *    with no profile yet gets everything.
 *  - Every function is fire-and-forget safe: it never throws and resolves to
 *    whether an email was handed to the transport. Rendering and the
 *    hand-off happen synchronously, so the response timing of a route never
 *    depends on delivery.
 *  - An email sent for a notification marks it `emailedAt`, so the digest
 *    does not send it a second time.
 */

import type { IncomingHttpHeaders } from 'node:http';
import { config } from '../config/env.ts';
import { lookupIp } from '../lib/geo.ts';
import { logger } from '../lib/logger.ts';
import { subscribe } from '../lib/events.ts';
import { db } from '../store/db.ts';
import { notifications, resignations } from '../domain/collab/store.ts';
import type { Notification } from '../domain/collab/types.ts';
import type { GeoLocation, Member, SignInRecord } from '../types.ts';
import { sendMail } from './index.ts';
import { appLink } from './layout.ts';
import {
  accessRequestEmail,
  accountLockedEmail,
  backupCodeUsedEmail,
  backupCodesGeneratedEmail,
  deploymentApprovalEmail,
  factorChangedEmail,
  incidentEmail,
  inviteEmail,
  offboardingStartedEmail,
  passwordChangedEmail,
  recoveryEmail,
  signInAlertEmail,
  taskAssignedEmail,
  type SecurityContext,
} from './templates.ts';
import type { RenderedEmail } from './layout.ts';

/** The parts of a request context these functions read (a route `Ctx` fits). */
export interface RequestInfo {
  ip: string;
  req?: { headers: IncomingHttpHeaders };
}

/** Alert choices from the onboarding profile (routes/onboarding.routes.ts). */
export type NotifyPref = 'assigned' | 'review' | 'mentions' | 'deploys' | 'incidents';

export function wants(member: Member, pref: NotifyPref): boolean {
  const prefs = member.profile?.notify;
  return !prefs || prefs.includes(pref);
}

const displayName = (m: Member) => m.profile?.displayName || m.name;
const nameOf = (id: string) => {
  const m = db.members.get(id);
  return m ? displayName(m) : id === 'system' ? 'Automated monitoring' : id;
};
const productName = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);

/** "Chrome on macOS", "Safari on iPhone", … from a User-Agent header; undefined when unknown. */
export function describeDevice(ua: string | undefined): string | undefined {
  if (!ua) return undefined;
  const browser = /Edg(?:e|A|iOS)?\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\/|FxiOS\//.test(ua)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : undefined;
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'macOS'
            : /CrOS/.test(ua)
              ? 'ChromeOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : undefined;
  if (browser && os) return `${browser} on ${os}`;
  if (browser || os) return browser ?? os;
  // Non-browser clients (CLI, scripts): first product token, bounded.
  const token = /^[A-Za-z][\w.-]{0,40}/.exec(ua)?.[0];
  return token ? `${token} (non-browser client)` : undefined;
}

export function locationLabel(loc: GeoLocation): string | undefined {
  if (loc.network === 'loopback') return 'Local network';
  if (loc.countryCode === 'XX') return undefined;
  return loc.city && loc.city !== loc.country ? `${loc.city}, ${loc.country}` : loc.country;
}

function securityContext(
  member: Member,
  ctx: RequestInfo,
  at = new Date().toISOString(),
): SecurityContext {
  return {
    at,
    ip: ctx.ip,
    location: locationLabel(lookupIp(ctx.ip)),
    device: describeDevice(String(ctx.req?.headers['user-agent'] ?? '') || undefined),
    timeZone: member.profile?.timezone,
  };
}

async function deliver(to: string, mail: RenderedEmail, idempotencyKey?: string): Promise<boolean> {
  try {
    return await sendMail({ to, ...mail, ...(idempotencyKey ? { idempotencyKey } : {}) });
  } catch (err) {
    // sendMail does not throw; this guards template or lookup bugs.
    logger.error('mail: could not prepare email', { category: mail.category, err: String(err) });
    return false;
  }
}

function guard<A extends unknown[]>(
  name: string,
  fn: (...args: A) => Promise<boolean>,
): (...args: A) => Promise<boolean> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (err) {
      logger.error('mail: event handler failed', { event: name, err: String(err) });
      return false;
    }
  };
}

// ─── security notices (always sent) ──────────────────────────────────────

/**
 * True when a successful sign-in comes from an IP or a device this member
 * has not signed in from before. A member with no earlier successful
 * sign-in (first sign-in after accepting an invite) has nothing to compare
 * with and gets no alert.
 */
export function isUnfamiliarSignIn(rec: SignInRecord, prior: SignInRecord[]): boolean {
  const ok = prior.filter(
    (s) => s.memberId === rec.memberId && s.result === 'success' && s.id !== rec.id,
  );
  if (!ok.length) return false;
  if (!ok.some((s) => s.ip === rec.ip)) return true;
  const devices = new Set(ok.map((s) => s.device).filter(Boolean));
  return !!rec.device && devices.size > 0 && !devices.has(rec.device);
}

const METHOD_LABEL: Record<SignInRecord['method'], string> = {
  password: 'Password and two-step verification',
  passkey: 'Passkey',
  demo: 'Demo sign-in',
};

/** Call after a successful sign-in is recorded; `prior` is the member's history before it. */
export const sendSignInAlert = guard(
  'sign-in-alert',
  async (member: Member, rec: SignInRecord, prior: SignInRecord[]) => {
    if (rec.method === 'demo' || !isUnfamiliarSignIn(rec, prior)) return false;
    const mail = signInAlertEmail({
      name: displayName(member),
      at: rec.at,
      ip: rec.ip,
      location: locationLabel(rec.location),
      device: rec.device,
      method: METHOD_LABEL[rec.method],
      timeZone: member.profile?.timezone,
    });
    return deliver(member.email, mail, `sign-in-alert/${rec.id}`);
  },
);

export const sendAccountLocked = guard(
  'account-locked',
  async (member: Member, ctx: RequestInfo, attempts: number, lockedUntil: number) => {
    const sc = securityContext(member, ctx);
    const mail = accountLockedEmail({
      ...sc,
      name: displayName(member),
      attempts,
      until: new Date(lockedUntil).toISOString(),
    });
    return deliver(member.email, mail, `account-locked/${member.id}/${lockedUntil}`);
  },
);

export const sendFactorChanged = guard(
  'mfa-enrolled',
  async (
    member: Member,
    ctx: RequestInfo,
    change: { factor: 'authenticator app' | 'passkey'; replaced: boolean; label?: string },
  ) => {
    const mail = factorChangedEmail({
      ...securityContext(member, ctx),
      name: displayName(member),
      ...change,
    });
    return deliver(member.email, mail);
  },
);

export const sendBackupCodesGenerated = guard(
  'backup-codes-generated',
  async (member: Member, ctx: RequestInfo, count: number, replaced: number) => {
    const mail = backupCodesGeneratedEmail({
      ...securityContext(member, ctx),
      name: displayName(member),
      count,
      replaced,
    });
    return deliver(member.email, mail);
  },
);

export const sendBackupCodeUsed = guard(
  'backup-code-used',
  async (member: Member, ctx: RequestInfo, remaining: number, total: number) => {
    const mail = backupCodeUsedEmail({
      ...securityContext(member, ctx),
      name: displayName(member),
      remaining,
      total,
    });
    return deliver(member.email, mail);
  },
);

/**
 * Password changed. Called by the recovery reset today. The account-settings
 * change-password route (`POST /api/auth/password`) should call it right
 * after it stores the new hash: `void sendPasswordChanged(member, ctx)`.
 */
export const sendPasswordChanged = guard(
  'password-changed',
  async (member: Member, ctx: RequestInfo, opts: { sessionsSignedOut?: boolean } = {}) => {
    const sc = securityContext(member, ctx);
    const mail = passwordChangedEmail(displayName(member), sc.ip, sc.at, {
      location: sc.location,
      device: sc.device,
      timeZone: sc.timeZone,
      sessionsSignedOut: opts.sessionsSignedOut,
    });
    return deliver(member.email, mail);
  },
);

/** Password reset link. `link` carries the single-use token and is built from APP_URL. */
export const sendPasswordReset = guard(
  'password-reset',
  async (member: Member, ctx: RequestInfo, link: string, minutes: number) => {
    const sc = securityContext(member, ctx);
    const mail = recoveryEmail(displayName(member), link, minutes, {
      at: sc.at,
      ip: sc.ip,
      location: sc.location,
      timeZone: sc.timeZone,
    });
    return deliver(member.email, mail);
  },
);

// ─── account ─────────────────────────────────────────────────────────────

/** Invitation with the single-use accept link (token shown nowhere else but to the inviter). */
export const sendInvite = guard(
  'invite',
  async (member: Member, inviterId: string, token: string) => {
    const mail = inviteEmail({
      inviteeName: member.name,
      inviteeEmail: member.email,
      inviterName: nameOf(inviterId),
      role: member.role,
      products: member.products.map(productName),
      expiresAt: member.inviteExpiresAt ?? Date.now(),
      link: appLink(config.mail.brand, `/accept-invite?token=${encodeURIComponent(token)}`),
    });
    return deliver(member.email, mail, `invite/${member.id}/${member.inviteExpiresAt ?? ''}`);
  },
);

/** To the member whose offboarding was just started (the handover contact is emailed via notify). */
export const sendOffboardingStarted = guard(
  'offboarding-started',
  async (
    member: Member,
    r: { id: string; lastDay: string; handoverTo: string; startedBy: string },
  ) => {
    const mail = offboardingStartedEmail({
      audience: 'member',
      name: displayName(member),
      memberId: member.id,
      memberName: displayName(member),
      lastDay: r.lastDay,
      handoverName: nameOf(r.handoverTo),
      startedByName: r.startedBy === member.id ? 'you' : nameOf(r.startedBy),
    });
    return deliver(member.email, mail, `offboarding-started/${r.id}`);
  },
);

// ─── notifications (preferences apply) ───────────────────────────────────

function forNotification(n: Notification, to: Member): RenderedEmail | undefined {
  const [kind, ...rest] = n.refId.split(':');
  const name = displayName(to);
  if (kind === 'task') {
    // task:<key>:assignee|reviewer:<memberId>
    const [key, role] = rest;
    const task = db.tasks.get(key);
    if (!task) return undefined;
    const as = role === 'reviewer' ? 'reviewer' : 'assignee';
    if (!wants(to, as === 'reviewer' ? 'review' : 'assigned')) return undefined;
    return taskAssignedEmail({
      name,
      taskKey: task.key,
      title: task.title,
      actorName: nameOf(n.actor),
      as,
      product: productName(task.product),
      priority: task.priority,
      status: task.status,
      due: task.due,
    });
  }
  if (kind === 'deployment') {
    const d = db.deployments.get(rest.join(':'));
    if (!d || !wants(to, 'deploys')) return undefined;
    return deploymentApprovalEmail({
      name,
      deploymentId: d.id,
      product: productName(d.product),
      version: d.version,
      env: d.env,
      requesterName: nameOf(d.requestedBy),
      requestedAt: d.createdAt,
      commit: d.sha ? d.sha.slice(0, 12) : undefined,
      timeZone: to.profile?.timezone,
    });
  }
  if (kind === 'access') {
    // access:<memberId>:<path>; an approval request for admins — no preference covers it.
    const [memberId, ...path] = rest;
    const requester = db.members.get(memberId);
    if (!requester) return undefined;
    return accessRequestEmail({
      adminName: name,
      requesterName: displayName(requester),
      requesterEmail: requester.email,
      requesterRole: requester.role,
      memberId: requester.id,
      path: path.join(':'),
      reason: n.body && n.body !== 'No reason given.' ? n.body : undefined,
      at: n.at,
      timeZone: to.profile?.timezone,
    });
  }
  if (kind === 'offboarding') {
    if (!wants(to, 'assigned')) return undefined;
    const r = resignations.get(rest[0]);
    const leaving = r && db.members.get(r.memberId);
    if (!r || !leaving) return undefined;
    return offboardingStartedEmail({
      audience: 'handover',
      name,
      memberId: leaving.id,
      memberName: displayName(leaving),
      lastDay: r.lastDay,
      handoverName: name,
      startedByName: nameOf(r.startedBy),
    });
  }
  // Mentions and doc comments go out in the digest only.
  return undefined;
}

/** Called by `notify()` for every newly created notification. */
export const emailForNotification = guard('notification', async (n: Notification) => {
  const to = db.members.get(n.memberId);
  if (!to || to.status !== 'active') return false;
  const mail = forNotification(n, to);
  if (!mail) return false;
  const ok = await deliver(to.email, mail, `notification/${n.id}`);
  if (ok) {
    n.emailedAt = new Date().toISOString();
    notifications.save(n.id);
  }
  return ok;
});

// ─── incidents (observed on the event bus) ───────────────────────────────

const announced = new Set<string>();

/**
 * Emails a newly declared incident (manual or opened by a monitor): the
 * owner always (unless they declared it or turned incident alerts off), and,
 * for SEV1, members who explicitly chose incident alerts and can see the
 * product.
 */
export const sendIncidentDeclared = guard('incident', async (incidentId: string) => {
  const i = db.incidents.get(incidentId);
  if (!i || announced.has(i.id)) return false;
  announced.add(i.id);
  if (i.timeline.length !== 1 || i.status === 'resolved') return false;
  const declaredBy = i.timeline[0].by;
  const base = {
    id: i.id,
    title: i.title,
    severity: i.severity,
    status: i.status,
    product: productName(i.product),
    service: i.service,
    impact: i.impact,
    startedAt: i.startedAt,
    declaredBy: nameOf(declaredBy),
  };
  const sends: Promise<boolean>[] = [];
  const owner = db.members.get(i.owner);
  if (owner && owner.status === 'active' && owner.id !== declaredBy && wants(owner, 'incidents'))
    sends.push(
      deliver(
        owner.email,
        incidentEmail({
          ...base,
          name: displayName(owner),
          owner: true,
          timeZone: owner.profile?.timezone,
        }),
        `incident/${i.id}/${owner.id}`,
      ),
    );
  if (i.severity === 'SEV1')
    for (const m of db.members.values()) {
      if (m.status !== 'active' || m.id === i.owner || m.id === declaredBy) continue;
      if (!m.profile?.notify.includes('incidents')) continue;
      if (m.role !== 'Owner' && !m.products.includes(i.product)) continue;
      sends.push(
        deliver(
          m.email,
          incidentEmail({
            ...base,
            name: displayName(m),
            owner: false,
            timeZone: m.profile.timezone,
          }),
          `incident/${i.id}/${m.id}`,
        ),
      );
    }
  return (await Promise.all(sends)).some(Boolean);
});

let observing = false;

/** Subscribes once per process to the bus events that send email. */
export function observeMailEvents() {
  if (observing) return;
  observing = true;
  subscribe((e) => {
    if (e.type === 'incident' && typeof e.data.id === 'string')
      void sendIncidentDeclared(e.data.id);
  });
}
