/**
 * Per-resource hooks for the engineering & operations pages.
 *
 * Each returns the `useApiList` / `useApiResource` state (loading, error,
 * unconfigured, empty, pagination, abort-on-unmount, SSE refetch) plus the
 * domain's write actions. Writes never fake success: they await the server,
 * replace the row with its response, and on failure surface the ApiError to
 * the caller (for inline display) and resync.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../../api/client';
import type { ApiArea, ApiLevel, Capabilities } from '../../../api/types';
import { useAuth } from '../../../contexts/AuthContext';
import { useApiList, useApiResource, withQuery } from './useApi';
import {
  checkList,
  ciList,
  findingList,
  hookList,
  integrationList,
  monitorList,
  pullList,
  repoList,
  toCiRun,
  toGitHubApp,
  toHookCreated,
  toMonitor,
  toPullDetail,
  toRepoDetail,
  type MonitorRow,
  type WireCiRun,
  type WireGitHubApp,
  type WireHook,
  type WireMonitor,
  type WirePullDetail,
  type WireRepoDetail,
} from './adapt';
import type {
  ApiCiRun,
  ApiConnectResponse,
  ApiDeployRisk,
  ApiGitHubApp,
  ApiIncidentStats,
  ApiInstallUrl,
  ApiMonitorCheck,
  ApiPullDetail,
  ApiRepo,
  ApiRepoDetail,
  ApiReviewDecision,
  ApiWebhookCreated,
  MonitorInput,
} from './types';

export type { MonitorRow };

/** SSE event types each domain refetches on (the `type` passed to the backend's `publish`). */
export const EVENTS = {
  repos: ['repo', 'github'],
  pulls: ['pull_request', 'github'],
  ci: ['ci', 'github'],
  monitors: ['monitor'],
  integrations: ['integration'],
  findings: ['code_finding'],
  deployments: ['deployment'],
  incidents: ['incident'],
} as const;

const enc = encodeURIComponent;

// ── GitHub App ───────────────────────────────────────────────────────────
export function useGitHubAppStatus() {
  return useApiResource<ApiGitHubApp, WireGitHubApp>('/api/github/app', {
    events: EVENTS.repos,
    select: toGitHubApp,
  });
}

/** Resolves the GitHub App install URL on demand; null when the server can't provide one. */
export async function fetchInstallUrl(): Promise<string | null> {
  try {
    const r = await api<ApiInstallUrl>('/api/github/install-url');
    return r?.url ?? null;
  } catch {
    return null;
  }
}

// ── Repositories ─────────────────────────────────────────────────────────
export function useRepos(filters: { product?: string } = {}) {
  const list = useApiList<ApiRepo, Parameters<typeof repoList>[0]>(
    withQuery('/api/repos', filters),
    { events: EVENTS.repos, select: repoList },
  );
  const { mutate } = list;
  const link = useCallback(
    async (body: { name: string; product: string }) => {
      const created: ApiRepo = toRepoDetail(
        await api<WireRepoDetail>('/api/repos', {
          method: 'POST',
          body: { fullName: body.name, product: body.product },
        }),
      );
      mutate((l) => [created, ...l.filter((r) => r.id !== created.id)]);
      return created;
    },
    [mutate],
  );
  return { ...list, link };
}

export function useRepo(repoId: string | undefined) {
  return useApiResource<ApiRepoDetail, WireRepoDetail>(
    repoId ? `/api/repos/${enc(repoId)}` : null,
    { events: EVENTS.repos, select: toRepoDetail },
  );
}

// ── Pull requests ────────────────────────────────────────────────────────
export function usePulls(filters: { repo?: string; state?: string; author?: string } = {}) {
  return useApiList(withQuery('/api/pulls', filters), { events: EVENTS.pulls, select: pullList });
}

export function usePull(repoId: string | undefined, number: number | undefined) {
  const res = useApiResource<ApiPullDetail, WirePullDetail>(
    repoId && number ? `/api/pulls/${enc(repoId)}/${number}` : null,
    { events: EVENTS.pulls, select: toPullDetail },
  );
  const { set, reload } = res;
  const review = useCallback(
    async (decision: ApiReviewDecision, body: string) => {
      if (!repoId || !number) return null;
      try {
        const raw = await api<WirePullDetail>(`/api/pulls/${enc(repoId)}/${number}/review`, {
          method: 'POST',
          // The server requires a body for request-changes/comment; approve may be empty.
          body: body.trim() ? { decision, body } : { decision },
        });
        const updated = toPullDetail(raw);
        set(updated);
        return updated;
      } catch (e) {
        void reload();
        throw e;
      }
    },
    [repoId, number, set, reload],
  );
  return { ...res, review };
}

