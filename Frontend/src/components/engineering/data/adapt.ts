/**
 * Adapters from B-DOMAIN's wire shapes (Backend/domain/engineering/views.ts,
 * monitors/scheduler.ts monitorView, routes/{integrations,webhooks,github}.routes.ts)
 * to the UI types in ./types.ts. Pages only ever see the UI types, so a backend
 * rename is a one-file change here.
 *
 * Mapping never invents values: a field the server doesn't send stays
 * undefined and the UI renders "—".
 */

import type { ApiProduct } from '../../../api/types';
import type {
  ApiCiRun,
  ApiCiRunStatus,
  ApiCiState,
  ApiCodeFinding,
  ApiCommit,
  ApiGitHubApp,
  ApiIntegration,
  ApiIntegrationStatus,
  ApiMonitor,
  ApiMonitorCheck,
  ApiMonitorStatus,
  ApiPull,
  ApiPullDetail,
  ApiRepo,
  ApiRepoDetail,
  ApiReview,
  ApiReviewState,
  ApiWebhook,
  ApiWebhookCreated,
  ApiWebhookDelivery,
  DataSource,
  ListResponse,
} from './types';

export interface WireList<T> {
  items: T[];
  nextCursor?: string | null;
  source?: DataSource;
}

const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
const list =
  <W, T>(fn: (w: W) => T) =>
  (body: WireList<W> | W[] | undefined): ListResponse<T> => {
    if (!body) return { items: [] };
    if (Array.isArray(body)) return { items: body.map(fn) };
    return {
      items: (body.items ?? []).map(fn),
      nextCursor: body.nextCursor ?? null,
      source: body.source,
    };
  };

// ── Repos ────────────────────────────────────────────────────────────────
export interface WireCommit {
  sha: string;
  message: string;
  author: string;
  at: string | null;
}
export interface WireRepo {
  id: string;
  name: string;
  product: ApiProduct;
  defaultBranch: string;
  language?: string;
  private?: boolean;
  url?: string | null;
  openPrs?: number;
  ci?: ApiCiState;
  lastCommit?: WireCommit;
  weeklyCommits?: number[];
  latestTag?: string;
  linkedAt?: string;
  source?: DataSource;
}
export interface WireRepoDetail extends WireRepo {
  commits?: WireCommit[];
  branchProtection?: { label: string; ok: boolean }[] | null;
  recentRuns?: WireCiRun[];
}

const commit = (c: WireCommit | undefined): ApiCommit | undefined =>
  c && c.sha && c.at ? { sha: c.sha, message: c.message, author: c.author, at: c.at } : undefined;

export function toRepo(w: WireRepo): ApiRepo {
  return {
    id: w.id,
    name: w.name,
    product: w.product,
    defaultBranch: w.defaultBranch,
    language: w.language || undefined,
    private: w.private,
    url: opt(w.url),
    openPrs: w.openPrs,
    ci: w.ci,
    lastCommit: commit(w.lastCommit),
    weeklyCommits: w.weeklyCommits,
    latestTag: w.latestTag || undefined,
    linkedAt: w.linkedAt,
    source: w.source,
  };
}
export const repoList = list(toRepo);
export function toRepoDetail(w: WireRepoDetail): ApiRepoDetail {
  return {
    ...toRepo(w),
    branchProtection: opt(w.branchProtection),
    recentCommits: (w.commits ?? []).map(commit).filter((c): c is ApiCommit => !!c),
    recentRuns: (w.recentRuns ?? []).map(toCiRun),
  };
}

// ── CI ───────────────────────────────────────────────────────────────────
export interface WireCiRun {
  id: string;
  repoId: string;
  repo: string;
  name: string;
  branch: string;
  sha: string;
  event?: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  ci?: ApiCiState;
  prNumbers?: number[];
  url?: string | null;
  startedAt: string;
  completedAt?: string;
  durationSec?: number;
  source?: DataSource;
}

function runStatus(w: WireCiRun): ApiCiRunStatus {
  if (w.status === 'queued') return 'queued';
  if (w.status === 'in_progress') return 'running';
  switch (w.conclusion) {
    case 'success':
    case 'neutral':
    case 'skipped':
      return 'passed';
    case 'cancelled':
      return 'cancelled';
    case null:
      return w.ci === 'failing' ? 'failed' : 'passed';
    default:
      return 'failed';
  }
}

export function toCiRun(w: WireCiRun): ApiCiRun {
  return {
    id: w.id,
    repoId: w.repoId,
    repo: w.repo,
    workflow: w.name,
    branch: w.branch,
    sha: w.sha,
    status: runStatus(w),
    event: w.event,
    pr: w.prNumbers?.[0],
    startedAt: w.startedAt,
    finishedAt: w.completedAt,
    durationMs: w.durationSec !== undefined ? w.durationSec * 1000 : undefined,
    url: opt(w.url),
    source: w.source,
  };
}
export const ciList = list(toCiRun);

