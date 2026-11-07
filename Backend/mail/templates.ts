/**
 * Transactional email templates. Each one describes its content as blocks
 * (mail/layout.ts renders them as HTML and plain text with the shared
 * branded layout) and returns `{ subject, html, text, category }`, ready to
 * spread into `sendMail({ to, ...mail })`.
 *
 * Copy rules: calm, specific, no exclamation marks; say what happened, when,
 * from where, and what to do if it was not the recipient. Secrets (backup
 * codes, TOTP seeds) are never put in an email.
 *
 * Every interpolated value is escaped by the layout. Links are built only
 * from APP_URL / APP_ORIGIN plus fixed paths — never from request headers
 * (Host-header poisoning would otherwise let an attacker receive reset
 * tokens) — and the layout rejects anything that is not absolute.
 */

import { config } from '../config/env.ts';
import type { Brand } from '../config/mail.ts';
import { appLink, renderEmail, type Block, type RenderedEmail } from './layout.ts';

export { escapeHtml } from './layout.ts';

type Mail = RenderedEmail;

const brandDefault = (): Brand => config.mail.brand;

/** Where members review sessions, passkeys, authenticator and backup codes. */
export const SECURITY_PATH = '/security';
export const RESET_PATH = '/forgot-password';

/** "Saturday 7 November 2026 at 14:03 UTC" in the member's time zone when known. */
export function formatWhen(at: string | number | Date, timeZone?: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return String(at);
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  };
  try {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: timeZone || 'UTC' }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(d);
  }
}

export function formatDate(at: string | number | Date, timeZone?: string): string {
  const d = new Date(at);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
  try {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: timeZone || 'UTC' }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' }).format(d);
  }
}

