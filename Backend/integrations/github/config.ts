/**
 * GitHub App configuration, read lazily from the environment (WAVE4 §4) so
 * secrets can be rotated without a code change and tests can toggle modes.
 *
 * Modes:
 *  - `app`          GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY → JWT + installation tokens
 *  - `token`        GITHUB_TOKEN only (single-tenant / development)
 *  - `webhook-only` GITHUB_WEBHOOK_SECRET only — data arrives by webhook, no outbound calls
 *  - `demo`         nothing set, non-production → labelled demo dataset
 *  - `unconfigured` nothing set, production → 503 integration_unconfigured
 */

import { config } from '../../config/env.ts';
import { HttpError } from '../../types.ts';

export type GithubMode = 'app' | 'token' | 'webhook-only' | 'demo' | 'unconfigured';

export interface GithubEnv {
  appId?: string;
  privateKey?: string;
  webhookSecret?: string;
  clientId?: string;
  clientSecret?: string;
  token?: string;
  appSlug?: string;
}

const env = (k: string) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

export function githubEnv(): GithubEnv {
  return {
    appId: env('GITHUB_APP_ID'),
    // Private keys are often passed with literal "\n" in container env files.
    privateKey: env('GITHUB_APP_PRIVATE_KEY')?.replace(/\\n/g, '\n'),
    webhookSecret: env('GITHUB_WEBHOOK_SECRET'),
    clientId: env('GITHUB_CLIENT_ID'),
    clientSecret: env('GITHUB_CLIENT_SECRET'),
    token: env('GITHUB_TOKEN'),
    appSlug: env('GITHUB_APP_SLUG'),
  };
}

export function githubMode(): GithubMode {
  const e = githubEnv();
  if (e.appId && e.privateKey) return 'app';
  if (e.token) return 'token';
  if (e.webhookSecret) return 'webhook-only';
  return config.isProd ? 'unconfigured' : 'demo';
}

/** True when GitHub data is live (any credential set) rather than the demo set. */
export function githubLive(): boolean {
  const m = githubMode();
  return m === 'app' || m === 'token' || m === 'webhook-only';
}

/** Read guard for repo/PR/CI routes: 503 in production without configuration. */
export function assertGithubAvailable() {
  if (githubMode() === 'unconfigured')
    throw new HttpError(
      503,
      'integration_unconfigured',
      'GitHub is not configured (set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY or GITHUB_TOKEN)',
    );
}

/** `'github'` when live, `'demo'` otherwise — the top-level `source` on list responses. */
export function githubSource(): 'github' | 'demo' {
  return githubLive() ? 'github' : 'demo';
}
