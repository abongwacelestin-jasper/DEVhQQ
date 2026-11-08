/**
 * Cloudflare Turnstile: server-side verification of the bot-protection token
 * on the public auth forms. Off unless `TURNSTILE_MODE=on` (config/turnstile.ts).
 *
 * Protected routes (`turnstileGuard(action)`, placed after the route's rate
 * limiter so a bot still burns rate-limit tokens):
 *   POST /api/auth/sign-in            action "sign-in"
 *   POST /api/auth/demo               action "sign-in"  (demo exists outside production only)
 *   POST /api/auth/recovery/request   action "recover"
 *   POST /api/auth/accept-invite      action "accept-invite"
 *
 * Not protected, on purpose:
 *  - MFA, step-up, enrollment and passkey-registration routes: the caller
 *    already holds a session from a protected step.
 *  - Passkey sign-in (`/api/auth/webauthn/*`): needs a private key bound to
 *    this origin; a bot gains nothing it could not do with the key itself.
 *  - Recovery reset and the invite preview: each needs a 256-bit single-use
 *    link token, which already makes guessing infeasible.
 *  - Explicit CLI clients, only with `TURNSTILE_EXEMPT_CLI=1` (off by default;
 *    production also needs `TURNSTILE_EXEMPT_CLI_ACK=bots-can-claim-cli`): a request
 *    that sends `X-DevHQ-Client: cli` and none of the headers every browser
 *    attaches (`Origin`, `Sec-Fetch-Site`) cannot run the widget. Page script
 *    cannot remove those headers, so a browser — including script injected
 *    into one — can never use this exemption. A raw HTTP bot can, so the
 *    exemption trades bot protection on that path for CLI sign-in; the rate
 *    limits, lockout and risk gate still apply to it. Automation should use
 *    personal access tokens, which never touch these routes (W5-03).
 *
 * Verification (`createTurnstileVerifier`): POST siteverify with the secret,
 * the token, the client IP and an idempotency key (one retry on a network
 * error or 5xx, same key, inside one 5 s budget), then require `success`,
 * `hostname` = APP_ORIGIN's host and `action` = the form's action. Cloudflare
 * makes tokens single-use; a small TTL set additionally refuses a token seen
 * in the last 5 minutes by this process, before Cloudflare is even asked.
 *
 * Errors (stable codes): `400 turnstile_required` (no token), `403
 * turnstile_failed` (rejected), `503 turnstile_unavailable` (Cloudflare
 * unreachable or timed out — fail closed). `TURNSTILE_FAIL_OPEN=1` lets such
 * requests through during a Cloudflare incident; each pass is audited as
 * `security.turnstile_fail_open`.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Ctx, Middleware } from '../lib/http.ts';
import { config } from '../config/env.ts';
import type { TurnstileConfig } from '../config/turnstile.ts';
import { audit } from '../audit/auditLog.ts';
import { logger } from '../lib/logger.ts';
import { HttpError } from '../types.ts';

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const SITEVERIFY_TIMEOUT_MS = 5_000;
export const REPLAY_TTL_MS = 5 * 60_000;
/** Turnstile tokens are at most 2048 characters. */
export const MAX_TOKEN_LENGTH = 2048;

export type TurnstileAction = 'sign-in' | 'recover' | 'accept-invite';

export type VerifyResult =
  | { ok: true; testing?: boolean }
  | {
      ok: false;
      reason: 'invalid' | 'hostname' | 'action' | 'replay' | 'malformed' | 'unavailable';
      errorCodes?: string[];
    };

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface VerifierDeps {
  /** Defaults to the global fetch, looked up at call time (tests stub it). */
  fetch?: FetchFn;
  now?: () => number;
  timeoutMs?: number;
  /** Upper bound on remembered tokens (oldest dropped first). */
  maxSeen?: number;
}

type VerifierConfig = Pick<TurnstileConfig, 'secretKey' | 'expectedHostname' | 'testKeys'>;

interface SiteverifyBody {
  success?: unknown;
  hostname?: unknown;
  action?: unknown;
  'error-codes'?: unknown;
  metadata?: { result_with_testing_key?: unknown };
}

/**
 * A minimal TTL set: insertion-ordered Map of token hash → expiry. Tokens are
 * stored hashed so a memory dump never holds a live token.
 */
class SeenTokens {
  private seen = new Map<string, number>();
  private max: number;
  constructor(max: number) {
    this.max = max;
  }

  /** Records the token; false when it was already seen and has not expired. */
  add(hash: string, now: number): boolean {
    const exp = this.seen.get(hash);
    if (exp !== undefined && exp > now) return false;
    // Re-inserted at the end so the map stays ordered by expiry.
    this.seen.delete(hash);
    for (const [k, e] of this.seen) {
      if (e > now && this.seen.size < this.max) break;
      this.seen.delete(k);
    }
    this.seen.set(hash, now + REPLAY_TTL_MS);
    return true;
  }

  get size() {
    return this.seen.size;
  }
}