function listing(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Context of the request behind a security notice. */
export interface SecurityContext {
  /** ISO time of the event. */
  at: string;
  ip: string;
  /** "Lagos, Nigeria"; omitted when unknown. */
  location?: string;
  /** "Chrome on macOS"; omitted when unknown. */
  device?: string;
  /** Recipient's IANA time zone for formatting times. */
  timeZone?: string;
}

function contextRows(ctx: SecurityContext): [string, string][] {
  return [
    ['Time', formatWhen(ctx.at, ctx.timeZone)],
    ...(ctx.device ? ([['Device', ctx.device]] as [string, string][]) : []),
    ...(ctx.location ? ([['Approximate location', ctx.location]] as [string, string][]) : []),
    ['IP address', ctx.ip],
  ];
}

function notYou(brand: Brand, text: string): Block {
  return {
    t: 'notice',
    tone: 'warning',
    title: 'If this was not you',
    text: [
      text,
      ' Contact ',
      { href: `mailto:${brand.supportEmail}`, text: brand.supportEmail },
      ' if you need help.',
    ],
  };
}

const securityReason = (brand: Brand) =>
  `You received this security notice because it concerns your ${brand.name} account.`;

// ─── account ─────────────────────────────────────────────────────────────

export interface InviteData {
  inviteeName: string;
  inviteeEmail: string;
  inviterName: string;
  role: string;
  products: string[];
  expiresAt: string | number;
  /** Absolute accept link including the single-use token. */
  link: string;
}

export function inviteEmail(d: InviteData, brand: Brand = brandDefault()): Mail {
  const expires = formatDate(d.expiresAt);
  const products = listing(d.products);
  return renderEmail(
    {
      category: 'invite',
      kind: 'account',
      subject: `${d.inviterName} invited you to join ${brand.name}`,
      preheader: `Join as ${d.role} on ${products}. The invitation expires on ${expires}.`,
      heading: `Join your team on ${brand.name}`,
      greeting: d.inviteeName,
      blocks: [
        {
          t: 'p',
          text: [{ strong: d.inviterName }, ` has invited you to the ${brand.name} workspace.`],
        },
        {
          t: 'facts',
          rows: [
            ['Role', d.role],
            [d.products.length === 1 ? 'Product' : 'Products', products],
            ['Invited by', d.inviterName],
            ['Expires', formatWhen(d.expiresAt)],
          ],
        },
        { t: 'button', href: d.link, label: 'Accept invitation', showUrl: true },
        {
          t: 'p',
          text: 'When you accept, you will choose a password and set up two-step verification. The link works once.',
        },
        {
          t: 'muted',
          text: 'If you were not expecting this invitation, you can ignore this email. No account is activated until the invitation is accepted.',
        },
      ],
      reason: `You received this email because ${d.inviterName} invited ${d.inviteeEmail} to ${brand.name}.`,
    },
    brand,
  );
}

export function recoveryEmail(
  name: string,
  link: string,
  minutes: number,
  ctx?: Omit<SecurityContext, 'device'>,
  brand: Brand = brandDefault(),
): Mail {
  return renderEmail(
    {
      category: 'password-reset',
      kind: 'security',
      subject: `Reset your ${brand.name} password`,
      preheader: `Use this link within ${minutes} minutes to choose a new password.`,
      heading: 'Reset your password',
      greeting: name,
      blocks: [
        {
          t: 'p',
          text: `We received a request to reset the password for your ${brand.name} account. The link below works once and expires in ${minutes} minutes.`,
        },
        { t: 'button', href: link, label: 'Choose a new password', showUrl: true },
        ...(ctx ? [{ t: 'facts', rows: contextRows(ctx) } as Block] : []),
        {
          t: 'notice',
          tone: 'warning',
          title: 'If this was not you',
          text: 'You can ignore this email. Your password stays the same unless this link is used. If you keep receiving these requests, contact your workspace Owner.',
        },
      ],
      reason: `You received this email because a password reset was requested for this address on ${brand.name}.`,
    },
    brand,
  );
}

/**
 * Password changed. Sent by the recovery flow today; the account-settings
 * route (`POST /api/auth/password`) should call `sendPasswordChanged` from
 * mail/events.ts after it stores the new hash.
 */
export function passwordChangedEmail(
  name: string,
  ip: string,
  at: string,
  extra: {
    location?: string;
    device?: string;
    timeZone?: string;
    sessionsSignedOut?: boolean;
  } = {},
  brand: Brand = brandDefault(),
): Mail {
  const signedOut = extra.sessionsSignedOut !== false;
  return renderEmail(
    {
      category: 'password-changed',
      kind: 'security',
      subject: `Your ${brand.name} password was changed`,
      preheader: `Your password was changed on ${formatWhen(at, extra.timeZone)}.`,
      heading: 'Your password was changed',
      greeting: name,
      blocks: [
        {
          t: 'p',
          text: signedOut
            ? `The password for your ${brand.name} account was changed. For your protection, every active session was signed out, so you will need to sign in again on your other devices.`
            : `The password for your ${brand.name} account was changed.`,
        },
        { t: 'facts', rows: contextRows({ at, ip, ...extra }) },
        notYou(
          brand,
          'Someone else may have access to your account or your email. Reset your password now and tell your workspace Owner.',
        ),
        { t: 'button', href: appLink(brand, RESET_PATH), label: 'Reset your password' },
      ],
      reason: securityReason(brand),
    },
    brand,
  );
}

export interface SignInAlertData extends SecurityContext {
  name: string;
  /** "Password and authenticator app", "Passkey", … */
  method: string;
}

export function signInAlertEmail(d: SignInAlertData, brand: Brand = brandDefault()): Mail {
  const where = d.location ? ` near ${d.location}` : '';
  return renderEmail(
    {
      category: 'sign-in-alert',
      kind: 'security',
      subject: `New sign-in to your ${brand.name} account`,
      preheader: `${d.device ?? 'A new device'}${where}, ${formatWhen(d.at, d.timeZone)}.`,
      heading: 'New sign-in to your account',
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: `Your ${brand.name} account was signed in to from a device or network we have not seen for you before.`,
        },
        { t: 'facts', rows: [...contextRows(d), ['Sign-in method', d.method]] },
        { t: 'p', text: 'If this was you, there is nothing else to do.' },
        notYou(
          brand,
          'Secure your account now: sign out the unfamiliar session, change your password and review your two-step verification methods.',
        ),
        { t: 'button', href: appLink(brand, SECURITY_PATH), label: 'Secure your account' },
        { t: 'muted', text: 'Location is estimated from the IP address and may not be exact.' },
      ],
      reason: securityReason(brand),
    },
    brand,
  );
}

export interface FactorChangedData extends SecurityContext {
  name: string;
  factor: 'authenticator app' | 'passkey';
  /** True when an existing authenticator was replaced. */
  replaced: boolean;
  /** Passkey label, e.g. "MacBook Touch ID". */
  label?: string;
}

