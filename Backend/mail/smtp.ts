/**
 * Minimal, dependency-free SMTP client (RFC 5321) over node:net / node:tls.
 *
 * Why not nodemailer? The backend has zero runtime dependencies on purpose
 * (supply-chain surface), and transactional mail needs only a small subset:
 * EHLO → STARTTLS (RFC 3207) → AUTH PLAIN/LOGIN (RFC 4954) → MAIL/RCPT/DATA.
 *
 * Security properties:
 *  - TLS is required by default: implicit TLS on port 465, otherwise STARTTLS
 *    must be advertised or the send fails (no silent plaintext downgrade).
 *    `requireTls: false` exists only for local catch-all servers (Mailpit).
 *  - AUTH is only attempted over TLS unless TLS was explicitly waived.
 *  - Certificates are verified (rejectUnauthorized stays on).
 *  - Header injection is impossible: addresses are validated and every header
 *    value is stripped of CR/LF; bodies are base64-encoded, so no line can
 *    start with "." and no dot-stuffing edge cases exist.
 */

import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect, type TLSSocket } from 'node:tls';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import type { MailMessage, MailTransport } from './transport.ts';

export interface SmtpOptions {
  host: string;
  port: number;
  user?: string;
  password?: string;
  /** RFC 5322 From, e.g. `TavetaHQ <no-reply@tavetahq.io>`. */
  from: string;
  /** Default true. Only disable for a local development catch-all server. */
  requireTls?: boolean;
  timeoutMs?: number;
  /** Extra TLS options (tests may pass a CA). Verification is never disabled here. */
  ca?: string | Buffer;
}

interface Reply {
  code: number;
  lines: string[];
}

const ADDRESS = /^[^\s@<>()",;:\\[\]]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function envelopeAddress(from: string): string {
  const m = /<([^<>]+)>\s*$/.exec(from);
  const addr = (m ? m[1] : from).trim();
  if (!ADDRESS.test(addr)) throw new Error('SMTP: invalid address');
  return addr;
}

function headerValue(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}

function encodeHeader(s: string): string {
  const clean = headerValue(s);
  return /^[\x20-\x7e]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function base64Lines(s: string): string {
  return (
    Buffer.from(s, 'utf8')
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join('\r\n') ?? ''
  );
}

/** Builds a multipart/alternative RFC 5322 message (text first, HTML preferred). */
export function buildMime(msg: MailMessage, from: string): string {
  const boundary = `devhq-${randomBytes(12).toString('hex')}`;
  const domain = envelopeAddress(from).split('@')[1];
  const headers = [
    `From: ${headerValue(from)}`,
    `To: <${envelopeAddress(msg.to)}>`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(16).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const part = (type: string, body: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=utf-8`,
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(body),
    ].join('\r\n');
  return [
    headers.join('\r\n'),
    '',
    part('text/plain', msg.text),
    part('text/html', msg.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Incremental SMTP reply parser (handles multi-line `250-…` replies). */
class ReplyReader {
  private buf = '';
  private lines: string[] = [];
  private ready: Reply[] = [];
  private waiting: { resolve: (r: Reply) => void; reject: (e: Error) => void }[] = [];
  private failed?: Error;

  feed(chunk: Buffer) {
    this.buf += chunk.toString('utf8');
    let i: number;
    while ((i = this.buf.indexOf('\r\n')) >= 0) {
      const line = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      this.lines.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const reply = { code: Number(line.slice(0, 3)), lines: this.lines.map((l) => l.slice(4)) };
        this.lines = [];
        const w = this.waiting.shift();
        if (w) w.resolve(reply);
        else this.ready.push(reply);
      }
    }
    if (this.buf.length > 64 * 1024) this.fail(new Error('SMTP: reply too long'));
  }

  fail(err: Error) {
    this.failed ??= err;
    for (const w of this.waiting.splice(0)) w.reject(err);
  }

  next(): Promise<Reply> {
    const r = this.ready.shift();
    if (r) return Promise.resolve(r);
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }
}

function once(sock: Socket | TLSSocket, event: 'connect' | 'secureConnect'): Promise<void> {
  return new Promise((resolve, reject) => {
    sock.once(event, () => resolve());
    sock.once('error', reject);
  });
}

export function smtpTransport(opts: SmtpOptions): MailTransport {
  const requireTls = opts.requireTls !== false;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const implicitTls = opts.port === 465;

  return {
    name: 'smtp',
    async send(msg) {
      const from = envelopeAddress(opts.from);
      const to = envelopeAddress(msg.to);
      const data = buildMime(msg, opts.from);

      let sock: Socket | TLSSocket = implicitTls
        ? tlsConnect({ host: opts.host, port: opts.port, servername: opts.host, ca: opts.ca })
        : netConnect({ host: opts.host, port: opts.port });
      let secure = implicitTls;
      let reader = new ReplyReader();
      const attach = (s: Socket | TLSSocket, r: ReplyReader) => {
        s.setTimeout(timeoutMs, () => s.destroy(new Error('SMTP: timeout')));
        s.on('data', (c: Buffer) => r.feed(c));
        s.on('error', (e: Error) => r.fail(e));
        s.on('close', () => r.fail(new Error('SMTP: connection closed')));
      };

      try {
        await once(sock, implicitTls ? 'secureConnect' : 'connect');
        attach(sock, reader);
        const expect = async (codes: number[], line?: string): Promise<Reply> => {
          if (line !== undefined) sock.write(`${line}\r\n`);
          const reply = await reader.next();
          if (!codes.includes(reply.code))
            throw new Error(
              `SMTP: unexpected ${reply.code} after ${line?.split(' ')[0] ?? 'greeting'}`,
            );
          return reply;
        };

        await expect([220]);
        const helo = `EHLO ${hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost'}`;
        let ehlo = await expect([250], helo);
        const has = (r: Reply, ext: string) => r.lines.some((l) => l.toUpperCase().startsWith(ext));

        if (!secure && has(ehlo, 'STARTTLS')) {
          await expect([220], 'STARTTLS');
          sock.removeAllListeners('data');
          sock.removeAllListeners('close');
          sock.removeAllListeners('error');
          sock.on('error', () => undefined);
          const upgraded = tlsConnect({ socket: sock, servername: opts.host, ca: opts.ca });
          await once(upgraded, 'secureConnect');
          sock = upgraded;
          secure = true;
          reader = new ReplyReader();
          attach(sock, reader);
          ehlo = await expect([250], helo);
        }
        if (!secure && requireTls)
          throw new Error('SMTP: server does not offer STARTTLS and TLS is required');

        if (opts.user) {
          const auth = ehlo.lines.find((l) => l.toUpperCase().startsWith('AUTH'))?.toUpperCase();
          const pass = opts.password ?? '';
          if (auth?.includes('PLAIN')) {
            const cred = Buffer.from(`\0${opts.user}\0${pass}`, 'utf8').toString('base64');
            await expect([235], `AUTH PLAIN ${cred}`);
          } else if (auth?.includes('LOGIN')) {
            await expect([334], 'AUTH LOGIN');
            await expect([334], Buffer.from(opts.user, 'utf8').toString('base64'));
            await expect([235], Buffer.from(pass, 'utf8').toString('base64'));
          } else {
            throw new Error('SMTP: server offers no supported AUTH mechanism');
          }
        }

        await expect([250], `MAIL FROM:<${from}>`);
        await expect([250, 251], `RCPT TO:<${to}>`);
        await expect([354], 'DATA');
        await expect([250], `${data}\r\n.`);
        await expect([221], 'QUIT').catch(() => undefined);
      } finally {
        sock.destroy();
      }
    },
  };
}
