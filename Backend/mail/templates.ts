/**
 * Transactional email templates. Each one describes its content as blocks
 * (mail/layout.ts renders them as HTML and plain text with the shared
 * branded layout) and returns `{ subject, html, text, category }`, ready to
 * spread into `sendMail({ to, ...mail })`.
 *
 * Copy rules: calm, specific, no exclamation marks; say what happened, when,
 * from where, and what to do if it was not the recipient. Greet by first
 * name. Show human labels, never raw enum values (mail/labels.ts), and the
 * product's display name with its mark. Secrets (backup codes, TOTP seeds)
 * are never put in an email.
 *
 * Imagery: every non-security email has one hero illustration; security
 * notices have none (a shield drawn in HTML instead), see mail/assets.ts.
 *
 * Every interpolated value is escaped by the layout. Links are built only
 * from APP_URL / APP_ORIGIN plus fixed paths — never from request headers
 * (Host-header poisoning would otherwise let an attacker receive reset
 * tokens) — and the layout rejects anything that is not absolute.
 */

import { config } from '../config/env.ts';
import type { Brand } from '../config/mail.ts';
import {
  environmentLabel,
  formatDay,
  formatInstant,
  formatTime,
  incidentStatusLabel,
  priorityLabel,
  product,
  relativeDays,
  severityLabel,
  taskStatusLabel,
  type ProductRef,
} from './labels.ts';
import {
  appLink,
  renderEmail,
  type Block,
  type Inline,
  type RenderedEmail,
  type Rich,
  type Tone,
} from './layout.ts';

export { escapeHtml } from './layout.ts';

type Mail = RenderedEmail;
type When = string | number | Date;

const brandDefault = (): Brand => config.mail.brand;

/** Where members review sessions, passkeys, authenticator and backup codes. */
export const SECURITY_PATH = '/security';
export const RESET_PATH = '/forgot-password';

/** "Sat 7 Nov 2026, 15:03 WAT" in the member's time zone when known. */
export function formatWhen(at: When, timeZone?: string): string {
  return formatInstant(at, timeZone);
}

/** "Sat 14 Nov 2026", with " · in 7 days" when `now` is given. */
export function formatDate(at: When, timeZone?: string, now?: When): string {
  return formatDay(at, { timeZone, now });
}

/** "Today at 10:03", "Yesterday at 18:40", else the full date and time. */
function formatRecent(at: When, timeZone?: string, now: When = Date.now()): string {
  const rel = relativeDays(at, now, timeZone);
  if (rel === 'today') return `Today at ${formatTime(at, timeZone)}`;
  if (rel === 'yesterday') return `Yesterday at ${formatTime(at, timeZone)}`;
  return formatInstant(at, timeZone);
}