export function factorChangedEmail(d: FactorChangedData, brand: Brand = brandDefault()): Mail {
  const subject = d.replaced
    ? `Your ${brand.name} authenticator app was replaced`
    : `A ${d.factor} was added to your ${brand.name} account`;
  return renderEmail(
    {
      category: 'mfa-enrolled',
      kind: 'security',
      subject,
      preheader: `Two-step verification changed on ${formatWhen(d.at, d.timeZone)}.`,
      heading: d.replaced ? 'Your authenticator app was replaced' : `A ${d.factor} was added`,
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: d.replaced
            ? 'Your account now uses a new authenticator app for two-step verification. Codes from the previous app no longer work.'
            : `A ${d.factor} can now be used for two-step verification on your account.`,
        },
        {
          t: 'facts',
          rows: [['Method', d.label ? `${d.factor} (${d.label})` : d.factor], ...contextRows(d)],
        },
        notYou(
          brand,
          'Someone may have access to your account. Reset your password and ask your workspace Owner to review your sign-in methods.',
        ),
        { t: 'button', href: appLink(brand, SECURITY_PATH), label: 'Review security settings' },
      ],
      reason: securityReason(brand),
    },
    brand,
  );
}

export interface BackupCodesGeneratedData extends SecurityContext {
  name: string;
  count: number;
  /** Unused codes from the previous set that stopped working. */
  replaced: number;
}

export function backupCodesGeneratedEmail(
  d: BackupCodesGeneratedData,
  brand: Brand = brandDefault(),
): Mail {
  return renderEmail(
    {
      category: 'backup-codes-generated',
      kind: 'security',
      subject: `New backup codes were generated for your ${brand.name} account`,
      preheader: `${d.count} new one-time codes. Codes from earlier sets no longer work.`,
      heading: 'New backup codes were generated',
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: `A new set of ${d.count} one-time backup codes was generated for your account.${
            d.replaced
              ? ` The ${d.replaced} unused codes from your previous set no longer work.`
              : ''
          }`,
        },
        {
          t: 'p',
          text: 'Keep the codes somewhere safe and offline, such as a password manager. For your security, backup codes are never sent by email.',
        },
        { t: 'facts', rows: contextRows(d) },
        notYou(
          brand,
          'Someone may have access to your account. Generate a new set yourself, reset your password and tell your workspace Owner.',
        ),
        { t: 'button', href: appLink(brand, SECURITY_PATH), label: 'Review security settings' },
      ],
      reason: securityReason(brand),
    },
    brand,
  );
}

export interface BackupCodeUsedData extends SecurityContext {
  name: string;
  remaining: number;
  total: number;
}

export function backupCodeUsedEmail(d: BackupCodeUsedData, brand: Brand = brandDefault()): Mail {
  const low: Block[] =
    d.remaining <= 3
      ? [
          {
            t: 'notice',
            tone: 'info',
            title: d.remaining === 0 ? 'No backup codes left' : 'Backup codes running low',
            text:
              d.remaining === 0
                ? 'You have used every backup code. Generate a new set from your security settings so you are not locked out if you lose your authenticator.'
                : `You have ${d.remaining} backup ${d.remaining === 1 ? 'code' : 'codes'} left. Generate a new set from your security settings before you run out.`,
          },
        ]
      : [];
  return renderEmail(
    {
      category: 'backup-code-used',
      kind: 'security',
      subject: `A backup code was used to sign in to ${brand.name}`,
      preheader: `${d.remaining} of ${d.total} backup codes remain.`,
      heading: 'A backup code was used to sign in',
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: 'A one-time backup code was used instead of your authenticator to finish signing in to your account. That code cannot be used again.',
        },
        {
          t: 'facts',
          rows: [['Codes remaining', `${d.remaining} of ${d.total}`], ...contextRows(d)],
        },
        ...low,
        notYou(
          brand,
          'Someone has your password and one of your backup codes. Reset your password, generate new backup codes and tell your workspace Owner.',
        ),
        { t: 'button', href: appLink(brand, SECURITY_PATH), label: 'Review security settings' },
      ],
      reason: securityReason(brand),
    },
    brand,
  );
}

export interface AccountLockedData extends SecurityContext {
  name: string;
  attempts: number;
  /** ISO time the lock expires. */
  until: string;
}

