/** Resend transport (stubbed fetch) and the fail-closed mail configuration. */
import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resendTransport, retryAfterMs, type ResendPayload } from '../../mail/resend.ts';
import { maskEmail, type MailMessage } from '../../mail/transport.ts';
import { sendMail, setMailTransport } from '../../mail/index.ts';
import { loadMailConfig, type MailEnv } from '../../config/mail.ts';

const KEY = 're_test_0123456789abcdef';
const MSG: MailMessage = {
  to: 'kofi@example.com',
  subject: 'New sign-in to your DevHQ account',
  html: '<p>html</p>',
  text: 'text',
  category: 'sign-in-alert',
  idempotencyKey: 'sign-in-alert/rec123',
};

interface Call {
  url: string;
  init: RequestInit;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** A fetch stub that answers with the queued responses in order and records each call. */
function stub(...answers: (Response | Error | 'hang')[]) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  const fetchStub = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const a = answers.shift() ?? json(500, { message: 'no more answers' });
    if (a === 'hang')
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    if (a instanceof Error) throw a;
    return a;
  }) as typeof fetch;
  const transport = resendTransport({
    apiKey: KEY,
    from: 'DevHQ <no-reply@mail.example.com>',
    replyTo: 'support@example.com',
    fetch: fetchStub,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    timeoutMs: 50,
  });
  return { calls, sleeps, transport };
}

const headers = (c: Call) => c.init.headers as Record<string, string>;
const body = (c: Call) => JSON.parse(String(c.init.body)) as ResendPayload;

describe('mail/resend — request', () => {
  it('POSTs the message to /emails with bearer auth, idempotency key and category tag', async () => {
    const { calls, transport } = stub(json(200, { id: 'em_1' }));
    await transport.send(MSG);
    assert.equal(calls.length, 1);
    const [c] = calls;
    assert.equal(c.url, 'https://api.resend.com/emails');
    assert.equal(c.init.method, 'POST');
    assert.equal(headers(c).Authorization, `Bearer ${KEY}`);
    assert.equal(headers(c)['Content-Type'], 'application/json');
    assert.equal(headers(c)['Idempotency-Key'], 'sign-in-alert/rec123');
    assert.ok(c.init.signal, 'every attempt has a timeout signal');
    const b = body(c);
    assert.equal(b.from, 'DevHQ <no-reply@mail.example.com>');
    assert.deepEqual(b.to, ['kofi@example.com']);
    assert.equal(b.subject, MSG.subject);
    assert.equal(b.html, MSG.html);
    assert.equal(b.text, MSG.text);
    assert.equal(b.reply_to, 'support@example.com');
    assert.deepEqual(b.tags, [
      { name: 'category', value: 'sign-in-alert' },
      { name: 'app', value: 'devhq' },
    ]);
    assert.equal(b.headers['X-Entity-Ref-ID'], 'sign-in-alert/rec123');
    assert.ok(!String(c.init.body).includes(KEY), 'the key is only in the header');
  });

  it('generates an idempotency key when the caller has none, unique per message', async () => {
    const { calls, transport } = stub(json(200, { id: 'a' }), json(200, { id: 'b' }));
    const { idempotencyKey: _drop, ...rest } = MSG;
    void _drop;
    await transport.send(rest);
    await transport.send(rest);
    const [k1, k2] = calls.map((c) => headers(c)['Idempotency-Key']);
    assert.match(k1, /^sign-in-alert\/[0-9a-f-]{36}$/);
    assert.notEqual(k1, k2);
  });

  it('strips CR/LF from the subject', async () => {
    const { calls, transport } = stub(json(200, {}));
    await transport.send({ ...MSG, subject: 'Hello\r\nBcc: x@evil.example' });
    assert.equal(body(calls[0]).subject, 'Hello Bcc: x@evil.example');
  });
});

