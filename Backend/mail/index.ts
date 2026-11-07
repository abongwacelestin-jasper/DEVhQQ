/**
 * Mail entry point.
 *
 *   MAIL_TRANSPORT=console (default)  → logs a redacted copy (development)
 *   MAIL_TRANSPORT=resend             → Resend HTTPS API (mail/resend.ts):
 *                                       RESEND_API_KEY, MAIL_FROM, MAIL_REPLY_TO
 *   MAIL_TRANSPORT=smtp               → SMTP_HOST, SMTP_PORT (587), SMTP_USER,
 *                                       SMTP_PASSWORD, SMTP_FROM; optional
 *                                       SMTP_REQUIRE_TLS=0 for a local catch-all.
 *
 * Transport, sender and brand are parsed and validated in config/mail.ts
 * (production refuses to boot with `resend` and no key). Outside production
 * a missing key or SMTP_HOST falls back to the console transport with a
 * warning instead of crashing. `sendMail` never throws —
 * callers (password recovery in particular) must not change their response
 * or timing based on delivery.
 */

import { config } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { resendTransport } from './resend.ts';
import { smtpTransport } from './smtp.ts';
import { consoleTransport, maskEmail, type MailMessage, type MailTransport } from './transport.ts';

export type { MailCategory, MailMessage, MailTransport } from './transport.ts';
export { memoryTransport } from './transport.ts';

function fromEnv(): MailTransport {
  const mail = config.mail;
  for (const w of mail.warnings) logger.warn(`mail config: ${w}`);
  if (mail.transport === 'resend' && mail.resend.apiKey)
    return resendTransport({
      apiKey: mail.resend.apiKey,
      from: mail.from,
      replyTo: mail.replyTo,
      baseUrl: mail.resend.baseUrl,
      timeoutMs: mail.resend.timeoutMs,
    });
  if (mail.transport !== 'smtp') return consoleTransport;
  const host = process.env.SMTP_HOST;
  if (!host) {
    logger.warn('MAIL_TRANSPORT=smtp but SMTP_HOST is unset — using console transport');
    return consoleTransport;
  }
  return smtpTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER || undefined,
    password: process.env.SMTP_PASSWORD || undefined,
    from: process.env.SMTP_FROM ?? mail.from,
    requireTls: process.env.SMTP_REQUIRE_TLS !== '0',
  });
}

let transport: MailTransport | undefined;

export function mailTransport(): MailTransport {
  transport ??= fromEnv();
  return transport;
}

/** Test seam: install a transport (e.g. memoryTransport()). */
export function setMailTransport(t: MailTransport | undefined) {
  transport = t;
}

export async function sendMail(msg: MailMessage): Promise<boolean> {
  const t = mailTransport();
  try {
    await t.send(msg);
    return true;
  } catch (err) {
    logger.error('mail delivery failed', {
      transport: t.name,
      to: maskEmail(msg.to),
      category: msg.category,
      err: String((err as Error)?.message ?? err),
    });
    return false;
  }
}

export function mailStatus() {
  const t = mailTransport();
  return { transport: t.name, configured: t.name !== 'console' };
}