export function accountLockedEmail(d: AccountLockedData, brand: Brand = brandDefault()): Mail {
  const minutes = Math.max(1, Math.round((Date.parse(d.until) - Date.parse(d.at)) / 60_000));
  return renderEmail(
    {
      category: 'account-locked',
      kind: 'security',
      subject: `Your ${brand.name} account is temporarily locked`,
      preheader: `${d.attempts} unsuccessful sign-in attempts. You can try again in ${minutes} minutes.`,
      heading: 'Your account is temporarily locked',
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: `After ${d.attempts} unsuccessful sign-in attempts in a row, we locked your account for ${minutes} minutes to protect it.`,
        },
        {
          t: 'facts',
          rows: [
            ['Unlocks at', formatWhen(d.until, d.timeZone)],
            ['Last attempt', formatWhen(d.at, d.timeZone)],
            ...contextRows(d).filter(([k]) => k !== 'Time'),
          ],
        },
        {
          t: 'p',
          text: 'If these attempts were yours, wait until the lock expires and try again, or reset your password.',
        },
        notYou(
          brand,
          'Someone may be trying to guess your password. Your account stays protected while it is locked. Once it unlocks, change your password to a long, unique one.',
        ),
        { t: 'button', href: appLink(brand, RESET_PATH), label: 'Reset your password' },
      ],
      reason: securityReason(brand),
    },
    brand,
  );
}

// ─── work notifications ──────────────────────────────────────────────────

export interface AccessRequestData {
  adminName: string;
  requesterName: string;
  requesterEmail: string;
  requesterRole: string;
  memberId: string;
  /** In-app path the requester was refused, e.g. `/audit`. */
  path: string;
  reason?: string;
  at: string;
  timeZone?: string;
}

export function accessRequestEmail(d: AccessRequestData, brand: Brand = brandDefault()): Mail {
  return renderEmail(
    {
      category: 'access-request',
      kind: 'notification',
      subject: `${d.requesterName} requested access to ${d.path}`,
      preheader: d.reason ? `Reason given: ${d.reason}` : `${d.requesterName} gave no reason.`,
      heading: 'Access request',
      greeting: d.adminName,
      blocks: [
        {
          t: 'p',
          text: [
            { strong: d.requesterName },
            ' was refused access to ',
            { strong: d.path },
            ' and has asked for it to be granted.',
          ],
        },
        {
          t: 'facts',
          rows: [
            ['Requested by', `${d.requesterName} (${d.requesterEmail})`],
            ['Current role', d.requesterRole],
            ['Area', d.path],
            ['Reason', d.reason || 'No reason given'],
            ['Time', formatWhen(d.at, d.timeZone)],
          ],
        },
        {
          t: 'button',
          href: appLink(brand, `/team/${encodeURIComponent(d.memberId)}`),
          label: 'Review member',
        },
        {
          t: 'muted',
          text: "Access is granted by changing the member's role or products on their member page. The change requires step-up verification and is recorded in the audit log.",
        },
      ],
      reason: `You received this email because you can manage team access in ${brand.name}.`,
    },
    brand,
  );
}

export interface TaskAssignedData {
  name: string;
  taskKey: string;
  title: string;
  actorName: string;
  /** `assignee` (default) or `reviewer`. */
  as?: 'assignee' | 'reviewer';
  product?: string;
  priority?: string;
  status?: string;
  due?: string;
}

export function taskAssignedEmail(d: TaskAssignedData, brand: Brand = brandDefault()): Mail {
  const review = d.as === 'reviewer';
  const rows: [string, string][] = [['Task', `${d.taskKey} · ${d.title}`]];
  if (d.product) rows.push(['Product', d.product]);
  if (d.priority) rows.push(['Priority', d.priority]);
  if (d.status) rows.push(['Status', d.status]);
  if (d.due) rows.push(['Due', formatDate(d.due)]);
  rows.push([review ? 'Requested by' : 'Assigned by', d.actorName]);
  return renderEmail(
    {
      category: 'task-assigned',
      kind: 'notification',
      subject: review
        ? `Review requested on ${d.taskKey}: ${d.title}`
        : `${d.taskKey} assigned to you: ${d.title}`,
      preheader: review
        ? `${d.actorName} asked you to review ${d.taskKey}.`
        : `${d.actorName} assigned ${d.taskKey} to you.`,
      heading: review ? `Review requested on ${d.taskKey}` : `${d.taskKey} is assigned to you`,
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: review
            ? [{ strong: d.actorName }, ' asked you to review ', { strong: d.taskKey }, '.']
            : [{ strong: d.actorName }, ' assigned ', { strong: d.taskKey }, ' to you.'],
        },
        { t: 'facts', rows },
        {
          t: 'button',
          href: appLink(brand, `/tasks/${encodeURIComponent(d.taskKey)}`),
          label: 'Open task',
        },
      ],
      reason: review
        ? `You received this email because you were asked to review a task in ${brand.name}.`
        : `You received this email because a task was assigned to you in ${brand.name}.`,
    },
    brand,
  );
}

