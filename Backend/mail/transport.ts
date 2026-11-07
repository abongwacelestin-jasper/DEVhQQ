/**
 * Mail transport interface and the development `console` transport.
 *
 * The console transport never prints a usable secret: single-use tokens in
 * links are redacted, and recipients are partially masked, so dev logs can be
 * shared without handing out password-reset links.
 */

import { logger } from '../lib/logger.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  readonly name: 'console' | 'smtp' | 'memory';
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
