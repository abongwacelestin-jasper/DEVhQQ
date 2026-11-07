/**
 * Every template filled with realistic sample data. Used by the preview tool
 * (scripts/mail-preview.ts) and by the template tests, which pass hostile
 * values through `person` and `title` to prove that everything is escaped.
 */

import type { Brand } from '../config/mail.ts';
import type { RenderedEmail } from './layout.ts';
import {
  accessRequestEmail,
  accountLockedEmail,
  backupCodeUsedEmail,
  backupCodesGeneratedEmail,
  deploymentApprovalEmail,
  digestEmail,
  factorChangedEmail,
  incidentEmail,
  inviteEmail,
  offboardingCompletedEmail,
  offboardingStartedEmail,
  passwordChangedEmail,
  recoveryEmail,
  signInAlertEmail,
  taskAssignedEmail,
} from './templates.ts';

export interface SampleOptions {
  /** Recipient and actor names (user-controlled in real life). */
  person?: string;
  /** Task, incident and notification titles (user-controlled in real life). */
  title?: string;
  /** Fixed "now" so previews are stable. */
  now?: Date;
}

export function sampleEmails(
  brand: Brand,
  opts: SampleOptions = {},
): Record<string, RenderedEmail> {
  const now = opts.now ?? new Date('2026-11-07T14:03:00Z');
  const iso = (offsetMin = 0) => new Date(now.getTime() + offsetMin * 60_000).toISOString();
  const person = opts.person ?? 'Kofi Mensah';
  const actor = opts.person ?? 'Amara Okafor';
  const title = opts.title ?? 'Card payments fail for EU customers after 3-D Secure redirect';
  const tz = 'Africa/Lagos';
  const ctx = {
    at: iso(),
    ip: '102.89.34.17',
    location: 'Lagos, Nigeria',
    device: 'Chrome on macOS',
    timeZone: tz,
  };
  const link = (path: string) => `${brand.appUrl}${path}`;

  return {
    invite: inviteEmail(
      {
        inviteeName: person,
        inviteeEmail: 'kofi.mensah@example.com',
        inviterName: actor,
        role: 'Developer',
        products: ['Renewberry', 'Blog'],
        expiresAt: iso(7 * 24 * 60),
        link: link('/accept-invite?token=sample-invite-token-not-real'),
      },
      brand,
    ),
    'password-reset': recoveryEmail(
      person,
      link('/reset-password?token=sample-reset-token-not-real'),
      30,
      { at: ctx.at, ip: ctx.ip, location: ctx.location, timeZone: tz },
      brand,
    ),
    'password-changed': passwordChangedEmail(
      person,
      ctx.ip,
      ctx.at,
      { location: ctx.location, device: ctx.device, timeZone: tz },
      brand,
    ),
    'sign-in-alert': signInAlertEmail(
      { ...ctx, name: person, method: 'Password and two-step verification' },
      brand,
    ),
    'authenticator-enrolled': factorChangedEmail(
      { ...ctx, name: person, factor: 'authenticator app', replaced: false },
      brand,
    ),
    'authenticator-replaced': factorChangedEmail(
      { ...ctx, name: person, factor: 'authenticator app', replaced: true },
      brand,
    ),
    'passkey-added': factorChangedEmail(
      { ...ctx, name: person, factor: 'passkey', replaced: false, label: 'MacBook Touch ID' },
      brand,
    ),
    'backup-codes-generated': backupCodesGeneratedEmail(
      { ...ctx, name: person, count: 10, replaced: 4 },
      brand,
    ),
    'backup-code-used': backupCodeUsedEmail(
      { ...ctx, name: person, remaining: 2, total: 10 },
      brand,
    ),
    'account-locked': accountLockedEmail(
      { ...ctx, name: person, attempts: 5, until: iso(15) },
      brand,
    ),
    'access-request': accessRequestEmail(
      {
        adminName: actor,
        requesterName: person,
        requesterEmail: 'kofi.mensah@example.com',
        requesterRole: 'Developer',
        memberId: 'm4',
        path: '/audit',
        reason: opts.title ?? 'I need to review the audit trail for the payments incident.',
        at: ctx.at,
        timeZone: tz,
      },
      brand,
    ),
    'task-assigned': taskAssignedEmail(
      {
        name: person,
        taskKey: 'RB-142',
        title,
        actorName: actor,
        product: 'Renewberry',
        priority: 'high',
        status: 'todo',
        due: '2026-11-14',
      },
      brand,
    ),
    'review-requested': taskAssignedEmail(
      {
        name: person,
        taskKey: 'RB-139',
        title,
        actorName: actor,
        as: 'reviewer',
        product: 'Renewberry',
      },
      brand,
    ),
    'incident-assigned': incidentEmail(
      {
        name: person,
        id: 'INC-27',
        title,
        severity: 'SEV1',
        status: 'investigating',
        product: 'Renewberry',
        service: 'renewberry-api',
        impact: 'About 18% of EU card checkouts fail at the bank redirect.',
        startedAt: iso(-12),
        declaredBy: actor,
        owner: true,
        timeZone: tz,
      },
      brand,
    ),
    'incident-declared': incidentEmail(
      {
        name: person,
        id: 'INC-27',
        title,
        severity: 'SEV1',
        status: 'investigating',
        product: 'Renewberry',
        service: 'renewberry-api',
        impact: 'About 18% of EU card checkouts fail at the bank redirect.',
        startedAt: iso(-12),
        declaredBy: 'Automated monitoring',
        owner: false,
        timeZone: tz,
      },
      brand,
    ),
    'deployment-approval': deploymentApprovalEmail(
      {
        name: person,
        deploymentId: 'dep-311',
        product: 'Renewberry',
        version: 'v2.14.0',
        env: 'production',
        requesterName: actor,
        requestedAt: iso(-3),
        commit: '9f3c2a1b7d4e',
        timeZone: tz,
      },
      brand,
    ),
    'offboarding-started': offboardingStartedEmail(
      {
        audience: 'member',
        name: person,
        memberId: 'm4',
        memberName: person,
        lastDay: '2026-11-28',
        handoverName: 'Ines Duarte',
        startedByName: actor,
      },
      brand,
    ),
    'offboarding-handover': offboardingStartedEmail(
      {
        audience: 'handover',
        name: 'Ines Duarte',
        memberId: 'm4',
        memberName: person,
        lastDay: '2026-11-28',
        handoverName: 'Ines Duarte',
        startedByName: actor,
      },
      brand,
    ),
    'offboarding-completed': offboardingCompletedEmail(person, brand),
    'digest-daily': digestEmail(
      person,
      [
        {
          title: `RB-142 assigned to you`,
          body: title,
          link: link('/tasks/RB-142'),
          at: iso(-300),
        },
        {
          title: `${actor} mentioned you in #payments`,
          body: 'Can you confirm the retry window before we ship the fix?',
          link: link('/messages'),
          at: iso(-180),
        },
        {
          title: 'Approval needed: renewberry v2.14.0 → production',
          body: `Requested by ${actor}`,
          link: link('/deployments'),
          at: iso(-60),
        },
      ],
      { period: 'daily', timeZone: tz },
      brand,
    ),
  };
}

/** Brand used by previews and tests when the environment has none configured. */
export function sampleBrand(base: Brand): Brand {
  return {
    ...base,
    postalAddress: base.postalAddress || '100 Example Street, Suite 400, Example City, EX 00000',
  };
}
