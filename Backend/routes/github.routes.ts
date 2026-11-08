/**
 * GitHub App routes.
 *
 *   POST /api/github/webhook      public — HMAC-verified on the raw body, replay-protected
 *   GET  /api/github/app          install status (mode, installations, webhook health, rate limit)
 *   GET  /api/github/install-url  where an Owner installs the App (Administration:manage)
 *
 * GitHub must be configured to send `application/json` payloads.
 */

import type { Router } from '../lib/http.ts';
import { authenticate } from '../middleware/authenticate.ts';
import { requireArea } from '../auth/rbac.ts';
import { audit } from '../audit/auditLog.ts';
import { hmac, randomToken } from '../security/crypto.ts';
import { HttpError } from '../types.ts';
import { ghDeliveries, ghInstallations, repos } from '../domain/engineering/store.ts';
import { githubEnv, githubMode, githubSource } from '../integrations/github/config.ts';
import { getAppInfo, rateLimit } from '../integrations/github/client.ts';
import { receiveWebhook } from '../integrations/github/webhook.ts';

export function registerGithubRoutes(r: Router) {
  r.add(
    'POST',
    '/api/github/webhook',
    {
      summary:
        'GitHub App webhook (X-Hub-Signature-256 over raw body, delivery-id replay protection)',
      tag: 'github',
      auth: 'public',
      responses: [400, 401, 409, 413, 415, 429, 503],
    },
    async (ctx) => {
      const result = await receiveWebhook({
        rawBody: ctx.rawBody,
        body: ctx.body,
        headers: ctx.req.headers,
        requestId: ctx.requestId,
      });
      ctx.status = 202;
      return result;
    },
  );

  r.add(
    'GET',
    '/api/github/app',
    { summary: 'GitHub App install status', tag: 'github' },
    authenticate,
    requireArea('Repository', 'view'),
    () => {
      const e = githubEnv();
      const mode = githubMode();
      const deliveries = [...ghDeliveries.values()].sort((a, b) => b.at.localeCompare(a.at));
      const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
      return {
        mode,
        configured: mode === 'app' || mode === 'token' || mode === 'webhook-only',
        source: githubSource(),
        appId: e.appId ?? null,
        oauthConfigured: !!(e.clientId && e.clientSecret),
        webhook: {
          url: `${process.env.PUBLIC_URL ?? 'http://localhost:8080'}/api/github/webhook`,
          secretConfigured: !!e.webhookSecret,
          lastDeliveryAt: deliveries[0]?.at ?? null,
          deliveries24h: deliveries.filter((d) => d.at >= dayAgo).length,
          recent: deliveries.slice(0, 10),
        },
        installations: [...ghInstallations.values()]
          .filter((i) => !i.removedAt)
          .map((i) => ({
            id: i.id,
            account: i.account,
            accountType: i.accountType,
            repositories: i.repositories,
            suspended: i.suspended,
            createdAt: i.createdAt,
          })),
        linkedRepositories: [...repos.values()].filter((x) => x.source !== 'demo').length,
        rateLimit:
          rateLimit.remaining >= 0
            ? {
                remaining: rateLimit.remaining,
                limit: rateLimit.limit,
                resetAt: new Date(rateLimit.resetAt).toISOString(),
              }
            : null,
      };
    },
  );

  r.add(
    'GET',
    '/api/github/install-url',
    {
      summary: 'GitHub App installation URL (state is HMAC-signed)',
      tag: 'github',
      responses: [401, 403, 429, 502, 503],
    },
    authenticate,
    requireArea('Administration', 'manage'),
    async (ctx) => {
      if (githubMode() !== 'app')
        throw new HttpError(
          503,
          'integration_unconfigured',
          'Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY to install the GitHub App',
        );
      const app = await getAppInfo();
      const nonce = randomToken(12);
      const state = `${nonce}.${hmac(`gh-install:${ctx.principal!.memberId}:${nonce}`)}`;
      audit.append({
        actor: ctx.principal!.memberId,
        action: 'github.install_url_issued',
        target: app.slug,
        requestId: ctx.requestId,
      });
      return {
        url: `https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new?state=${encodeURIComponent(state)}`,
        slug: app.slug,
      };
    },
  );
}
