/**
 * GitHub Codespaces proxy.
 *
 * The browser never holds a GitHub token. These routes call GitHub's REST API with a
 * server-side token and return only the fields the workspace needs:
 *
 *   GET  /api/codespaces?repo=owner/name   → GET  /user/codespaces (filtered to the repo)
 *   POST /api/codespaces {repo, ref}       → POST /repos/{owner}/{repo}/codespaces
 *   GET  /api/codespaces/:name             → GET  /user/codespaces/{name}
 *   POST /api/codespaces/:name/start       → POST /user/codespaces/{name}/start
 *   POST /api/codespaces/:name/stop        → POST /user/codespaces/{name}/stop
 *   GET  /api/codespaces/oauth/url         → GitHub App user-authorization URL
 *
 * Token source: GITHUB_TOKEN (a GitHub App *user* access token with the `codespace`
 * permission). In a multi-user deployment, replace `tokenFor()` with a lookup of the
 * member's own token stored encrypted after the OAuth callback.
 *
 * Errors are normalised so the client can tell auth failures (→ "Connect GitHub")
 * from everything else (→ local sandbox fallback).
 */

import type { Router } from '../lib/http.ts';
import { parse, v } from '../lib/validate.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { audit } from '../audit/auditLog.ts';
import { HttpError } from '../types.ts';

const GITHUB_API = 'https://api.github.com';
const TIMEOUT_MS = 10_000;
const repoPattern = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const namePattern = /^[A-Za-z0-9-]{1,90}$/;
const createBody = v.object({
  repo: v.string({ pattern: repoPattern }),
  ref: v.optional(v.string({ max: 200, pattern: /^[A-Za-z0-9._/-]+$/ })),
});

interface GhCodespace {
  id: number;
  name: string;
  display_name?: string;
  state: string;
  web_url: string;
  repository: { full_name: string };
  git_status?: unknown;
  machine?: unknown;
  idle_timeout_minutes?: number;
  last_used_at: string;
  created_at: string;
}

function tokenFor(_memberId: string): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new HttpError(401, 'github_auth', 'GitHub is not connected for this account');
  return t;
}

/** Strip GitHub's payload down to what the client renders — no tokens, no internal URLs. */
function shape(c: GhCodespace) {
  return {
    id: c.id,
    name: c.name,
    display_name: c.display_name,
    state: c.state,
    web_url: c.web_url,
    repository: { full_name: c.repository.full_name },
    git_status: c.git_status,
    machine: c.machine,
    idle_timeout_minutes: c.idle_timeout_minutes,
    last_used_at: c.last_used_at,
    created_at: c.created_at,
  };
}

async function gh<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'devhq-api',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
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
  if (res.ok) return (res.status === 204 ? null : await res.json()) as T;

  const msg =
    ((await res.json().catch(() => ({}))) as { message?: string }).message ??
    `GitHub returned ${res.status}`;
  if (res.status === 401)
    throw new HttpError(401, 'github_auth', 'GitHub sign-in expired — reconnect your account');
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')
    throw new HttpError(429, 'rate_limited', 'GitHub rate limit reached');
  if (res.status === 403) throw new HttpError(403, 'forbidden', msg);
  if (res.status === 404)
    throw new HttpError(404, 'not_found', 'Repository or codespace not found');
  throw new HttpError(502, 'upstream_error', msg);
}

export function registerCodespaceRoutes(r: Router) {
  r.add(
    'GET',
    '/api/codespaces/oauth/url',
    {
      summary: 'GitHub authorization URL for Codespaces',
      tag: 'codespaces',
      responses: [401, 501],
    },
    authenticate,
    () => {
      const clientId = process.env.GITHUB_CLIENT_ID;
      if (!clientId) throw new HttpError(501, 'not_configured', 'GITHUB_CLIENT_ID is not set');
      const redirect = encodeURIComponent(
        `${process.env.PUBLIC_URL ?? 'http://localhost:8080'}/api/codespaces/oauth/callback`,
      );
      return {
        url: `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(clientId)}&redirect_uri=${redirect}`,
      };
    },
  );

  r.add(
    'GET',
    '/api/codespaces',
    {
      summary: 'My codespaces for a repository (?repo=owner/name)',
      tag: 'codespaces',
      responses: [401, 403, 422, 429, 502],
    },
    authenticate,
    async (ctx) => {
      const repo = ctx.query.get('repo') ?? '';
      if (!repoPattern.test(repo))
        throw new HttpError(422, 'validation_failed', 'repo must be owner/name');
      const data = await gh<{ codespaces: GhCodespace[] }>(
        tokenFor(ctx.principal!.memberId),
        'GET',
        '/user/codespaces?per_page=100',
      );
      return data.codespaces
        .filter((c) => c.repository.full_name.toLowerCase() === repo.toLowerCase())
        .map(shape);
    },
  );

  r.add(
    'POST',
    '/api/codespaces',
    {
      summary: 'Create a codespace on a repository',
      tag: 'codespaces',
      responses: [401, 403, 422, 429, 502],
    },
    authenticate,
    async (ctx) => {
      const { repo, ref } = parse(createBody, ctx.body);
      const cs = await gh<GhCodespace>(
        tokenFor(ctx.principal!.memberId),
        'POST',
        `/repos/${repo}/codespaces`,
        { ref: ref ?? 'main', idle_timeout_minutes: 30 },
      );
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'codespace.created',
        target: `${repo}@${ref ?? 'main'} · ${cs.name}`,
        requestId: ctx.requestId,
      });
      ctx.status = 201;
      return shape(cs);
    },
  );

  r.add(
    'GET',
    '/api/codespaces/:name',
    { summary: 'One codespace (status polling)', tag: 'codespaces', responses: [401, 404, 502] },
    authenticate,
    async (ctx) => {
      if (!namePattern.test(ctx.params.name))
        throw new HttpError(422, 'validation_failed', 'Invalid codespace name');
      return shape(
        await gh<GhCodespace>(
          tokenFor(ctx.principal!.memberId),
          'GET',
          `/user/codespaces/${ctx.params.name}`,
        ),
      );
    },
  );

  for (const action of ['start', 'stop'] as const) {
    r.add(
      'POST',
      `/api/codespaces/:name/${action}`,
      {
        summary: `${action === 'start' ? 'Start' : 'Stop'} a codespace`,
        tag: 'codespaces',
        responses: [401, 404, 409, 502],
      },
      authenticate,
      async (ctx) => {
        if (!namePattern.test(ctx.params.name))
          throw new HttpError(422, 'validation_failed', 'Invalid codespace name');
        const cs = await gh<GhCodespace>(
          tokenFor(ctx.principal!.memberId),
          'POST',
          `/user/codespaces/${ctx.params.name}/${action}`,
        );
        audit.append({
          actor: ctx.principal!.memberId,
          action: `codespace.${action}`,
          target: ctx.params.name,
          requestId: ctx.requestId,
        });
        return shape(cs);
      },
    );
  }
}