// ── Pull requests ────────────────────────────────────────────────────────
export interface WirePull {
  repoId: string;
  repo: string;
  number: number;
  title: string;
  product: ApiProduct;
  state: 'open' | 'closed' | 'merged';
  branch: string;
  base?: string;
  author: string;
  reviewers: string[];
  ci: ApiCiState;
  review: ApiReviewState;
  additions?: number;
  deletions?: number;
  createdAt: string;
  updatedAt?: string;
  taskKey?: string;
  url?: string | null;
  source?: DataSource;
}
export interface WirePullDetail extends WirePull {
  reviews?: {
    by: string;
    state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
    at: string;
    body?: string;
  }[];
  checks?: WireCiRun[];
}

export function toPull(w: WirePull): ApiPull {
  return { ...w, url: opt(w.url) };
}
export const pullList = list(toPull);

const decision: Record<string, ApiReview['decision']> = {
  approved: 'approve',
  changes_requested: 'request-changes',
  commented: 'comment',
};
export function toPullDetail(w: WirePullDetail): ApiPullDetail {
  return {
    ...toPull(w),
    reviews: (w.reviews ?? [])
      .filter((r) => r.state !== 'dismissed')
      .map((r) => ({ by: r.by, decision: decision[r.state] ?? 'comment', body: r.body, at: r.at })),
    checks: (w.checks ?? []).map(toCiRun),
  };
}

// ── Monitors ─────────────────────────────────────────────────────────────
export interface WireMonitor {
  id: string;
  product: ApiProduct;
  name: string;
  url: string;
  method?: 'GET' | 'HEAD';
  status: ApiMonitorStatus;
  responseMs?: number;
  uptime?: number;
  intervalSec: number;
  failureThreshold?: number;
  expectStatus?: number[];
  paused?: boolean;
  consecutiveFailures?: number;
  lastCheckedAt?: string;
  lastError?: string;
  openIncidentId?: string;
  createdBy?: string;
  createdAt?: string;
  source?: DataSource;
  checksStored?: number;
}

export interface MonitorRow extends ApiMonitor {
  lastError?: string;
  /** Demo monitors are read-only on the server (409). */
  readOnly: boolean;
  source?: DataSource;
}

export function toMonitor(w: WireMonitor): MonitorRow {
  const checked = !!w.lastCheckedAt;
  return {
    id: w.id,
    product: w.product,
    name: w.name,
    url: w.url,
    method: w.method,
    intervalSec: w.intervalSec,
    expectedStatus: w.expectStatus?.[0],
    failureThreshold: w.failureThreshold,
    paused: w.paused,
    status: w.status,
    lastCheckedAt: w.lastCheckedAt,
    lastLatencyMs: checked ? w.responseMs : undefined,
    // The server reports 100% for a monitor with no history; don't present that as measured.
    uptimePct: w.checksStored ? w.uptime : undefined,
    consecutiveFailures: w.consecutiveFailures,
    incidentId: w.openIncidentId,
    createdBy: w.createdBy,
    createdAt: w.createdAt,
    lastError: w.lastError,
    readOnly: w.source === 'demo',
    source: w.source,
  };
}
export const monitorList = list(toMonitor);

export interface WireCheck {
  at: string;
  status: 'up' | 'degraded' | 'down';
  httpStatus?: number;
  responseMs?: number;
  error?: string;
}
export function toCheck(w: WireCheck): ApiMonitorCheck {
  return {
    at: w.at,
    ok: w.status !== 'down',
    status: w.status,
    httpStatus: w.httpStatus,
    latencyMs: w.responseMs,
    error: w.error,
  };
}
export const checkList = list(toCheck);

// ── Integrations & webhooks ──────────────────────────────────────────────
export interface WireIntegration {
  id: string;
  kind: string;
  name: string;
  category?: string;
  status: 'connected' | 'degraded' | 'not-connected';
  detail?: string;
  authority?: string;
  events?: string[];
  products?: string[];
  credentialHint?: string;
  connectedBy?: string;
  connectedAt?: string;
  builtIn?: boolean;
  connectable?: boolean;
  source?: DataSource;
}

