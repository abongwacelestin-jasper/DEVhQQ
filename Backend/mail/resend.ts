/**
 * Resend transport: `POST {baseUrl}/emails` over HTTPS with native fetch (no
 * SDK, no new dependency).
 *
 *  - Bearer authentication with RESEND_API_KEY. The key never appears in logs
 *    or thrown errors.
 *  - Every attempt has a timeout (AbortController).
 *  - One retry, only when it is safe and useful: HTTP 429 or 5xx, a timeout or
 *    a network error. A 429 waits for `Retry-After` (seconds or HTTP date)
 *    when it fits the wait budget; otherwise the send fails rather than
 *    retrying into the same limit. Other 4xx responses (bad key, unverified
 *    domain, validation) are never retried.
 *  - The same `Idempotency-Key` is sent on both attempts, so a retry after a
 *    lost response cannot deliver the email twice.
 *  - The message category goes out as a Resend tag; recipients are masked in
 *    every log line.
 */

import { randomUUID } from 'node:crypto';
import { logger } from '../lib/logger.ts';
import { maskEmail, type MailMessage, type MailTransport } from './transport.ts';

export interface ResendOptions {
  apiKey: string;
  from: string;
  replyTo?: string;
  /** Default https://api.resend.com. */
  baseUrl?: string;
  /** Per attempt. Default 10 s. */
  timeoutMs?: number;
  /** Longest Retry-After the transport will wait before its one retry. Default 10 s. */
  maxRetryWaitMs?: number;
  /** Wait before retrying a 5xx / network failure without Retry-After. Default 500 ms. */
  retryDelayMs?: number;
  /** Test seams. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Shape of the JSON body sent to Resend (documented for tests and the docs). */
export interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
  tags: { name: string; value: string }[];
  headers: Record<string, string>;
}

export class ResendError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'ResendError';
    this.status = status;
    this.retryable = retryable;
  }
}

const TAG = /[^A-Za-z0-9_-]/g;

/** Parses `Retry-After` (delta-seconds or HTTP date) to milliseconds; undefined when absent or invalid. */
export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const v = header.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

export function resendPayload(
  msg: MailMessage,
  opts: Pick<ResendOptions, 'from' | 'replyTo'>,
  key: string,
): ResendPayload {
  return {
    from: opts.from,
    to: [msg.to],
    subject: msg.subject.replace(/[\r\n]+/g, ' ').trim(),
    html: msg.html,
    text: msg.text,
    ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    tags: [
      { name: 'category', value: (msg.category ?? 'uncategorized').replace(TAG, '_') },
      { name: 'app', value: 'devhq' },
    ],
    // A unique reference stops Gmail from threading unrelated alerts together.
    headers: { 'X-Entity-Ref-ID': key.slice(0, 200) },
  };
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { name?: unknown; message?: unknown };
    const parts = [body.name, body.message].filter((p) => typeof p === 'string');
    return parts.join(': ').slice(0, 300) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export function resendTransport(opts: ResendOptions): MailTransport {
  if (!opts.apiKey) throw new Error('Resend transport needs an API key');
  const base = (opts.baseUrl ?? 'https://api.resend.com').replace(/\/$/, '');
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxWait = opts.maxRetryWaitMs ?? 10_000;
  const retryDelay = opts.retryDelayMs ?? 500;
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function attempt(body: string, key: string): Promise<{ id?: string }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${base}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': key,
          'User-Agent': 'devhq-mail/1',
        },
        body,
        signal: ctl.signal,
      });
    } catch (err) {
      const timedOut = ctl.signal.aborted;
      throw Object.assign(
        new ResendError(
          timedOut ? `Resend: timed out after ${timeoutMs} ms` : 'Resend: network error',
          0,
          true,
        ),
        { cause: timedOut ? undefined : err },
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) {
      try {
        return (await res.json()) as { id?: string };
      } catch {
        return {};
      }
    }
    const retryable = res.status === 429 || res.status >= 500;
    const err = new ResendError(
      `Resend: ${res.status} ${await errorMessage(res)}`,
      res.status,
      retryable,
    );
    throw Object.assign(err, { retryAfter: retryAfterMs(res.headers.get('retry-after')) });
  }

  return {
    name: 'resend',
    async send(msg) {
      const key = (msg.idempotencyKey ?? `${msg.category ?? 'mail'}/${randomUUID()}`).slice(0, 256);
      const body = JSON.stringify(resendPayload(msg, opts, key));
      const log = { to: maskEmail(msg.to), category: msg.category };
      let result: { id?: string };
      try {
        result = await attempt(body, key);
      } catch (first) {
        const e = first as ResendError & { retryAfter?: number };
        if (!(e instanceof ResendError) || !e.retryable) throw e;
        const wait = e.retryAfter ?? (e.status === 429 ? 1_000 : retryDelay);
        if (wait > maxWait) throw e;
        logger.warn('mail: Resend attempt failed, retrying once', {
          ...log,
          status: e.status,
          waitMs: wait,
        });
        await sleep(wait);
        result = await attempt(body, key);
      }
      logger.info('mail sent', { transport: 'resend', ...log, id: result.id });
    },
  };
}