export function createTurnstileVerifier(cfg: VerifierConfig, deps: VerifierDeps = {}) {
  const now = deps.now ?? Date.now;
  const timeoutMs = deps.timeoutMs ?? SITEVERIFY_TIMEOUT_MS;
  const seen = new SeenTokens(deps.maxSeen ?? 50_000);
  const doFetch: FetchFn = deps.fetch ?? ((url, init) => globalThis.fetch(url, init));

  async function call(body: string, signal: AbortSignal): Promise<SiteverifyBody | 'unavailable'> {
    // Two attempts at most; the idempotency key makes the retry safe.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await doFetch(SITEVERIFY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal,
        });
        if (res.status >= 500) continue;
        if (!res.ok) return 'unavailable';
        return (await res.json()) as SiteverifyBody;
      } catch {
        if (signal.aborted) return 'unavailable';
      }
    }
    return 'unavailable';
  }

  return {
    async verify(
      token: string,
      input: { action: TurnstileAction; remoteIp?: string },
    ): Promise<VerifyResult> {
      if (!token || token.length > MAX_TOKEN_LENGTH || /[^\x21-\x7e]/.test(token))
        return { ok: false, reason: 'malformed' };
      if (!cfg.secretKey) return { ok: false, reason: 'unavailable' };
      const hash = createHash('sha256').update(token).digest('base64url');
      // Test secrets accept one fixed dummy token from anyone, so replay cannot apply.
      if (!cfg.testKeys && !seen.add(hash, now())) return { ok: false, reason: 'replay' };

      const signal = AbortSignal.timeout(timeoutMs);
      const body = JSON.stringify({
        secret: cfg.secretKey,
        response: token,
        ...(input.remoteIp ? { remoteip: input.remoteIp } : {}),
        idempotency_key: randomUUID(),
      });
      const out = await call(body, signal);
      if (out === 'unavailable') return { ok: false, reason: 'unavailable' };

      const errorCodes = Array.isArray(out['error-codes'])
        ? out['error-codes'].filter((c): c is string => typeof c === 'string')
        : [];
      // Cloudflare reports its own problems (bad secret, internal error) here too.
      if (errorCodes.includes('internal-error')) return { ok: false, reason: 'unavailable' };
      if (out.success !== true) return { ok: false, reason: 'invalid', errorCodes };
      // Test-key results carry a dummy hostname and no action: accept them only
      // when we are configured with test keys (production refuses those at boot).
      if (out.metadata?.result_with_testing_key === true) {
        return cfg.testKeys ? { ok: true, testing: true } : { ok: false, reason: 'invalid' };
      }
      if (out.hostname !== cfg.expectedHostname) return { ok: false, reason: 'hostname' };
      if (out.action !== input.action) return { ok: false, reason: 'action' };
      return { ok: true };
    },
    /** Remembered token count (tests, console). */
    seenCount: () => seen.size,
  };
}

/**
 * The CLI exemption, identical to the rule that decides who may receive a
 * session token in a response body (routes/auth.routes.ts `wantsBodyToken`):
 * an explicit `X-DevHQ-Client: cli` and none of the headers browsers attach.
 */
export function isCliClient(ctx: Ctx): boolean {
  const h = ctx.req.headers;
  return (
    String(h['x-devhq-client'] ?? '').toLowerCase() === 'cli' &&
    h.origin === undefined &&
    h['sec-fetch-site'] === undefined
  );
}

function bodyToken(ctx: Ctx): string | undefined {
  const b = ctx.body;
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    const t = (b as Record<string, unknown>).turnstileToken;
    if (typeof t === 'string' && t.length > 0) return t;
  }
  return undefined;
}

const verifier = createTurnstileVerifier(config.turnstile);
for (const w of config.turnstile.warnings) logger.warn(`turnstile config: ${w}`);

/**
 * Route middleware. Reads `turnstileToken` from the JSON body (each protected
 * route's schema allows it as an optional field) and refuses the request
 * before the handler runs. A no-op while `TURNSTILE_MODE=off`.
 */
export function turnstileGuard(
  action: TurnstileAction,
  cfg: TurnstileConfig = config.turnstile,
  v: ReturnType<typeof createTurnstileVerifier> = verifier,
): Middleware {
  return async (ctx, next) => {
    if (cfg.mode !== 'on') return next();
    if (cfg.exemptCli && isCliClient(ctx)) return next();
    const token = bodyToken(ctx);
    if (!token)
      throw new HttpError(400, 'turnstile_required', 'Complete the security check, then try again');
    const result = await v.verify(token, { action, remoteIp: ctx.ip });
    if (result.ok) return next();
    if (result.reason === 'unavailable') {
      if (cfg.failOpen) {
        audit.append({
          actor: 'anonymous',
          action: 'security.turnstile_fail_open',
          target: `${action} · ${ctx.ip}`,
          sensitive: true,
          requestId: ctx.requestId,
        });
        return next();
      }
      throw new HttpError(
        503,
        'turnstile_unavailable',
        'The security check is unavailable right now — try again in a minute',
      );
    }
    audit.append({
      actor: 'anonymous',
      action: 'security.turnstile_failed',
      target: `${action} · ${result.reason} · ${ctx.ip}`,
      sensitive: true,
      requestId: ctx.requestId,
    });
    throw new HttpError(403, 'turnstile_failed', 'The security check failed — try it again');
  };
}

/** What the SPA needs to render the widget (served by GET /api/auth/config). */
export function turnstilePublicConfig() {
  return config.turnstile.mode === 'on'
    ? { mode: 'on' as const, siteKey: config.turnstile.siteKey ?? '' }
    : { mode: 'off' as const, siteKey: null };
}