// ── CI ───────────────────────────────────────────────────────────────────
export function useCiRuns(filters: { repo?: string; branch?: string } = {}) {
  return useApiList(withQuery('/api/ci/runs', filters), { events: EVENTS.ci, select: ciList });
}

export function useCiRun(runId: string | undefined) {
  return useApiResource<ApiCiRun, WireCiRun>(runId ? `/api/ci/runs/${enc(runId)}` : null, {
    events: EVENTS.ci,
    select: toCiRun,
  });
}

// ── Monitors ─────────────────────────────────────────────────────────────
export function useMonitors() {
  // Checks run on a server schedule; poll as a fallback in case the stream drops.
  const { allows } = useAuth();
  const list = useApiList(allows('Infrastructure') ? '/api/monitors' : null, {
    events: EVENTS.monitors,
    pollMs: 60_000,
    select: monitorList,
  });
  const { mutate, reload } = list;

  const create = useCallback(
    async (input: MonitorInput) => {
      const created = toMonitor(
        await api<WireMonitor>('/api/monitors', { method: 'POST', body: monitorBody(input) }),
      );
      mutate((l) => [created, ...l]);
      return created;
    },
    [mutate],
  );
  const update = useCallback(
    async (id: string, patch: Partial<MonitorInput>) => {
      try {
        const updated = toMonitor(
          await api<WireMonitor>(`/api/monitors/${enc(id)}`, {
            method: 'PATCH',
            // product can't change after creation.
            body: monitorBody({ ...patch, product: undefined }),
          }),
        );
        mutate((l) => l.map((m) => (m.id === id ? updated : m)));
        return updated;
      } catch (e) {
        void reload();
        throw e;
      }
    },
    [mutate, reload],
  );
  const remove = useCallback(
    async (id: string) => {
      try {
        await api<unknown>(`/api/monitors/${enc(id)}`, { method: 'DELETE' });
        mutate((l) => l.filter((m) => m.id !== id));
      } catch (e) {
        void reload();
        throw e;
      }
    },
    [mutate, reload],
  );
  /** POST /api/monitors/:id/check — run a probe now (not for demo monitors). */
  const checkNow = useCallback(
    async (id: string) => {
      const res = await api<{ monitor: WireMonitor }>(`/api/monitors/${enc(id)}/check`, {
        method: 'POST',
      });
      const updated = toMonitor(res.monitor);
      mutate((l) => l.map((m) => (m.id === id ? updated : m)));
      return updated;
    },
    [mutate],
  );
  return { ...list, create, update, remove, checkNow };
}

/** UI form → server body (`expectStatus` is a list on the server). */
function monitorBody(input: Partial<MonitorInput>) {
  return {
    name: input.name,
    url: input.url,
    product: input.product,
    intervalSec: input.intervalSec,
    expectStatus: input.expectedStatus ? [input.expectedStatus] : undefined,
    paused: input.paused,
  };
}

export function useMonitorChecks(id: string | undefined) {
  return useApiList<ApiMonitorCheck, Parameters<typeof checkList>[0]>(
    id ? `/api/monitors/${enc(id)}/checks?limit=40` : null,
    { events: EVENTS.monitors, select: checkList },
  );
}

// ── Integrations ─────────────────────────────────────────────────────────
export function useIntegrations() {
  const list = useApiList('/api/integrations', {
    events: EVENTS.integrations,
    select: integrationList,
  });
  const { mutate, reload } = list;

  /**
   * POST /api/integrations/:kind/connect with `{name?, url?, routingKey?, events?, products?}`.
   * The response carries `signingSecret` once.
   */
  const connect = useCallback(
    async (kind: string, config?: ConnectInput) => {
      const res = await api<ApiConnectResponse>(`/api/integrations/${enc(kind)}/connect`, {
        method: 'POST',
        body: config ?? {},
      });
      // OAuth / App flows answer with a URL to continue at the provider.
      if (res?.redirectUrl) return res;
      await reload();
      return res;
    },
    [reload],
  );
  const disconnect = useCallback(
    async (id: string) => {
      await api<unknown>(`/api/integrations/${enc(id)}`, { method: 'DELETE' });
      mutate((l) => l.filter((i) => i.id !== id));
      void reload();
    },
    [mutate, reload],
  );
  return { ...list, connect, disconnect };
}