export interface IncidentData {
  name: string;
  id: string;
  title: string;
  severity: string;
  status: string;
  product: string;
  service: string;
  impact: string;
  startedAt: string;
  /** Name of who declared it, or "Automated monitoring". */
  declaredBy: string;
  /** True when the recipient is the incident owner. */
  owner: boolean;
  timeZone?: string;
}

export function incidentEmail(d: IncidentData, brand: Brand = brandDefault()): Mail {
  return renderEmail(
    {
      category: 'incident',
      kind: 'notification',
      subject: d.owner
        ? `[${d.severity}] ${d.id} assigned to you: ${d.title}`
        : `[${d.severity}] ${d.id} declared: ${d.title}`,
      preheader: `${d.service} · ${d.impact}`,
      heading: `${d.id}: ${d.title}`,
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: d.owner
            ? [
                { strong: d.declaredBy },
                ' declared a ',
                { strong: d.severity },
                ' incident and made you its owner.',
              ]
            : [
                { strong: d.declaredBy },
                ' declared a ',
                { strong: d.severity },
                ` incident on ${d.product}.`,
              ],
        },
        {
          t: 'facts',
          rows: [
            ['Severity', d.severity],
            ['Status', d.status],
            ['Product', d.product],
            ['Service', d.service],
            ['Impact', d.impact],
            ['Started', formatWhen(d.startedAt, d.timeZone)],
          ],
        },
        ...(d.owner
          ? [
              {
                t: 'p',
                text: 'As the owner you coordinate the response: confirm the impact, post status updates to the timeline and resolve the incident when service is restored.',
              } as Block,
            ]
          : []),
        {
          t: 'button',
          href: appLink(brand, `/incidents/${encodeURIComponent(d.id)}`),
          label: 'Open incident',
        },
      ],
      reason: d.owner
        ? `You received this email because you are the owner of ${d.id} in ${brand.name}.`
        : `You received this email because you follow incidents on ${d.product} in ${brand.name}.`,
    },
    brand,
  );
}

export interface DeploymentApprovalData {
  name: string;
  deploymentId: string;
  product: string;
  version: string;
  env: string;
  requesterName: string;
  requestedAt: string;
  commit?: string;
  timeZone?: string;
}

export function deploymentApprovalEmail(
  d: DeploymentApprovalData,
  brand: Brand = brandDefault(),
): Mail {
  const rows: [string, string][] = [
    ['Product', d.product],
    ['Version', d.version],
    ['Environment', d.env],
    ['Requested by', d.requesterName],
    ['Requested', formatWhen(d.requestedAt, d.timeZone)],
  ];
  if (d.commit) rows.push(['Commit', d.commit]);
  return renderEmail(
    {
      category: 'deployment-approval',
      kind: 'notification',
      subject: `Approval needed: ${d.product} ${d.version} to ${d.env}`,
      preheader: `${d.requesterName} is waiting for a second approver.`,
      heading: 'A deployment is waiting for your approval',
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: [
            { strong: d.requesterName },
            ' requested a deployment of ',
            { strong: `${d.product} ${d.version}` },
            ' to ',
            { strong: d.env },
            ' that needs a second approver.',
          ],
        },
        { t: 'facts', rows },
        {
          t: 'button',
          href: appLink(brand, `/deployments/${encodeURIComponent(d.deploymentId)}`),
          label: 'Review deployment',
        },
        {
          t: 'muted',
          text: 'Deployments follow the two-person rule: the requester cannot approve their own release. Approving requires step-up verification and is recorded in the audit log.',
        },
      ],
      reason: `You received this email because you can approve deployments of ${d.product} in ${brand.name}.`,
    },
    brand,
  );
}