describe('mail/resend — retries', () => {
  it('retries once on 429, waiting for Retry-After, with the same idempotency key', async () => {
    const { calls, sleeps, transport } = stub(
      json(
        429,
        { name: 'rate_limit_exceeded', message: 'Too many requests' },
        { 'Retry-After': '2' },
      ),
      json(200, { id: 'em_2' }),
    );
    await transport.send(MSG);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [2000]);
    assert.equal(headers(calls[0])['Idempotency-Key'], headers(calls[1])['Idempotency-Key']);
    assert.equal(calls[0].init.body, calls[1].init.body, 'identical payload on retry');
  });

  it('retries once on 5xx after a short delay', async () => {
    const { calls, sleeps, transport } = stub(json(503, { message: 'unavailable' }), json(200, {}));
    await transport.send(MSG);
    assert.equal(calls.length, 2);
    assert.deepEqual(sleeps, [500]);
  });

  it('gives up after the one retry', async () => {
    const { calls, transport } = stub(json(500, { message: 'a' }), json(502, { message: 'b' }));
    await assert.rejects(transport.send(MSG), /Resend: 502/);
    assert.equal(calls.length, 2);
  });

  for (const status of [400, 401, 403, 404, 422]) {
    it(`never retries a ${status}`, async () => {
      const { calls, sleeps, transport } = stub(
        json(status, { name: 'validation_error', message: 'The domain is not verified' }),
      );
      await assert.rejects(transport.send(MSG), new RegExp(`Resend: ${status} validation_error`));
      assert.equal(calls.length, 1);
      assert.deepEqual(sleeps, []);
    });
  }

  it('does not retry when Retry-After is longer than the wait budget', async () => {
    const { calls, transport } = stub(json(429, {}, { 'Retry-After': '120' }), json(200, {}));
    await assert.rejects(transport.send(MSG), /Resend: 429/);
    assert.equal(calls.length, 1);
  });

  it('times out a hung request and retries it once', async () => {
    const { calls, transport } = stub('hang', 'hang');
    await assert.rejects(transport.send(MSG), /timed out after 50 ms/);
    assert.equal(calls.length, 2);
  });

  it('retries a network error once', async () => {
    const { calls, transport } = stub(new Error('ECONNRESET'), json(200, {}));
    await transport.send(MSG);
    assert.equal(calls.length, 2);
  });

  it('errors never carry the API key or the full recipient', async () => {
    const { transport } = stub(
      json(401, { name: 'invalid_api_key', message: 'API key is invalid' }),
    );
    const err = await transport.send(MSG).catch((e: Error) => e);
    assert.ok(err instanceof Error);
    assert.ok(!err.message.includes(KEY));
    assert.ok(!err.message.includes(MSG.to));
  });

  it('sendMail never throws when Resend fails', async () => {
    const { transport } = stub(json(500, {}), json(500, {}));
    setMailTransport(transport);
    try {
      assert.equal(await sendMail(MSG), false);
    } finally {
      setMailTransport(undefined);
    }
  });

  it('parses Retry-After as seconds or an HTTP date', () => {
    assert.equal(retryAfterMs('3'), 3000);
    assert.equal(retryAfterMs('0.5'), 500);
    const now = Date.parse('2026-11-07T12:00:00Z');
    assert.equal(retryAfterMs('Sat, 07 Nov 2026 12:00:04 GMT', now), 4000);
    assert.equal(retryAfterMs('soon'), undefined);
    assert.equal(retryAfterMs(null), undefined);
  });

  it('masks recipients for logs', () => {
    assert.equal(maskEmail('kofi@example.com'), 'k***@example.com');
  });
});

