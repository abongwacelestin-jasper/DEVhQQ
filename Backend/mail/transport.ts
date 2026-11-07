/**
 * Mail transport interface and the development `console` transport.
 *
 * The console transport never prints a usable secret: single-use tokens in
 * links are redacted, and recipients are partially masked, so dev logs can be
 * shared without handing out password-reset links.
 */

import { logger } from '../lib/logger.ts';

/**
 * Category of a message: tagged at the provider (Resend `tags`) so bounces,
 * complaints and volume can be read per email type. Lower-case, `[a-z0-9-]`.
 */
export type MailCategory =
  | 'invite'
  | 'password-reset'
  | 'password-changed'
  | 'sign-in-alert'
  | 'mfa-enrolled'
  | 'backup-codes-generated'
  | 'backup-code-used'
  | 'account-locked'
  | 'access-request'
  | 'task-assigned'
  | 'incident'
  | 'deployment-approval'
  | 'offboarding-started'
  | 'offboarding-completed'
  | 'digest';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  category?: MailCategory;
  /**
   * Deduplicates provider-side retries of the same logical message (Resend
   * `Idempotency-Key`, kept 24 h). Derived from the event (e.g. the sign-in
   * record id) when one exists; otherwise the transport generates one per send.
   */
  idempotencyKey?: string;
}

export interface MailTransport {
  readonly name: 'console' | 'smtp' | 'resend' | 'memory';
  send(msg: MailMessage): Promise<void>;
}

/** Replaces token/code query values so logged links can't be replayed. */
export function redactSecrets(s: string): string {
  return s.replace(/([?&](?:token|code|key)=)[^&\s"'<>]+/gi, '$1[redacted]');
}

export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

export const consoleTransport: MailTransport = {
  name: 'console',
  async send(msg) {
    logger.info('mail (console transport)', {
      to: maskEmail(msg.to),
      subject: msg.subject,
      category: msg.category,
      text: redactSecrets(msg.text).slice(0, 2_000),
    });
  },
};

/** Collects messages in memory — for tests only, never selected from configuration. */
export function memoryTransport(): MailTransport & { outbox: MailMessage[] } {
  const outbox: MailMessage[] = [];
  return {
    name: 'memory',
    outbox,
    async send(msg) {
      outbox.push(msg);
    },
  };
}