function listing(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Products as mark + name, comma separated. */
function productsInline(ps: ProductRef[]): Inline[] {
  return ps.flatMap((p, i) => (i ? [', ', { product: p }] : [{ product: p }]));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ─── security ────────────────────────────────────────────────────────────

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

function contextRows(ctx: SecurityContext): [string, Rich][] {
  return [
    ['Time', formatInstant(ctx.at, ctx.timeZone)],
    ...(ctx.device ? ([['Device', ctx.device]] as [string, Rich][]) : []),
    ...(ctx.location ? ([['Approximate location', ctx.location]] as [string, Rich][]) : []),
    ['IP address', [{ code: ctx.ip }]],
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

/** The shield above a security heading: `!` for something to check, a tick for a confirmation. */
const ALERT = { label: 'Security alert', tone: 'warn' as Tone, glyph: '!' };
const CONFIRM = { label: 'Security notice', tone: 'accent' as Tone, glyph: '✓' };

// ─── account ─────────────────────────────────────────────────────────────

export interface InviteData {
  inviteeName: string;
  inviteeEmail: string;
  inviterName: string;
  role: string;
  /** Product ids or display names. */
  products: string[];
  expiresAt: string | number;
  /** Absolute accept link including the single-use token. */
  link: string;
  workspace?: string;
  now?: When;
}

export function inviteEmail(d: InviteData, brand: Brand = brandDefault()): Mail {
  const ps = d.products.map(product);
  const names = listing(ps.map((p) => p.name));
  const where = d.workspace ?? `the ${brand.name} workspace`;
  return renderEmail(
    {
      category: 'invite',
      kind: 'account',
      noAccess: true,
      subject: `${d.inviterName} invited you to join ${d.workspace ?? brand.name}`,
      preheader: `Join as ${d.role}${names ? ` on ${names}` : ''}. The invitation expires on ${formatDay(d.expiresAt)}.`,
      eyebrow: { label: 'Invitation' },
      hero: 'invite',
      workspace: d.workspace,
      heading: d.workspace
        ? `Join ${d.workspace} on ${brand.name}`
        : `Join your team on ${brand.name}`,
      greeting: d.inviteeName,
      blocks: [
        {
          t: 'p',
          text: [
            { strong: d.inviterName },
            ` has invited you to ${where}, where your team plans work, reviews code, ships releases and handles incidents.`,
          ],
        },
        {
          t: 'facts',
          rows: [
            ['Role', d.role],
            ...(ps.length
              ? ([[ps.length === 1 ? 'Product' : 'Products', productsInline(ps)]] as [
                  string,
                  Rich,
                ][])
              : []),
            ['Invited by', d.inviterName],
            ['Expires', formatDay(d.expiresAt, { now: d.now ?? Date.now() })],
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
      eyebrow: { label: 'Password reset', tone: 'accent', glyph: '✱' },
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
      preheader: `Your password was changed on ${formatInstant(at, extra.timeZone)}.`,
      eyebrow: CONFIRM,
      heading: 'Your password was changed',
      greeting: name,
      blocks: [
        {
          t: 'p',
          text: signedOut
            ? `The password for your ${brand.name} account was changed. For your protection, your other sessions were signed out and any personal access tokens were revoked, so you will need to sign in again on your other devices and create new tokens for scripts.`
            : `The password for your ${brand.name} account was changed. For your protection, any personal access tokens were revoked; create new ones for scripts that need them.`,
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
      preheader: `${d.device ?? 'A new device'}${where}, ${formatInstant(d.at, d.timeZone)}.`,
      eyebrow: ALERT,
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
        {
          t: 'button',
          href: appLink(brand, SECURITY_PATH),
          label: 'Review this sign-in',
          secondary: { href: appLink(brand, '/sessions'), text: 'See all active sessions' },
        },
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
  const method = d.factor === 'passkey' ? 'Passkey' : 'Authenticator app';
  return renderEmail(
    {
      category: 'mfa-enrolled',
      kind: 'security',
      subject,
      preheader: `Two-step verification changed on ${formatInstant(d.at, d.timeZone)}.`,
      eyebrow: d.replaced ? ALERT : CONFIRM,
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
          rows: [['Method', d.label ? `${method} (${d.label})` : method], ...contextRows(d)],
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
      eyebrow: CONFIRM,
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
                : `You have ${plural(d.remaining, 'backup code')} left. Generate a new set from your security settings before you run out.`,
          },
        ]
      : [];
  return renderEmail(
    {
      category: 'backup-code-used',
      kind: 'security',
      subject: `A backup code was used to sign in to ${brand.name}`,
      preheader: `${d.remaining} of ${d.total} backup codes remain.`,
      eyebrow: ALERT,
      heading: 'A backup code was used to sign in',
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: 'A one-time backup code was used instead of your authenticator to finish signing in to your account. That code cannot be used again.',
        },
        {
          t: 'facts',
          rows: [
            [
              'Codes remaining',
              [
                {
                  pill: `${d.remaining} of ${d.total}`,
                  tone: d.remaining <= 3 ? 'warn' : 'neutral',
                },
              ],
            ],
            ...contextRows(d),
          ],
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
      eyebrow: { label: 'Security alert', tone: 'bad', glyph: '!' },
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
            ['Unlocks at', formatInstant(d.until, d.timeZone)],
            ['Last attempt', formatInstant(d.at, d.timeZone)],
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
  workspace?: string;
}

export function accessRequestEmail(d: AccessRequestData, brand: Brand = brandDefault()): Mail {
  return renderEmail(
    {
      category: 'access-request',
      kind: 'notification',
      subject: `${d.requesterName} requested access to ${d.path}`,
      // The reason is the requester's free text: body only (escaped), never the
      // inbox preview, so it cannot dress up as platform copy (W5-06).
      preheader: `${d.requesterName} asked for access to ${d.path}.`,
      eyebrow: { label: 'Access request' },
      hero: 'access',
      workspace: d.workspace,
      heading: `${d.requesterName} is asking for access`,
      greeting: d.adminName,
      blocks: [
        {
          t: 'p',
          text: [
            { strong: d.requesterName },
            ' was refused access to ',
            { code: d.path },
            ' and has asked for it to be granted.',
          ],
        },
        {
          t: 'facts',
          rows: [
            ['Requested by', `${d.requesterName} (${d.requesterEmail})`],
            ['Current role', d.requesterRole],
            ['Area', [{ code: d.path }]],
            ['Reason', d.reason || 'No reason given'],
            ['Time', formatInstant(d.at, d.timeZone)],
          ],
        },
        {
          t: 'button',
          href: appLink(brand, `/team/${encodeURIComponent(d.memberId)}`),
          label: 'Review member',
          secondary: { href: appLink(brand, '/team'), text: 'Open the team list' },
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
  /** Product id or display name. */
  product?: string;
  priority?: string;
  status?: string;
  /** Due date, `YYYY-MM-DD`. */
  due?: string;
  timeZone?: string;
  workspace?: string;
  now?: When;
}

export function taskAssignedEmail(d: TaskAssignedData, brand: Brand = brandDefault()): Mail {
  const review = d.as === 'reviewer';
  const p = d.product ? product(d.product) : undefined;
  const link = appLink(brand, `/tasks/${encodeURIComponent(d.taskKey)}`);
  const pills: { label: string; tone: Tone }[] = [];
  if (d.status) pills.push(taskStatusLabel(d.status));
  if (d.priority) {
    const pr = priorityLabel(d.priority);
    pills.push({ label: `${pr.label} priority`, tone: pr.tone });
  }
  const rows: [string, Rich][] = [];
  if (d.due)
    rows.push(['Due', formatDay(d.due, { timeZone: d.timeZone, now: d.now ?? Date.now() })]);
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
      eyebrow: { label: review ? 'Review request' : 'Task assigned' },
      hero: review ? 'review' : 'task',
      workspace: d.workspace,
      heading: review ? `Review requested on ${d.taskKey}` : `${d.taskKey} is assigned to you`,
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: review
            ? [{ strong: d.actorName }, ' asked you to review this task.']
            : [{ strong: d.actorName }, ' assigned this task to you.'],
        },
        {
          t: 'card',
          meta: [{ code: d.taskKey }, ...(p ? ([' · ', { product: p }] as Inline[]) : [])],
          title: d.title,
          href: link,
          pills,
          rows,
        },
        {
          t: 'button',
          href: link,
          label: review ? 'Open task to review' : 'Open task',
          secondary: { href: appLink(brand, '/my-work'), text: 'See all your work' },
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
  /** Product id or display name. */
  product: string;
  service: string;
  impact: string;
  startedAt: string;
  /** Name of who declared it, or "Automated monitoring". */
  declaredBy: string;
  /** True when the recipient is the incident owner. */
  owner: boolean;
  timeZone?: string;
  workspace?: string;
}

export function incidentEmail(d: IncidentData, brand: Brand = brandDefault()): Mail {
  const p = product(d.product);
  const sev = severityLabel(d.severity);
  const status = incidentStatusLabel(d.status);
  const link = appLink(brand, `/incidents/${encodeURIComponent(d.id)}`);
  const [sevShort, sevWord] = sev.label.split(' · ');
  const sevPhrase = sevWord ? `${sevWord.toLowerCase()} (${sevShort})` : sevShort;
  return renderEmail(
    {
      category: 'incident',
      kind: 'notification',
      subject: d.owner
        ? `[${sevShort}] ${d.id} assigned to you: ${d.title}`
        : `[${sevShort}] ${d.id} declared: ${d.title}`,
      preheader: `${p.name} · ${d.service} · ${d.impact}`,
      eyebrow: { label: `Incident · ${sevShort}`, tone: sev.tone },
      hero: 'incident',
      workspace: d.workspace,
      heading: d.owner
        ? `You are the owner of ${d.id}`
        : `${sevShort} incident declared on ${p.name}`,
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: d.owner
            ? [
                { strong: d.declaredBy },
                ` declared a ${sevPhrase} incident on ${p.name} and made you its owner.`,
              ]
            : [{ strong: d.declaredBy }, ` declared a ${sevPhrase} incident on ${p.name}.`],
        },
        {
          t: 'card',
          meta: [{ code: d.id }, ' · ', { product: p }],
          title: d.title,
          href: link,
          pills: [sev, status],
          rows: [
            ['Impact', d.impact],
            ['Service', [{ code: d.service }]],
            ['Started', formatInstant(d.startedAt, d.timeZone)],
            ['Declared by', d.declaredBy],
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
          href: link,
          label: 'Open incident',
          secondary: { href: appLink(brand, '/incidents'), text: 'See all open incidents' },
        },
      ],
      reason: d.owner
        ? `You received this email because you are the owner of ${d.id} in ${brand.name}.`
        : `You received this email because you follow incidents on ${p.name} in ${brand.name}.`,
    },
    brand,
  );
}

export interface DeploymentApprovalData {
  name: string;
  deploymentId: string;
  /** Product id or display name. */
  product: string;
  version: string;
  env: string;
  requesterName: string;
  requestedAt: string;
  commit?: string;
  timeZone?: string;
  workspace?: string;
}

export function deploymentApprovalEmail(
  d: DeploymentApprovalData,
  brand: Brand = brandDefault(),
): Mail {
  const p = product(d.product);
  const env = environmentLabel(d.env);
  const link = appLink(brand, `/deployments/${encodeURIComponent(d.deploymentId)}`);
  const rows: [string, Rich][] = [
    ['Requested by', d.requesterName],
    ['Requested', formatInstant(d.requestedAt, d.timeZone)],
  ];
  if (d.commit) rows.push(['Commit', [{ code: d.commit }]]);
  return renderEmail(
    {
      category: 'deployment-approval',
      kind: 'notification',
      subject: `Approval needed: ${p.name} ${d.version} to ${env.label}`,
      preheader: `${d.requesterName} is waiting for a second approver.`,
      eyebrow: { label: 'Deployment approval', tone: 'warn' },
      hero: 'deploy',
      workspace: d.workspace,
      heading: 'A deployment is waiting for your approval',
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: [
            { strong: d.requesterName },
            ' requested a release of ',
            { strong: `${p.name} ${d.version}` },
            ' to ',
            { strong: env.label },
            '. It needs a second approver before it can go out.',
          ],
        },
        {
          t: 'card',
          meta: [{ product: p }],
          title: `${p.name} ${d.version}`,
          href: link,
          pills: [
            { label: env.label, tone: env.tone },
            { label: 'Awaiting approval', tone: 'accent' },
          ],
          rows,
        },
        {
          t: 'button',
          href: link,
          label: 'Review deployment',
          secondary: { href: appLink(brand, '/deployments'), text: 'See all deployments' },
        },
        {
          t: 'muted',
          text: 'Deployments follow the two-person rule: the requester cannot approve their own release. Approving requires step-up verification and is recorded in the audit log.',
        },
      ],
      reason: `You received this email because you can approve deployments of ${p.name} in ${brand.name}.`,
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
  workspace?: string;
  timeZone?: string;
  now?: When;
}

export function offboardingStartedEmail(
  d: OffboardingStartedData,
  brand: Brand = brandDefault(),
): Mail {
  const lastDay = formatDay(d.lastDay, { timeZone: d.timeZone });
  const lastDayRel = formatDay(d.lastDay, { timeZone: d.timeZone, now: d.now ?? Date.now() });
  const link = appLink(brand, `/team/${encodeURIComponent(d.memberId)}`);
  if (d.audience === 'handover')
    return renderEmail(
      {
        category: 'offboarding-started',
        kind: 'notification',
        subject: `${d.memberName} is handing work over to you`,
        preheader: `${d.memberName}'s last day is ${lastDay}.`,
        eyebrow: { label: 'Handover' },
        hero: 'handover',
        workspace: d.workspace,
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
              ['Leaving', d.memberName],
              ['Last day', lastDayRel],
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
      eyebrow: { label: 'Offboarding' },
      hero: 'handover',
      workspace: d.workspace,
      heading: 'Your offboarding has started',
      greeting: d.name,
      blocks: [
        {
          t: 'p',
          text: `Your offboarding from ${d.workspace ?? brand.name} was started by ${d.startedByName}. Your access stays as it is until offboarding completes.`,
        },
        {
          t: 'facts',
          rows: [
            ['Last day', lastDayRel],
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

export function offboardingCompletedEmail(
  name: string,
  brand: Brand = brandDefault(),
  opts: { workspace?: string } = {},
): Mail {
  return renderEmail(
    {
      category: 'offboarding-completed',
      kind: 'account',
      noAccess: true,
      subject: `Your ${brand.name} access has ended`,
      preheader: 'Your offboarding is complete and your access has been removed.',
      eyebrow: { label: 'Offboarding complete' },
      hero: 'farewell',
      workspace: opts.workspace,
      heading: 'Your access has ended',
      greeting: name,
      blocks: [
        {
          t: 'p',
          text: `Your offboarding is complete and your ${brand.name} access has been removed. Your sessions, access grants and tokens no longer work. Thank you for your contributions.`,
        },
        {
          t: 'notice',
          tone: 'info',
          title: 'One last step',
          text: 'Please delete any remaining local copies of confidential information, as agreed in the NDA.',
        },
        {
          t: 'muted',
          text: [
            'Questions about your offboarding? Reply to this email or contact ',
            { href: `mailto:${brand.supportEmail}`, text: brand.supportEmail },
            '.',
          ],
        },
      ],
      reason: `You received this email because your ${brand.name} account was closed.`,
    },
    brand,
  );
}

// ─── digest ──────────────────────────────────────────────────────────────

export interface DigestItem {
  title: string;
  body: string;
  link: string;
  at?: string;
  /** Notification kind (`assignment`, `mention`, `doc-comment`, `approval`, `offboarding`, `security`). */
  kind?: string;
}

/** Digest groups in display order: title, HTML icon glyph, tone, the kinds it collects. */
const DIGEST_GROUPS: {
  key: string;
  title: string;
  one: string;
  glyph: string;
  tone: Tone;
  kinds: string[];
}[] = [
  {
    key: 'approval',
    title: 'Waiting for your approval',
    one: 'approval',
    glyph: '↑',
    tone: 'warn',
    kinds: ['approval'],
  },
  {
    key: 'assignment',
    title: 'Assigned to you',
    one: 'assignment',
    glyph: '✓',
    tone: 'accent',
    kinds: ['assignment'],
  },
  {
    key: 'mention',
    title: 'Mentions and comments',
    one: 'mention',
    glyph: '@',
    tone: 'info',
    kinds: ['mention', 'doc-comment'],
  },
  {
    key: 'offboarding',
    title: 'Handovers',
    one: 'handover',
    glyph: '→',
    tone: 'neutral',
    kinds: ['offboarding'],
  },
  {
    key: 'security',
    title: 'Security',
    one: 'security update',
    glyph: '!',
    tone: 'bad',
    kinds: ['security'],
  },
  { key: 'other', title: 'Other updates', one: 'update', glyph: '•', tone: 'neutral', kinds: [] },
];

export function digestEmail(
  name: string,
  items: DigestItem[],
  opts: {
    period?: 'daily' | 'weekly';
    timeZone?: string;
    workspace?: string;
    now?: When;
  } = {},
  brand: Brand = brandDefault(),
): Mail {
  const n = items.length;
  const label = opts.period === 'weekly' ? 'weekly' : opts.period === 'daily' ? 'daily' : '';
  const groups = DIGEST_GROUPS.map((g) => ({
    ...g,
    items: items.filter((i) =>
      g.key === 'other'
        ? !DIGEST_GROUPS.some((o) => o.kinds.includes(i.kind ?? ''))
        : g.kinds.includes(i.kind ?? ''),
    ),
  })).filter((g) => g.items.length);
  const summary = listing(groups.map((g) => plural(g.items.length, g.one)));
  const now = opts.now ?? Date.now();
  return renderEmail(
    {
      category: 'digest',
      kind: 'notification',
      subject: `You have ${n} unread ${brand.name} notification${n === 1 ? '' : 's'}`,
      preheader: summary
        ? `${summary.charAt(0).toUpperCase()}${summary.slice(1)}.`
        : `${n} unread notifications.`,
      eyebrow: {
        label: label
          ? `${label.charAt(0).toUpperCase()}${label.slice(1)} summary`
          : 'Unread notifications',
      },
      hero: 'digest',
      workspace: opts.workspace,
      heading: label ? `Your ${label} summary` : 'Your unread notifications',
      greeting: name,
      blocks: [
        {
          t: 'p',
          text: [
            `Here is what is waiting for you in ${opts.workspace ?? brand.name}: `,
            { strong: summary || plural(n, 'notification') },
            '.',
          ],
        },
        ...groups.map((g): Block => ({
          t: 'list',
          heading: { title: g.title, glyph: g.glyph, tone: g.tone, count: g.items.length },
          items: g.items.map((i) => ({
            title: i.title,
            body: i.body,
            href: i.link,
            meta: i.at ? formatRecent(i.at, opts.timeZone, now) : undefined,
          })),
        })),
        {
          t: 'button',
          href: appLink(brand, '/inbox'),
          label: 'Open your inbox',
          secondary: { href: appLink(brand, '/my-work'), text: 'See all your work' },
        },
      ],
      reason: `You received this summary because you have unread notifications in ${brand.name}.`,
    },
    brand,
  );
}
