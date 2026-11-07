/** Cloudflare Turnstile: siteverify client (stubbed fetch), the route guard, and fail-closed config. */
import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ctx } from '../../lib/http.ts';
import { HttpError } from '../../types.ts';
import { audit } from '../../audit/auditLog.ts';
import { loadTurnstileConfig, type TurnstileConfig } from '../../config/turnstile.ts';
import {
  REPLAY_TTL_MS,
  SITEVERIFY_URL,
  createTurnstileVerifier,
  isCliClient,
  turnstileGuard,
} from '../../security/turnstile.ts';

const SECRET = '0x4AAAAAAAtestsecretvalue0123456789';
const SITE = '0x4AAAAAAAtestsitekey01';
const HOST = 'app.devhq.example';
const TOKEN = 'tok.0123456789abcdef.ABCDEF';

interface Call {
  url: string;
  body: Record<string, unknown>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Answers with the queued responses in order and records each call. */
function stub(...answers: (Response | Error | 'hang')[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const a = answers.shift() ?? new Error('no more answers');
    if (a === 'hang')
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    if (a instanceof Error) throw a;
    return a;
  };
  return { fetch, calls };
}

const pass = (over: Record<string, unknown> = {}) =>
  json(200, { success: true, hostname: HOST, action: 'sign-in', 'error-codes': [], ...over });

const cfg = { secretKey: SECRET, expectedHostname: HOST, testKeys: false };

describe('turnstile siteverify client', () => {
  it('accepts a valid token and sends secret, token, remote IP and an idempotency key', async () => {
    const s = stub(pass());
    const v = createTurnstileVerifier(cfg, { fetch: s.fetch });
    assert.deepEqual(await v.verify(TOKEN, { action: 'sign-in', remoteIp: '203.0.113.9' }), {
      ok: true,
    });
    assert.equal(s.calls.length, 1);
    assert.equal(s.calls[0].url, SITEVERIFY_URL);
    assert.equal(s.calls[0].body.secret, SECRET);
    assert.equal(s.calls[0].body.response, TOKEN);
    assert.equal(s.calls[0].body.remoteip, '203.0.113.9');
    assert.match(String(s.calls[0].body.idempotency_key), /^[0-9a-f-]{36}$/);
  });

  it('rejects success:false with the error codes', async () => {
    const s = stub(json(200, { success: false, 'error-codes': ['invalid-input-response'] }));
    const v = createTurnstileVerifier(cfg, { fetch: s.fetch });
    assert.deepEqual(await v.verify(TOKEN, { action: 'sign-in' }), {
      ok: false,
      reason: 'invalid',
      errorCodes: ['invalid-input-response'],
    });
  });

  it('rejects a token issued on another hostname', async () => {
    const v = createTurnstileVerifier(cfg, {
      fetch: stub(pass({ hostname: 'evil.example' })).fetch,
    });
    assert.deepEqual(await v.verify(TOKEN, { action: 'sign-in' }), {
      ok: false,
      reason: 'hostname',
    });
  });

  it('rejects a token minted for another form (action mismatch)', async () => {
    const v = createTurnstileVerifier(cfg, { fetch: stub(pass({ action: 'recover' })).fetch });
    assert.deepEqual(await v.verify(TOKEN, { action: 'sign-in' }), { ok: false, reason: 'action' });
    const v2 = createTurnstileVerifier(cfg, { fetch: stub(pass({ action: undefined })).fetch });
    assert.deepEqual(await v2.verify(TOKEN, { action: 'accept-invite' }), {
      ok: false,
      reason: 'action',
    });
  });

  it('refuses a replayed token within 5 minutes without asking Cloudflare, and forgets it after', async () => {
    let now = 1_000_000;
    const s = stub(pass(), pass());
    const v = createTurnstileVerifier(cfg, { fetch: s.fetch, now: () => now });
    assert.equal((await v.verify(TOKEN, { action: 'sign-in' })).ok, true);
    now += REPLAY_TTL_MS - 1;
    assert.deepEqual(await v.verify(TOKEN, { action: 'sign-in' }), { ok: false, reason: 'replay' });
    assert.equal(s.calls.length, 1, 'a replay never reaches siteverify');
    now += 2;
    assert.equal((await v.verify(TOKEN, { action: 'sign-in' })).ok, true, 'TTL elapsed');
    assert.equal(s.calls.length, 2);
  });

  it('keeps the replay set bounded', async () => {
    const answers = Array.from({ length: 5 }, () => pass());
    const v = createTurnstileVerifier(cfg, { fetch: stub(...answers).fetch, maxSeen: 3 });
    for (let i = 0; i < 5; i++) await v.verify(`${TOKEN}${i}`, { action: 'sign-in' });
    assert.ok(v.seenCount() <= 3, String(v.seenCount()));
  });

  it('times out after the budget → unavailable', async () => {
    const v = createTurnstileVerifier(cfg, { fetch: stub('hang').fetch, timeoutMs: 50 });
    const t0 = Date.now();
    assert.deepEqual(await v.verify(TOKEN, { action: 'sign-in' }), {
      ok: false,
      reason: 'unavailable',
    });
    assert.ok(Date.now() - t0 < 2000);
  });

  it('retries once on a network error or 5xx with the same idempotency key', async () => {
    const s = stub(new Error('ECONNRESET'), pass());
    const v = createTurnstileVerifier(cfg, { fetch: s.fetch });
    assert.equal((await v.verify(TOKEN, { action: 'sign-in' })).ok, true);
    assert.equal(s.calls.length, 2);
    assert.equal(s.calls[0].body.idempotency_key, s.calls[1].body.idempotency_key);

    const s2 = stub(json(502, {}), json(503, {}));
    const v2 = createTurnstileVerifier(cfg, { fetch: s2.fetch });
    assert.deepEqual(await v2.verify(TOKEN, { action: 'sign-in' }), {
      ok: false,
      reason: 'unavailable',
    });
    assert.equal(s2.calls.length, 2);
  });

  it('treats Cloudflare internal-error as unavailable, and rejects malformed tokens locally', async () => {
    const v = createTurnstileVerifier(cfg, {
      fetch: stub(json(200, { success: false, 'error-codes': ['internal-error'] })).fetch,
    });
    assert.deepEqual(await v.verify(TOKEN, { action: 'sign-in' }), {
      ok: false,
      reason: 'unavailable',
    });
    const none = stub();
    const v2 = createTurnstileVerifier(cfg, { fetch: none.fetch });
    for (const bad of ['x'.repeat(2049), 'has space', 'new\nline'])
      assert.deepEqual(await v2.verify(bad, { action: 'sign-in' }), {
        ok: false,
        reason: 'malformed',
      });
    assert.equal(none.calls.length, 0);
  });

  it('accepts test-key results only when configured with test keys', async () => {
    const testResult = () =>
      json(200, {
        success: true,
        hostname: 'example.com',
        'error-codes': [],
        metadata: { result_with_testing_key: true },
      });
    const real = createTurnstileVerifier(cfg, { fetch: stub(testResult()).fetch });
    assert.deepEqual(await real.verify(TOKEN, { action: 'sign-in' }), {
      ok: false,
      reason: 'invalid',
    });
    const test = createTurnstileVerifier(
      { ...cfg, testKeys: true },
      { fetch: stub(testResult(), testResult()).fetch },
    );
    const dummy = 'XXXX.DUMMY.TOKEN.XXXX';
    assert.deepEqual(await test.verify(dummy, { action: 'sign-in' }), { ok: true, testing: true });
    // The fixed dummy token is reused by every test widget, so replay cannot apply here.
    assert.equal((await test.verify(dummy, { action: 'sign-in' })).ok, true);
  });
});

// ---------------------------------------------------------------------------
// Route guard
// ---------------------------------------------------------------------------

const ON: TurnstileConfig = {
  mode: 'on',
  siteKey: SITE,
  secretKey: SECRET,
  failOpen: false,
  exemptCli: true,
  expectedHostname: HOST,
  testKeys: false,
  warnings: [],
};

function ctx(headers: Record<string, string>, body: unknown): Ctx {
  return {
    req: { headers },
    body,
    ip: '203.0.113.7',
    requestId: 'req-test',
  } as unknown as Ctx;
}

const BROWSER = { origin: 'https://app.devhq.example', 'sec-fetch-site': 'same-origin' };
const CLI = { 'x-devhq-client': 'cli' };

async function run(guard: ReturnType<typeof turnstileGuard>, c: Ctx) {
  let reached = false;
  try {
    await guard(c, async () => {
      reached = true;
    });
    return { reached, status: 200, code: 'ok' };
  } catch (e) {
    assert.ok(e instanceof HttpError, String(e));
    return { reached, status: e.status, code: e.code };
  }
}

describe('turnstile route guard', () => {
  it('is a no-op while the mode is off', async () => {
    const v = createTurnstileVerifier(cfg, { fetch: stub().fetch });
    const r = await run(turnstileGuard('sign-in', { ...ON, mode: 'off' }, v), ctx(BROWSER, {}));
    assert.deepEqual(r, { reached: true, status: 200, code: 'ok' });
  });

  it('400 turnstile_required without a token; 403 turnstile_failed for a rejected one', async () => {
    const v = createTurnstileVerifier(cfg, {
      fetch: stub(json(200, { success: false, 'error-codes': ['invalid-input-response'] })).fetch,
    });
    const g = turnstileGuard('sign-in', ON, v);
    assert.deepEqual(await run(g, ctx(BROWSER, { email: 'a@b.co' })), {
      reached: false,
      status: 400,
      code: 'turnstile_required',
    });
    assert.deepEqual(await run(g, ctx(BROWSER, { turnstileToken: TOKEN })), {
      reached: false,
      status: 403,
      code: 'turnstile_failed',
    });
  });

  it('passes a verified token through to the handler', async () => {
    const v = createTurnstileVerifier(cfg, { fetch: stub(pass({ action: 'recover' })).fetch });
    const r = await run(turnstileGuard('recover', ON, v), ctx(BROWSER, { turnstileToken: TOKEN }));
    assert.equal(r.reached, true);
  });

  it('fails closed with 503 turnstile_unavailable when Cloudflare is unreachable', async () => {
    const v = createTurnstileVerifier(cfg, { fetch: stub('hang').fetch, timeoutMs: 30 });
    assert.deepEqual(
      await run(turnstileGuard('sign-in', ON, v), ctx(BROWSER, { turnstileToken: TOKEN })),
      { reached: false, status: 503, code: 'turnstile_unavailable' },
    );
  });

  it('TURNSTILE_FAIL_OPEN lets the request through on an outage (and only on an outage)', async () => {
    const down = createTurnstileVerifier(cfg, {
      fetch: stub(new Error('ENOTFOUND'), new Error('ENOTFOUND')).fetch,
    });
    const open = { ...ON, failOpen: true };
    const r = await run(
      turnstileGuard('sign-in', open, down),
      ctx(BROWSER, { turnstileToken: TOKEN }),
    );
    assert.equal(r.reached, true);
    const entry = audit.list({ limit: 5 }).find((e) => e.action === 'security.turnstile_fail_open');
    assert.ok(entry, 'every fail-open pass is audited');
    assert.equal(entry.requestId, 'req-test');
    // A token Cloudflare rejects is still refused, and a missing one still required.
    const bad = createTurnstileVerifier(cfg, {
      fetch: stub(json(200, { success: false, 'error-codes': [] })).fetch,
    });
    assert.equal(
      (await run(turnstileGuard('sign-in', open, bad), ctx(BROWSER, { turnstileToken: TOKEN })))
        .code,
      'turnstile_failed',
    );
    assert.equal(
      (await run(turnstileGuard('sign-in', open, bad), ctx(BROWSER, {}))).code,
      'turnstile_required',
    );
  });

  it('exempts an explicit CLI client, but never a request carrying browser headers', async () => {
    const none = stub();
    const v = createTurnstileVerifier(cfg, { fetch: none.fetch });
    const g = turnstileGuard('sign-in', ON, v);
    assert.equal((await run(g, ctx(CLI, {}))).reached, true, 'CLI, no Origin');
    const variants: Record<string, string>[] = [
      { ...CLI, origin: 'https://app.devhq.example' },
      { ...CLI, origin: 'null' },
      { ...CLI, 'sec-fetch-site': 'same-origin' },
      { ...CLI, 'sec-fetch-site': 'none' },
      { 'x-devhq-client': 'web' },
      {},
    ];
    for (const h of variants) {
      const r = await run(g, ctx(h, {}));
      assert.equal(r.code, 'turnstile_required', JSON.stringify(h));
    }
    assert.equal(isCliClient(ctx({ 'x-devhq-client': 'CLI' }, {})), true);
    assert.equal(
      (await run(turnstileGuard('sign-in', { ...ON, exemptCli: false }, v), ctx(CLI, {}))).code,
      'turnstile_required',
      'TURNSTILE_EXEMPT_CLI=0 removes the exemption',
    );
    assert.equal(none.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Configuration (fail closed)
// ---------------------------------------------------------------------------

const prod = { isProd: true, appOrigin: `https://${HOST}` };
const dev = { isProd: false, appOrigin: 'http://localhost:5173' };

describe('turnstile configuration', () => {
  it('defaults to off with nothing configured, in production too', () => {
    const c = loadTurnstileConfig({}, prod);
    assert.equal(c.mode, 'off');
    assert.equal(c.failOpen, false);
    assert.equal(c.exemptCli, true);
    assert.equal(c.expectedHostname, HOST);
  });

  it('refuses to boot in production with mode on and a key missing', () => {
    assert.throws(
      () => loadTurnstileConfig({ TURNSTILE_MODE: 'on' }, prod),
      /TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY/,
    );
    assert.throws(
      () => loadTurnstileConfig({ TURNSTILE_MODE: 'on', TURNSTILE_SITE_KEY: SITE }, prod),
      /requires TURNSTILE_SECRET_KEY/,
    );
    assert.throws(
      () => loadTurnstileConfig({ TURNSTILE_MODE: 'on', TURNSTILE_SECRET_KEY: SECRET }, prod),
      /requires TURNSTILE_SITE_KEY/,
    );
    const ok = loadTurnstileConfig(
      { TURNSTILE_MODE: 'on', TURNSTILE_SITE_KEY: SITE, TURNSTILE_SECRET_KEY: SECRET },
      prod,
    );
    assert.equal(ok.mode, 'on');
    assert.equal(ok.testKeys, false);
  });

  it('refuses unknown modes and flag values, and test keys in production', () => {
    assert.throws(() => loadTurnstileConfig({ TURNSTILE_MODE: 'yes' }, dev), /off or on/);
    assert.throws(() => loadTurnstileConfig({ TURNSTILE_FAIL_OPEN: 'maybe' }, dev), /0 or 1/);
    const test = {
      TURNSTILE_MODE: 'on',
      TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    };
    assert.throws(() => loadTurnstileConfig(test, prod), /test key in production/);
    const c = loadTurnstileConfig(test, dev);
    assert.equal(c.testKeys, true);
    assert.ok(c.warnings.some((w) => /test keys/.test(w)));
  });

  it('reads the secret from TURNSTILE_SECRET_KEY_FILE and refuses ambiguity', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ts-')), 'secret');
    writeFileSync(file, `${SECRET}\n`);
    const c = loadTurnstileConfig(
      { TURNSTILE_MODE: 'on', TURNSTILE_SITE_KEY: SITE, TURNSTILE_SECRET_KEY_FILE: file },
      prod,
    );
    assert.equal(c.secretKey, SECRET);
    assert.throws(
      () =>
        loadTurnstileConfig(
          { TURNSTILE_SECRET_KEY: SECRET, TURNSTILE_SECRET_KEY_FILE: file },
          prod,
        ),
      /Both TURNSTILE_SECRET_KEY and TURNSTILE_SECRET_KEY_FILE/,
    );
  });

  it('warns when fail-open is enabled', () => {
    const c = loadTurnstileConfig(
      {
        TURNSTILE_MODE: 'on',
        TURNSTILE_SITE_KEY: SITE,
        TURNSTILE_SECRET_KEY: SECRET,
        TURNSTILE_FAIL_OPEN: '1',
      },
      prod,
    );
    assert.equal(c.failOpen, true);
    assert.ok(c.warnings.some((w) => /FAIL_OPEN/.test(w)));
  });
});