export function toIntegration(w: WireIntegration): ApiIntegration {
  const status: ApiIntegrationStatus = w.status === 'not-connected' ? 'available' : w.status;
  return {
    id: w.id,
    kind: w.kind,
    name: w.name,
    status,
    description: w.detail,
    connectedAt: w.connectedAt,
    connectedBy: w.connectedBy,
    scopes: w.events,
    category: w.category,
    builtIn: w.builtIn,
    connectable: w.connectable,
    events: w.events,
    products: w.products,
    credentialHint: w.credentialHint,
    authority: w.authority,
    source: w.source,
  };
}
export const integrationList = (
  body: (WireList<WireIntegration> & { events?: string[] }) | undefined,
): ListResponse<ApiIntegration> => list(toIntegration)(body);

export interface WireHook {
  id: string;
  integrationId: string;
  url: string | null;
  events: string[];
  secretHint?: string;
  active: boolean;
  createdBy?: string;
  createdAt: string;
}
export interface WireDelivery {
  id: string;
  event: string;
  status: number;
  state: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  nextAttemptAt: string | null;
  error: string | null;
  webhookId: string;
  createdAt: string;
  updatedAt: string;
  duration?: string;
}

export function toDelivery(w: WireDelivery): ApiWebhookDelivery {
  const ms = w.duration ? Number.parseInt(w.duration, 10) : NaN;
  return {
    id: w.id,
    event: w.event,
    at: w.updatedAt,
    httpStatus: w.status || undefined,
    ok: w.state === 'succeeded',
    attempt: w.attempts,
    durationMs: Number.isFinite(ms) && w.attempts ? ms : undefined,
    nextRetryAt: opt(w.nextAttemptAt),
    error: opt(w.error),
    state: w.state,
    webhookId: w.webhookId,
  };
}

export function toHook(w: WireHook, deliveries: ApiWebhookDelivery[] = []): ApiWebhook {
  return {
    id: w.id,
    integrationId: w.integrationId,
    url: w.url ?? '',
    events: w.events,
    active: w.active,
    createdAt: w.createdAt,
    createdBy: w.createdBy,
    secretHint: w.secretHint,
    deliveries: deliveries.filter((d) => d.webhookId === w.id),
  };
}

/** `GET /api/integrations/:id/webhooks` → `{items: hooks, deliveries}`: deliveries are attached per hook. */
export function hookList(
  body: (WireList<WireHook> & { deliveries?: WireDelivery[] }) | undefined,
): ListResponse<ApiWebhook> {
  const deliveries = (body?.deliveries ?? []).map(toDelivery);
  return {
    items: (body?.items ?? []).map((h) => toHook(h, deliveries)),
    nextCursor: body?.nextCursor ?? null,
  };
}

export function toHookCreated(w: WireHook & { signingSecret?: string }): ApiWebhookCreated {
  return { ...toHook(w), secret: w.signingSecret };
}

// ── GitHub App ───────────────────────────────────────────────────────────
export interface WireGitHubApp {
  mode: string;
  configured: boolean;
  source?: DataSource;
  webhook?: ApiGitHubApp['webhook'];
  installations?: {
    id: number;
    account: string;
    suspended: boolean;
    repositories: string[];
    createdAt?: string;
  }[];
  linkedRepositories?: number;
}

export function toGitHubApp(w: WireGitHubApp): ApiGitHubApp {
  const first = w.installations?.[0];
  return {
    installed: !!first || w.mode === 'app' || w.mode === 'token',
    account: first?.account,
    installationId: first?.id,
    installedAt: first?.createdAt,
    suspended: first?.suspended,
    repositorySelection: undefined,
    source: w.source,
    mode: w.mode,
    configured: w.configured,
    webhook: w.webhook,
    installations: w.installations,
    linkedRepositories: w.linkedRepositories,
  };
}

// ── Code findings ────────────────────────────────────────────────────────
export interface WireFinding {
  id: string;
  kind: ApiCodeFinding['kind'];
  severity: ApiCodeFinding['severity'];
  title: string;
  repoId: string;
  repo: string;
  product?: ApiProduct;
  location?: string;
  detail?: string;
  fix?: string;
  detectedAt: string;
  status: ApiCodeFinding['status'];
  cve?: string;
  ruleId?: string;
  origin?: ApiCodeFinding['origin'];
  source?: DataSource;
}

export function toFinding(w: WireFinding): ApiCodeFinding {
  const [file, line] = (w.location ?? '').split(':');
  return {
    id: w.id,
    repoId: w.repoId,
    repo: w.repo,
    product: w.product,
    kind: w.kind,
    severity: w.severity,
    status: w.status,
    title: w.title,
    detail: w.detail,
    file: file || undefined,
    line: line && /^\d+$/.test(line) ? Number(line) : undefined,
    advisory: w.cve ?? w.ruleId,
    fix: w.fix,
    detectedAt: w.detectedAt,
    origin: w.origin,
    source: w.source,
  };
}
export const findingList = list(toFinding);
