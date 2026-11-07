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
import type {
  ApiCiRun,
  ApiCodeFinding,
  ApiConnectResponse,
  ApiDeployRisk,
  ApiGitHubApp,
  ApiIncidentStats,
  ApiInstallUrl,
  ApiIntegration,
  ApiMonitor,
  ApiMonitorCheck,
  ApiPull,
  ApiPullDetail,
  ApiRepo,
  ApiRepoDetail,
  ApiReviewDecision,
  ApiWebhook,
  ApiWebhookCreated,
  MonitorInput,
} from './types';

/** SSE event types each domain refetches on (the `type` passed to the backend's `publish`). */
export const EVENTS = {
  repos: ['repo', 'github'],
  pulls: ['pull', 'github'],
  ci: ['ci', 'github'],
  monitors: ['monitor'],
  integrations: ['integration', 'webhook'],
  findings: ['code-finding', 'ci'],
  deployments: ['deployment'],
  incidents: ['incident'],
} as const;

const enc = encodeURIComponent;

// ── GitHub App ───────────────────────────────────────────────────────────
export function useGitHubAppStatus() {
  return useApiResource<ApiGitHubApp>('/api/github/app', { events: EVENTS.repos });
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
  const list = useApiList<ApiRepo>(withQuery('/api/repos', filters), { events: EVENTS.repos });
  const { mutate } = list;
  const link = useCallback(
    async (body: { name: string; product: string }) => {
      const created = await api<ApiRepo>('/api/repos', { method: 'POST', body });
      mutate((l) => [created, ...l.filter((r) => r.id !== created.id)]);
      return created;
    },
    [mutate],
  );
  return { ...list, link };
}

export function useRepo(repoId: string | undefined) {
  return useApiResource<ApiRepoDetail>(repoId ? `/api/repos/${enc(repoId)}` : null, {
    events: EVENTS.repos,
  });
}

// ── Pull requests ────────────────────────────────────────────────────────
export function usePulls(filters: { repo?: string; state?: string; author?: string } = {}) {
  return useApiList<ApiPull>(withQuery('/api/pulls', filters), { events: EVENTS.pulls });
}

export function usePull(repoId: string | undefined, number: number | undefined) {
  const res = useApiResource<ApiPullDetail>(
    repoId && number ? `/api/pulls/${enc(repoId)}/${number}` : null,
    { events: EVENTS.pulls },
  );
  const { set, reload } = res;
  const review = useCallback(
    async (decision: ApiReviewDecision, body: string) => {
      if (!repoId || !number) return null;
      try {
        const updated = await api<ApiPullDetail>(`/api/pulls/${enc(repoId)}/${number}/review`, {
          method: 'POST',
          body: { decision, body },
        });
        if (updated && typeof updated === 'object' && 'number' in updated) set(updated);
        else await reload();
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
  return useApiList<ApiCiRun>(withQuery('/api/ci/runs', filters), { events: EVENTS.ci });
}

export function useCiRun(runId: string | undefined) {
  return useApiResource<ApiCiRun>(runId ? `/api/ci/runs/${enc(runId)}` : null, {
    events: EVENTS.ci,
  });
}

// ── Monitors ─────────────────────────────────────────────────────────────
export function useMonitors() {
  // Checks run on a server schedule; poll as a fallback in case the stream drops.
  const list = useApiList<ApiMonitor>('/api/monitors', { events: EVENTS.monitors, pollMs: 60_000 });
  const { mutate, reload } = list;

  const create = useCallback(
    async (input: MonitorInput) => {
      const created = await api<ApiMonitor>('/api/monitors', { method: 'POST', body: input });
      mutate((l) => [created, ...l]);
      return created;
    },
    [mutate],
  );
  const update = useCallback(
    async (id: string, patch: Partial<MonitorInput>) => {
      try {
        const updated = await api<ApiMonitor>(`/api/monitors/${enc(id)}`, {
          method: 'PATCH',
          body: patch,
        });
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
  return { ...list, create, update, remove };
}

export function useMonitorChecks(id: string | undefined) {
  return useApiList<ApiMonitorCheck>(id ? `/api/monitors/${enc(id)}/checks` : null, {
    events: EVENTS.monitors,
  });
}

// ── Integrations ─────────────────────────────────────────────────────────
export function useIntegrations() {
  const list = useApiList<ApiIntegration>('/api/integrations', { events: EVENTS.integrations });
  const { mutate, reload } = list;

  const connect = useCallback(
    async (kind: string, config?: Record<string, string>) => {
      const res = await api<ApiConnectResponse>(`/api/integrations/${enc(kind)}/connect`, {
        method: 'POST',
        body: config ? { config } : {},
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
  const list = useApiList<ApiWebhook>(id ? `/api/integrations/${enc(id)}/webhooks` : null, {
    events: EVENTS.integrations,
  });
  const { mutate, reload } = list;
  const add = useCallback(
    async (body: { url: string; events: string[] }) => {
      if (!id) return null;
      const created = await api<ApiWebhookCreated>(`/api/integrations/${enc(id)}/webhooks`, {
        method: 'POST',
        body,
      });
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
  return { ...list, add, remove };
}

// ── Code security ────────────────────────────────────────────────────────
export function useCodeFindings(filters: { repo?: string } = {}) {
  return useApiList<ApiCodeFinding>(withQuery('/api/security/code-findings', filters), {
    events: EVENTS.findings,
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
