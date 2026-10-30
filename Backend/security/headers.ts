/**
 * Security headers applied to every response.
 *
 * - HSTS: forces HTTPS (TLS 1.3 is terminated at the edge) for two years, with
 *   preload. Sent in production only — HSTS on localhost breaks local dev.
 * - CSP: nonce-based scripts, no inline/eval, no framing, and an explicit
 *   allow-list for third-party origins (payments, analytics). Any new
 *   third-party script must be added here *and* pinned with SRI.
 * - Plus the usual hardening: no MIME sniffing, strict referrer, locked-down
 *   browser features, and cross-origin isolation.
 */

import { randomBytes } from 'node:crypto';
import type { Middleware } from '../lib/http.ts';
import { config } from '../config/env.ts';
import { HttpError } from '../types.ts';

/** Third-party origins we deliberately allow. Keep this list short. */
const THIRD_PARTY = {
  script: ['https://js.stripe.com'],
  connect: ['https://api.github.com'],
  frame: ['https://js.stripe.com'],
  img: ['/cdn.magicpatterns.com', 'https://avatars.githubusercontent.com'],
};

export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${THIRD_PARTY.script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: blob: ${THIRD_PARTY.img.join(' ')}`,
    `connect-src 'self' ${THIRD_PARTY.connect.join(' ')}`,
    `frame-src ${THIRD_PARTY.frame.join(' ')}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    ...(config.isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** CSP for the backend console: same-origin only, one nonce'd inline script. */
export function consoleCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export const securityHeaders: Middleware = (ctx, next) => {
  const nonce = randomBytes(16).toString('base64');
  const h = ctx.res;
  if (config.isProd)
    h.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  h.setHeader('Content-Security-Policy', buildCsp(nonce));
  h.setHeader('X-Content-Type-Options', 'nosniff');
  h.setHeader('X-Frame-Options', 'DENY');
  h.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(self), publickey-credentials-get=(self), publickey-credentials-create=(self)',
  );
  h.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  h.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  h.setHeader('Cache-Control', 'no-store');
  h.removeHeader('X-Powered-By');
  return next();
};

const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Request-Id, X-DevHQ-Client';
const EXPOSED_HEADERS =
  'X-Request-Id, RateLimit-Remaining, Retry-After, X-Step-Up-Required, X-Response-Time';

/**
 * CORS + CSRF origin check. Only allow-listed origins may call the API with
 * credentials; state-changing requests from any other Origin are rejected.
 * Requests with no Origin (curl, server-to-server) carry no ambient browser
 * credentials, so they're allowed through to normal authentication.
 */
export const originGuard: Middleware = (ctx, next) => {
  const origin = ctx.req.headers.origin;
  const allowed = !!origin && config.allowedOrigins.includes(origin);
  if (allowed) {
    ctx.res.setHeader('Access-Control-Allow-Origin', origin!);
    ctx.res.setHeader('Access-Control-Allow-Credentials', 'true');
    ctx.res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
    ctx.res.setHeader('Vary', 'Origin');
  }
  if (ctx.req.method === 'OPTIONS') {
    if (!allowed) throw new HttpError(403, 'bad_origin', 'Origin not allowed');
    ctx.res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE');
    ctx.res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);
    ctx.res.setHeader('Access-Control-Max-Age', '600');
    ctx.res.statusCode = 204;
    ctx.res.end();
    // Response is already sent; resolve so the middleware still satisfies the
    // Promise-returning Middleware contract.
    return Promise.resolve();
  }
  const unsafe = ctx.req.method !== 'GET' && ctx.req.method !== 'HEAD';
  if (unsafe && origin && !allowed)
    throw new HttpError(403, 'bad_origin', 'Cross-origin request blocked');
  return next();
};

/** Subresource Integrity hashes for pinned third-party scripts — served to the frontend at build time. */
export const pinnedScripts: Record<string, string> = {
  'https://js.stripe.com/v3/': 'sha384-REPLACE_WITH_PUBLISHED_HASH',
};