export function useIntegrationWebhooks(id: string | undefined) {
  const list = useApiList(id ? `/api/integrations/${enc(id)}/webhooks` : null, {
    events: EVENTS.integrations,
    select: hookList,
  });
  const { mutate, reload } = list;
  const add = useCallback(
    async (body: { url: string; events: string[] }): Promise<ApiWebhookCreated | null> => {
      if (!id) return null;
      const created = toHookCreated(
        await api<WireHook & { signingSecret?: string }>(`/api/integrations/${enc(id)}/webhooks`, {
          method: 'POST',
          body: body.url ? body : { events: body.events },
        }),
      );
      mutate((l) => [created, ...l]);
      return created;
    },
    [id, mutate],
  );
  const remove = useCallback(
    async (webhookId: string) => {
      if (!id) return;
      await api<unknown>(`/api/integrations/${enc(id)}/webhooks/${enc(webhookId)}`, {
        method: 'DELETE',
      });
      mutate((l) => l.filter((w) => w.id !== webhookId));
      void reload();
    },
    [id, mutate, reload],
  );
  /** POST …/webhooks/:webhookId/test — queues a signed `ping` delivery. */
  const test = useCallback(
    async (webhookId: string) => {
      if (!id) return;
      await api<unknown>(`/api/integrations/${enc(id)}/webhooks/${enc(webhookId)}/test`, {
        method: 'POST',
      });
      void reload();
    },
    [id, reload],
  );
  return { ...list, add, remove, test };
}

export interface ConnectInput {
  name?: string;
  url?: string;
  routingKey?: string;
  events?: string[];
  products?: string[];
}

// ── Code security ────────────────────────────────────────────────────────
export function useCodeFindings(filters: { repo?: string } = {}) {
  return useApiList(withQuery('/api/security/code-findings', filters), {
    events: EVENTS.findings,
    select: findingList,
  });
}

// ── Incidents & insights ─────────────────────────────────────────────────
export function useIncidentStats() {
  return useApiResource<ApiIncidentStats>('/api/incidents/_stats', { events: EVENTS.incidents });
}

/** Deploy-risk insight. Pages hide it unless `status === 'ready'`. */
export function useInsights(deploymentId: string | undefined) {
  return useApiResource<ApiDeployRisk>(
    deploymentId ? `/api/insights/deployments/${enc(deploymentId)}` : null,
    { events: EVENTS.deployments },
  );
}

// ── Permissions ──────────────────────────────────────────────────────────
const RANK: Record<ApiLevel, number> = { none: 0, view: 1, contribute: 2, manage: 3, admin: 4 };
let capsCache: { memberId: string; promise: Promise<Capabilities | null> } | null = null;

/**
 * The server's area levels for the signed-in member, for actions that have no
 * named UI `Action` (create monitor, connect integration, review a PR). The
 * server still enforces every call; this only decides what we offer.
 * Returns `null` while loading — callers treat that as "not allowed yet".
 */
export function useServerLevel() {
  const { session } = useAuth();
  const memberId = session?.memberId ?? null;
  const [caps, setCaps] = useState<Capabilities | null>(null);

  useEffect(() => {
    if (!memberId) {
      setCaps(null);
      return;
    }
    if (!capsCache || capsCache.memberId !== memberId) {
      capsCache = {
        memberId,
        promise: api<Capabilities>('/api/me/capabilities').catch(() => null),
      };
    }
    let alive = true;
    void capsCache.promise.then((c) => {
      if (alive) setCaps(c);
    });
    return () => {
      alive = false;
    };
  }, [memberId]);

  const atLeast = useCallback(
    (area: ApiArea, level: ApiLevel) => !!caps && RANK[caps.matrix[area] ?? 'none'] >= RANK[level],
    [caps],
  );
  return { atLeast, loaded: !!caps, memberId };
}

export { ApiError };
