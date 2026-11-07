/**
 * Mail entry point.
 *
 *   MAIL_TRANSPORT=console (default)  → logs a redacted copy (development)
 *   MAIL_TRANSPORT=smtp               → SMTP_HOST, SMTP_PORT (587), SMTP_USER,
 *                                       SMTP_PASSWORD, SMTP_FROM; optional
 *                                       SMTP_REQUIRE_TLS=0 for a local catch-all.
 *
 * Degrades gracefully: `smtp` without SMTP_HOST falls back to the console
 * transport with a warning instead of crashing. `sendMail` never throws —
 * callers (password recovery in particular) must not change their response
 * or timing based on delivery.
 */

import { config } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { smtpTransport } from './smtp.ts';
import { consoleTransport, maskEmail, type MailMessage, type MailTransport } from './transport.ts';

export type { MailMessage, MailTransport } from './transport.ts';
export { memoryTransport } from './transport.ts';

function fromEnv(): MailTransport {
  const kind = (process.env.MAIL_TRANSPORT ?? 'console').toLowerCase();
  if (kind !== 'smtp') return consoleTransport;
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
    from:
      process.env.SMTP_FROM ??
      `DevHQ <no-reply@${new URL(config.appOrigin).hostname.replace(/^localhost$/, 'devhq.local')}>`,
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
      subject: msg.subject,
      err: String((err as Error)?.message ?? err),
    });
    return false;
  }
}

export function mailStatus() {
  const t = mailTransport();
  return { transport: t.name, configured: t.name !== 'console' };
}
