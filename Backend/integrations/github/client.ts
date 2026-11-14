/**
 * GitHub REST client for the TavetaHQ GitHub App.
 *
 * - App JWT: RS256 over `{iat, exp, iss}` with node:crypto (no jsonwebtoken),
 *   iat back-dated 60 s for clock skew, 9-minute lifetime, cached for 8.
 * - Installation tokens: minted via POST /app/installations/:id/access_tokens
 *   and cached — sealed with AES-256-GCM — until 60 s before `expires_at`.
 * - Every call has a 10 s timeout.
 * - GETs use conditional requests (ETag / If-None-Match): a 304 serves the
 *   cached body and doesn't count against the rate limit.
 * - Rate-limit aware: `x-ratelimit-remaining/reset` are tracked; when the
 *   budget is exhausted calls fail fast with 429 until the reset time instead
 *   of hammering GitHub (secondary limits: honours `retry-after`).
 */

import { createSign } from 'node:crypto';
import { HttpError } from '../../types.ts';
import { open, seal } from '../../domain/engineering/secrets.ts';
import { githubEnv, githubMode } from './config.ts';

export const GITHUB_API = 'https://api.github.com';
const TIMEOUT_MS = 10_000;
const ETAG_CACHE_MAX = 500;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
let fetchImpl: FetchLike = (url, init) => fetch(url, init);

/** Test seam: replace the HTTP layer used for GitHub calls. Returns a restore function. */
export function setGithubFetch(next: FetchLike): () => void {
  const prev = fetchImpl;
  fetchImpl = next;
  return () => {
    fetchImpl = prev;
  };
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

let jwtCache: { token: string; until: number; appId: string } | undefined;

/** RS256-signed App JWT. Throws 503 when the App isn't configured. */
export function appJwt(now = Math.floor(Date.now() / 1000)): string {
  const { appId, privateKey } = githubEnv();
  if (!appId || !privateKey)
    throw new HttpError(503, 'integration_unconfigured', 'GitHub App credentials are not set');
  if (jwtCache && jwtCache.appId === appId && jwtCache.until > now) return jwtCache.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  let sig: string;
  try {
    sig = signer.sign(privateKey).toString('base64url');
  } catch {
    throw new HttpError(
      503,
      'integration_unconfigured',
      'GITHUB_APP_PRIVATE_KEY is not a valid PEM key',
    );
  }
  const token = `${header}.${payload}.${sig}`;
  jwtCache = { token, until: now + 8 * 60, appId };
  return token;
}

/** Sealed installation tokens, keyed by installation id. */
const tokenCache = new Map<number, { sealed: string; expiresAt: number }>();

export async function installationToken(installationId: number): Promise<string> {
  const hit = tokenCache.get(installationId);
  if (hit && hit.expiresAt - 60_000 > Date.now()) return open(hit.sealed);
  const res = await githubRequest<{ token: string; expires_at: string }>(
    'POST',
    `/app/installations/${installationId}/access_tokens`,
    { auth: { kind: 'app' } },
  );
  tokenCache.set(installationId, {
    sealed: seal(res.token),
    expiresAt: new Date(res.expires_at).getTime(),
  });
  return res.token;
}

export function forgetInstallationToken(installationId: number) {
  tokenCache.delete(installationId);
}

export type GithubAuth =
  | { kind: 'app' }
  | { kind: 'installation'; installationId: number }
  | { kind: 'token' }
  | { kind: 'auto'; installationId?: number };

async function authHeader(auth: GithubAuth): Promise<string> {
  if (auth.kind === 'app') return `Bearer ${appJwt()}`;
  if (auth.kind === 'installation') return `token ${await installationToken(auth.installationId)}`;
  const { token } = githubEnv();
  if (auth.kind === 'auto' && auth.installationId && githubMode() === 'app')
    return `token ${await installationToken(auth.installationId)}`;
  if (token) return `Bearer ${token}`;
  throw new HttpError(
    503,
    'integration_unconfigured',
    'No GitHub credential available for this call',
  );
}

export const rateLimit = { remaining: -1, limit: -1, resetAt: 0 };
const etags = new Map<string, { etag: string; body: unknown }>();

function trackRate(h: Headers) {
  const rem = h.get('x-ratelimit-remaining');
  const lim = h.get('x-ratelimit-limit');
  const reset = h.get('x-ratelimit-reset');
  if (rem !== null) rateLimit.remaining = Number(rem);
  if (lim !== null) rateLimit.limit = Number(lim);
  if (reset !== null) rateLimit.resetAt = Number(reset) * 1000;
}

export async function githubRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  opts: { auth: GithubAuth; body?: unknown },
): Promise<T> {
  if (rateLimit.remaining === 0 && rateLimit.resetAt > Date.now())
    throw new HttpError(429, 'rate_limited', 'GitHub rate limit reached — retry after reset', {
      resetAt: new Date(rateLimit.resetAt).toISOString(),
    });
  const authorization = await authHeader(opts.auth);
  const cacheKey = `${authorization.slice(-16)} ${path}`;
  const cached = method === 'GET' ? etags.get(cacheKey) : undefined;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(`${GITHUB_API}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'devhq-github-app',
        ...(cached ? { 'if-none-match': cached.etag } : {}),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new HttpError(
      504,
      'upstream_timeout',
      (e as Error).name === 'AbortError'
        ? 'GitHub did not respond in time'
        : 'Could not reach GitHub',
    );
  } finally {
    clearTimeout(timer);
  }
  trackRate(res.headers);
  if (res.status === 304 && cached) return cached.body as T;
  if (res.ok) {
    const body = (res.status === 204 ? null : await res.json()) as T;
    const etag = res.headers.get('etag');
    if (method === 'GET' && etag) {
      if (etags.size >= ETAG_CACHE_MAX) etags.delete(etags.keys().next().value as string);
      etags.set(cacheKey, { etag, body });
    }
    return body;
  }
  const msg =
    ((await res.json().catch(() => ({}))) as { message?: string }).message ??
    `GitHub returned ${res.status}`;
  const retryAfter = res.headers.get('retry-after');
  if (res.status === 429 || (res.status === 403 && (rateLimit.remaining === 0 || retryAfter))) {
    if (retryAfter) rateLimit.resetAt = Date.now() + Number(retryAfter) * 1000;
    throw new HttpError(429, 'rate_limited', 'GitHub rate limit reached');
  }
  if (res.status === 401)
    throw new HttpError(502, 'github_auth', 'GitHub rejected our credentials');
  if (res.status === 403) throw new HttpError(403, 'github_forbidden', msg);
  if (res.status === 404) throw new HttpError(404, 'not_found', 'Not found on GitHub');
  if (res.status === 422) throw new HttpError(422, 'github_rejected', msg);
  throw new HttpError(502, 'upstream_error', msg);
}

/** App metadata (slug for the install URL), cached for the process lifetime. */
let appInfo: { slug: string; name: string; id: number } | undefined;
export async function getAppInfo(): Promise<{ slug: string; name: string; id: number }> {
  const { appSlug, appId } = githubEnv();
  if (appSlug) return { slug: appSlug, name: appSlug, id: Number(appId ?? 0) };
  appInfo ??= await githubRequest<{ slug: string; name: string; id: number }>('GET', '/app', {
    auth: { kind: 'app' },
  });
  return appInfo;
}