describe('config/mail — fail closed', () => {
  const prod = { isProd: true, appOrigin: 'https://app.example.com' };
  const dev = { isProd: false, appOrigin: 'http://localhost:5173' };
  const resendProd: MailEnv = {
    MAIL_TRANSPORT: 'resend',
    RESEND_API_KEY: KEY,
    MAIL_FROM: 'DevHQ <no-reply@mail.example.com>',
  };

  it('refuses to boot in production with resend and no key', () => {
    assert.throws(
      () => loadMailConfig({ ...resendProd, RESEND_API_KEY: undefined }, prod),
      /RESEND_API_KEY .*required/,
    );
  });

  it('refuses to boot in production with resend and no MAIL_FROM', () => {
    assert.throws(
      () => loadMailConfig({ ...resendProd, MAIL_FROM: '' }, prod),
      /MAIL_FROM is required/,
    );
  });

  it('accepts a complete production configuration', () => {
    const c = loadMailConfig({ ...resendProd, MAIL_REPLY_TO: 'support@example.com' }, prod);
    assert.equal(c.transport, 'resend');
    assert.equal(c.resend.apiKey, KEY);
    assert.equal(c.from, 'DevHQ <no-reply@mail.example.com>');
    assert.equal(c.replyTo, 'support@example.com');
    assert.equal(c.brand.appUrl, 'https://app.example.com');
  });

  it('falls back to the console transport outside production, with a warning', () => {
    const c = loadMailConfig({ MAIL_TRANSPORT: 'resend' }, dev);
    assert.equal(c.transport, 'console');
    assert.ok(c.warnings.some((w) => w.includes('RESEND_API_KEY')));
  });

  it('reads the key from RESEND_API_KEY_FILE and refuses ambiguity', () => {
    const dir = mkdtempSync(join(tmpdir(), 'devhq-mail-'));
    const file = join(dir, 'resend_api_key');
    writeFileSync(file, `${KEY}\n`);
    const fromFile = loadMailConfig(
      { ...resendProd, RESEND_API_KEY: undefined, RESEND_API_KEY_FILE: file },
      prod,
    );
    assert.equal(fromFile.resend.apiKey, KEY);
    assert.throws(
      () => loadMailConfig({ ...resendProd, RESEND_API_KEY_FILE: file }, prod),
      /Both RESEND_API_KEY and RESEND_API_KEY_FILE/,
    );
    assert.throws(
      () =>
        loadMailConfig(
          { ...resendProd, RESEND_API_KEY: undefined, RESEND_API_KEY_FILE: join(dir, 'missing') },
          prod,
        ),
      /unreadable/,
    );
    writeFileSync(file, '');
    assert.throws(
      () =>
        loadMailConfig(
          { ...resendProd, RESEND_API_KEY: undefined, RESEND_API_KEY_FILE: file },
          prod,
        ),
      /RESEND_API_KEY .*required/,
      'an empty secret file means not configured',
    );
  });

  it('refuses an unknown transport in production', () => {
    assert.throws(() => loadMailConfig({ MAIL_TRANSPORT: 'sendgrid' }, prod), /MAIL_TRANSPORT/);
  });

  it('validates sender and reply-to addresses', () => {
    assert.throws(
      () =>
        loadMailConfig({ ...resendProd, MAIL_FROM: 'DevHQ <no-reply@x.com>\r\nBcc: a@b.co' }, prod),
      /MAIL_FROM/,
    );
    assert.throws(
      () => loadMailConfig({ ...resendProd, MAIL_FROM: 'not an address' }, prod),
      /MAIL_FROM/,
    );
    assert.throws(
      () => loadMailConfig({ ...resendProd, MAIL_REPLY_TO: 'a@b.co, c@d.co' }, prod),
      /MAIL_REPLY_TO/,
    );
  });

  it('validates brand colours', () => {
    const c = loadMailConfig({ BRAND_PRIMARY_COLOR: '#ABC', BRAND_ACCENT_COLOR: '#0E7490' }, dev);
    assert.equal(c.brand.primaryColor, '#aabbcc');
    assert.equal(c.brand.accentColor, '#0e7490');
    for (const bad of ['red', '#12345', 'rgb(0,0,0)', '#4f46e5;background:url(x)'])
      assert.throws(() => loadMailConfig({ BRAND_PRIMARY_COLOR: bad }, dev), /hex colour/);
  });

  it('requires https brand URLs in production but allows http in development', () => {
    for (const name of ['BRAND_LOGO_URL', 'BRAND_WEBSITE_URL', 'APP_URL'])
      assert.throws(
        () => loadMailConfig({ ...resendProd, [name]: 'http://example.com/logo.png' }, prod),
        new RegExp(`${name} must use https`),
      );
    const c = loadMailConfig({ BRAND_LOGO_URL: 'http://localhost:5173/logo.png' }, dev);
    assert.equal(c.brand.logoUrl, 'http://localhost:5173/logo.png');
    assert.throws(() => loadMailConfig({ BRAND_LOGO_URL: '/logo.png' }, dev), /absolute URL/);
    assert.throws(
      () => loadMailConfig({ BRAND_LOGO_URL: 'https://cdn.example.com/logo.webp' }, dev),
      /PNG or SVG/,
    );
    assert.throws(() => loadMailConfig({ BRAND_WEBSITE_URL: 'javascript:alert(1)' }, dev), /http/);
  });

  it('has sensible DevHQ defaults for development', () => {
    const c = loadMailConfig({}, dev);
    assert.equal(c.transport, 'console');
    assert.equal(c.brand.name, 'DevHQ');
    assert.equal(c.brand.appUrl, 'http://localhost:5173');
    assert.match(c.from, /^DevHQ <no-reply@devhq\.local>$/);
    assert.equal(c.brand.supportEmail, 'support@devhq.local');
  });
});