export interface OffboardingStartedData {
  name: string;
  /** `member`: the person leaving. `handover`: the person receiving their work. */
  audience: 'member' | 'handover';
  memberId: string;
  memberName: string;
  lastDay: string;
  handoverName: string;
  startedByName: string;
}

export function offboardingStartedEmail(
  d: OffboardingStartedData,
  brand: Brand = brandDefault(),
): Mail {
  const lastDay = formatDate(d.lastDay);
  const link = appLink(brand, `/team/${encodeURIComponent(d.memberId)}`);
  if (d.audience === 'handover')
    return renderEmail(
      {
        category: 'offboarding-started',
        kind: 'notification',
        subject: `${d.memberName} is handing work over to you`,
        preheader: `${d.memberName}'s last day is ${lastDay}.`,
        heading: `${d.memberName} is handing work over to you`,
        greeting: d.name,
        blocks: [
          {
            t: 'p',
            text: [
              { strong: d.memberName },
              ` is leaving the workspace. You have been named to take over their open tasks and documents.`,
            ],
          },
          {
            t: 'facts',
            rows: [
              ['Last day', lastDay],
              ['Started by', d.startedByName],
            ],
          },
          { t: 'button', href: link, label: 'View handover' },
          {
            t: 'muted',
            text: 'Agree the details with them before their last day. Their access is removed when offboarding completes.',
          },
        ],
        reason: `You received this email because you were named as the handover contact in ${brand.name}.`,
      },
      brand,
    );
  return renderEmail(
    {
      category: 'offboarding-started',
      kind: 'account',
      subject: `Your ${brand.name} offboarding has started`,
      preheader: `Your last day is ${lastDay}. Your work hands over to ${d.handoverName}.`,
      heading: 'Your offboarding has started',
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: `Your offboarding from ${brand.name} was started by ${d.startedByName}. Your access stays as it is until offboarding completes.`,
        },
        {
          t: 'facts',
          rows: [
            ['Last day', lastDay],
            ['Handover to', d.handoverName],
            ['Started by', d.startedByName],
          ],
        },
        {
          t: 'p',
          text: `Before your last day, please hand over open tasks and documents to ${d.handoverName}. When offboarding completes, your sessions, access grants and tokens are revoked.`,
        },
        { t: 'button', href: link, label: 'View offboarding' },
      ],
      reason: `You received this email because offboarding was started for your ${brand.name} account.`,
    },
    brand,
  );
}

export function offboardingCompletedEmail(name: string, brand: Brand = brandDefault()): Mail {
  return renderEmail(
    {
      category: 'offboarding-completed',
      kind: 'account',
      subject: `Your ${brand.name} access has ended`,
      preheader: 'Your offboarding is complete and your access has been removed.',
      heading: 'Your access has ended',
      greeting: name,
      blocks: [
        {
          t: 'p',
          text: `Your offboarding is complete and your ${brand.name} access has been removed. Thank you for your contributions.`,
        },
        {
          t: 'p',
          text: 'Please delete any remaining local copies of confidential information, as agreed in the NDA.',
        },
      ],
      reason: `You received this email because your ${brand.name} account was closed.`,
    },
    brand,
  );
}

export function digestEmail(
  name: string,
  items: { title: string; body: string; link: string; at?: string }[],
  opts: { period?: 'daily' | 'weekly'; timeZone?: string } = {},
  brand: Brand = brandDefault(),
): Mail {
  const n = items.length;
  const label = opts.period === 'weekly' ? 'weekly' : opts.period === 'daily' ? 'daily' : '';
  return renderEmail(
    {
      category: 'digest',
      kind: 'notification',
      subject: `You have ${n} unread ${brand.name} notification${n === 1 ? '' : 's'}`,
      preheader: items
        .slice(0, 2)
        .map((i) => i.title)
        .join(' · '),
      heading: label ? `Your ${label} summary` : 'Your unread notifications',
      greeting: name,
      blocks: [
        {
          t: 'p',
          text: `You have ${n} unread notification${n === 1 ? '' : 's'} in ${brand.name}.`,
        },
        {
          t: 'list',
          items: items.map((i) => ({
            title: i.title,
            body: i.body,
            href: i.link,
            meta: i.at ? formatWhen(i.at, opts.timeZone) : undefined,
          })),
        },
        { t: 'button', href: appLink(brand, '/inbox'), label: 'Open your inbox' },
      ],
      reason: `You received this summary because you have unread notifications in ${brand.name}.`,
    },
    brand,
  );
}
