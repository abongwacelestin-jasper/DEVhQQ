/**
 * Transactional email templates. Every interpolated value is HTML-escaped in
 * the HTML part (names and notification excerpts are user-controlled), and
 * every message carries a plain-text alternative. Links are built only from
 * APP_ORIGIN plus fixed paths — never from request headers (Host-header
 * poisoning would otherwise let an attacker receive reset tokens).
 */

import type { MailMessage } from './transport.ts';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111827">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px">
<tr><td style="padding:24px">${bodyHtml}
<p style="margin-top:32px;font-size:12px;color:#6b7280">DevHQ · This is an automated message.</p></td></tr></table></body></html>`;
}

function button(href: string, label: string) {
  return `<p><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 16px;background:#111827;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a></p>`;
}

type Mail = Omit<MailMessage, 'to'>;

export function recoveryEmail(name: string, link: string, minutes: number): Mail {
  const subject = 'Reset your DevHQ password';
  return {
    subject,
    text: `Hi ${name},\n\nSomeone asked to reset the password for your DevHQ account. If it was you, open this single-use link within ${minutes} minutes:\n\n${link}\n\nIf you didn't ask, ignore this email — your password stays the same.\n`,
    html: layout(
      subject,
      `<p>Hi ${escapeHtml(name)},</p><p>Someone asked to reset the password for your DevHQ account. If it was you, use this single-use link within ${minutes} minutes:</p>${button(link, 'Choose a new password')}<p style="font-size:13px;color:#6b7280">If you didn't ask, ignore this email — your password stays the same.</p>`,
    ),
  };
}

export function passwordChangedEmail(name: string, ip: string, at: string): Mail {
  const subject = 'Your DevHQ password was changed';
  return {
    subject,
    text: `Hi ${name},\n\nYour DevHQ password was changed at ${at} from ${ip}. Every session was signed out.\n\nIf this wasn't you, contact a workspace Owner immediately.\n`,
    html: layout(
      subject,
      `<p>Hi ${escapeHtml(name)},</p><p>Your DevHQ password was changed at <b>${escapeHtml(at)}</b> from <b>${escapeHtml(ip)}</b>. Every session was signed out.</p><p>If this wasn't you, contact a workspace Owner immediately.</p>`,
    ),
  };
}

export function digestEmail(
  name: string,
  items: { title: string; body: string; link: string }[],
): Mail {
  const subject = `You have ${items.length} unread DevHQ notification${items.length === 1 ? '' : 's'}`;
  return {
    subject,
    text: `Hi ${name},\n\n${items.map((i) => `• ${i.title}\n  ${i.body}\n  ${i.link}`).join('\n\n')}\n`,
    html: layout(
      subject,
      `<p>Hi ${escapeHtml(name)},</p><ul style="padding-left:18px">${items
        .map(
          (i) =>
            `<li style="margin-bottom:12px"><a href="${escapeHtml(i.link)}">${escapeHtml(i.title)}</a><br><span style="color:#4b5563">${escapeHtml(i.body)}</span></li>`,
        )
        .join('')}</ul>`,
    ),
  };
}

export function offboardingCompletedEmail(name: string): Mail {
  const subject = 'Your DevHQ access has ended';
  return {
    subject,
    text: `Hi ${name},\n\nYour offboarding is complete and your DevHQ access has been removed. Thank you for your contributions.\n\nPlease delete any remaining local copies of confidential information as agreed in the NDA.\n`,
    html: layout(
      subject,
      `<p>Hi ${escapeHtml(name)},</p><p>Your offboarding is complete and your DevHQ access has been removed. Thank you for your contributions.</p><p>Please delete any remaining local copies of confidential information as agreed in the NDA.</p>`,
    ),
  };
}
