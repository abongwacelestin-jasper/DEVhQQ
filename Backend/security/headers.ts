/**
 * Security headers, CORS and cross-site request defences.
 *
 * Every response (set before routing, so 404/405/429 are covered too):
 *  - CSP: API responses are data, never documents → `default-src 'none'`.
 *    HTML routes (the backend console) replace it with a nonce-based policy
 *    (`consoleCsp`); the SPA policy for the edge/nginx is `buildCsp`.
 *  - HSTS (production only — HSTS on localhost breaks local dev) for two
 *    years with preload; TLS 1.3 is terminated at the edge.
 *  - Isolation: COOP same-origin, CORP same-origin, COEP require-corp,
 *    Origin-Agent-Cluster, X-Frame-Options DENY (legacy twin of
 *    frame-ancestors 'none').
 *  - Permissions-Policy: every powerful feature off except WebAuthn on self.
 *  - `Cache-Control: no-store` so tokens, PII and audit rows never land in a
 *    shared or disk cache (static font responses opt back in explicitly).
 *
 * Request side (`originGuard`):
 *  - CORS for allow-listed origins only; preflight from anywhere else is 403.
 *  - CSRF: every state-changing method (anything but GET/HEAD/OPTIONS) from a
 *    non-allow-listed `Origin` is 403. Fetch Metadata (`Sec-Fetch-Site`) is a
 *    second, independent check: a cross-site or same-site request from a
 *    non-allow-listed origin is refused even if `Origin` was stripped, and
 *    cross-site no-cors subresource loads of /api are refused outright.
 *  - Layered with SameSite=Strict cookies and JSON-only bodies (lib/http.ts
 *    rejects form encodings with 415), so a classic HTML form post fails
 *    three different ways.
 */

import { randomBytes } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import type { Middleware } from '../lib/http.ts';
import { config } from '../config/env.ts';
import { HttpError } from '../types.ts';

/** Third-party origins the SPA deliberately allows. Keep this list short; pin scripts with SRI. */
const THIRD_PARTY = {
  script: ['https://js.stripe.com'],
  connect: ['https://api.github.com'],
  frame: ['https://js.stripe.com'],
  img: ['https://cdn.magicpatterns.com', 'https://avatars.githubusercontent.com'],
};

/**
 * CSP for the single-page app's HTML (served by the edge / nginx, which must
 * inject the same nonce into its script tags). Strict: nonce + strict-dynamic,
 * no inline or eval script, no plugins, no framing, no <base> hijack.
 */
export function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' ${THIRD_PARTY.script.join(' ')}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: blob: ${THIRD_PARTY.img.join(' ')}`,
    `connect-src 'self' ${THIRD_PARTY.connect.join(' ')}`,
    `frame-src ${THIRD_PARTY.frame.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    ...(config.isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** CSP for the backend console: same-origin only, nonce'd inline scripts, no inline event handlers. */
export function consoleCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}'`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    ...(config.isProd ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** CSP for JSON and other non-document responses: nothing may load or run. */
export const API_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'autoplay=()',
  'bluetooth=()',
  'browsing-topics=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'idle-detection=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'serial=()',
  'usb=()',
  'xr-spatial-tracking=()',
  'publickey-credentials-create=(self)',
  'publickey-credentials-get=(self)',
].join(', ');

const nonces = new WeakMap<ServerResponse, string>();

/** The per-response CSP nonce, for HTML routes that render inline scripts. */
export function cspNonce(res: ServerResponse): string {
  let n = nonces.get(res);
  if (!n) {
    n = randomBytes(16).toString('base64');
    nonces.set(res, n);
  }
  return n;
}

export const securityHeaders: Middleware = (ctx, next) => {
  const h = ctx.res;
  if (config.isProd)
    h.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  h.setHeader('Content-Security-Policy', API_CSP);
  h.setHeader('X-Content-Type-Options', 'nosniff');
  h.setHeader('X-Frame-Options', 'DENY');
  h.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  h.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  h.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // Safe here: the API and console load nothing cross-origin.
  h.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  h.setHeader('Origin-Agent-Cluster', '?1');
  h.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  h.setHeader('X-DNS-Prefetch-Control', 'off');
  h.setHeader('Cache-Control', 'no-store');
  h.removeHeader('X-Powered-By');
  return next();
};

const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Request-Id, X-DevHQ-Client';
const EXPOSED_HEADERS =
  'X-Request-Id, RateLimit-Remaining, Retry-After, X-Step-Up-Required, X-Response-Time';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CORS + CSRF origin check. Only allow-listed origins may call the API with
 * credentials; state-changing requests from any other Origin are rejected.
 * Requests with neither `Origin` nor `Sec-Fetch-Site` are not from a browser
 * (curl, CLIs, webhooks) and carry no ambient browser credentials, so they
 * go on to normal authentication.
 */
export const originGuard: Middleware = (ctx, next) => {
  const origin = ctx.req.headers.origin;
  const method = ctx.req.method ?? 'GET';
  const site = String(ctx.req.headers['sec-fetch-site'] ?? '');
  const mode = String(ctx.req.headers['sec-fetch-mode'] ?? '');
  const allowed = !!origin && config.allowedOrigins.includes(origin);
  // The response differs by Origin either way, so caches must key on it.
  ctx.res.setHeader('Vary', 'Origin');
  if (allowed) {
    ctx.res.setHeader('Access-Control-Allow-Origin', origin!);
    ctx.res.setHeader('Access-Control-Allow-Credentials', 'true');
    ctx.res.setHeader('Access-Control-Expose-Headers', EXPOSED_HEADERS);
  }
  if (method === 'OPTIONS') {
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
  const unsafe = !SAFE_METHODS.has(method);
  // 1. Origin: any present, non-allow-listed Origin (including "null") on a state change.
  if (unsafe && origin !== undefined && !allowed)
    throw new HttpError(403, 'bad_origin', 'Cross-origin request blocked');
  // 2. Fetch Metadata: a browser said this came from another site, and the
  //    origin is not one we trust — refuse even if Origin was missing.
  const fromOtherSite = site === 'cross-site' || site === 'same-site';
  if (unsafe && fromOtherSite && !allowed)
    throw new HttpError(403, 'bad_origin', 'Cross-site request blocked');
  // 3. Resource isolation: cross-site pages may navigate to the API, but not
  //    embed it as a script/image/style or read it without CORS.
  if (!unsafe && site === 'cross-site' && !allowed && mode !== 'navigate' && mode !== 'cors')
    throw new HttpError(403, 'bad_origin', 'Cross-site resource load blocked');
  return next();
};

/** Subresource Integrity hashes for pinned third-party scripts — served to the frontend at build time. */
export const pinnedScripts: Record<string, string> = {
  'https://js.stripe.com/v3/': 'sha384-REPLACE_WITH_PUBLISHED_HASH',
};
