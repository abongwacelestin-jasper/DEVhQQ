/**
 * Response shapes F-ENG assumes for the B-DOMAIN, ML and existing operations
 * endpoints (WAVE4 §6). Types only — no fixtures, no defaults.
 *
 * Optional fields are optional on purpose: the UI renders "—" or hides a
 * section when the server does not send them, it never fills them in.
 * Every list is `{ items, nextCursor?, source? }`; `source: 'demo'` means the
 * server is serving labelled sample data (GitHub env vars unset in non-prod).
 */

import type { ApiProduct } from '../../../api/types';

export type DataSource = 'github' | 'demo' | 'live' | 'mixed' | 'manual' | 'ci' | 'webhook';

export interface ListResponse<T> {
  items: T[];
  nextCursor?: string | null;
  source?: DataSource;
}

// ── GitHub App ───────────────────────────────────────────────────────────
/** GET /api/github/app */
export interface ApiGitHubApp {
  installed: boolean;
  account?: string;
  installationId?: number | string;
  repositorySelection?: 'all' | 'selected';
  permissions?: Record<string, 'read' | 'write' | 'none'>;
  events?: string[];
  installedAt?: string;
  suspended?: boolean;
  source?: DataSource;
  /** Server mode: `app` | `token` | `webhook-only` | `demo` | `unconfigured`. */
  mode?: string;
  configured?: boolean;
  webhook?: {
    url: string;
    secretConfigured: boolean;
    lastDeliveryAt: string | null;
    deliveries24h: number;
  };
  installations?: { id: number; account: string; suspended: boolean; repositories: string[] }[];
  linkedRepositories?: number;
}

/** GET /api/github/install-url */
export interface ApiInstallUrl {
  url: string;
}

// ── Repositories ─────────────────────────────────────────────────────────
export type ApiCiState = 'passing' | 'failing' | 'running' | 'none';

export interface ApiCommit {
  sha: string;
  message: string;
  /** Member id when the GitHub login maps to a member, otherwise the login. */
  author: string;
  at: string;
}

/** GET /api/repos (items) */
export interface ApiRepo {
  id: string;
  /** owner/name */
  name: string;
  product: ApiProduct;
  defaultBranch: string;
  language?: string;
  private?: boolean;
  url?: string;
  openPrs?: number;
  ci?: ApiCiState;
  lastCommit?: ApiCommit;
  /** Oldest → newest commit counts per week. */
  weeklyCommits?: number[];
  latestTag?: string;
  linkedAt?: string;
  source?: DataSource;
}

/** GET /api/repos/:repoId */
export interface ApiRepoDetail extends ApiRepo {
  branchProtection?: { label: string; ok: boolean }[];
  recentCommits?: ApiCommit[];
  recentRuns?: ApiCiRun[];
}

// ── Pull requests ────────────────────────────────────────────────────────
export type ApiReviewState = 'review-required' | 'changes-requested' | 'approved' | 'merged';
export type ApiReviewDecision = 'approve' | 'request-changes' | 'comment';

export interface ApiReview {
  id?: string;
  by: string;
  decision: ApiReviewDecision;
  body?: string;
  at: string;
}

/** GET /api/pulls (items) */
export interface ApiPull {
  repoId: string;
  repo: string;
  number: number;
  title: string;
  product: ApiProduct;
  state: 'open' | 'closed' | 'merged';
  branch: string;
  base?: string;
  /** Member id when mapped, otherwise the GitHub login. */
  author: string;
  reviewers: string[];
  ci: ApiCiState;
  review: ApiReviewState;
  additions?: number;
  deletions?: number;
  createdAt: string;
  updatedAt?: string;
  taskKey?: string;
  url?: string;
  source?: DataSource;
}

/** GET /api/pulls/:repoId/:number and POST …/review */
export interface ApiPullDetail extends ApiPull {
  body?: string;
  reviews?: ApiReview[];
  commits?: ApiCommit[];
  checks?: ApiCiRun[];
  files?: { path: string; additions: number; deletions: number }[];
}

// ── CI ───────────────────────────────────────────────────────────────────
export type ApiCiRunStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled';

/** GET /api/ci/runs (items) and GET /api/ci/runs/:runId */
export interface ApiCiRun {
  id: string;
  repoId: string;
  repo: string;
  workflow: string;
  branch: string;
  sha: string;
  status: ApiCiRunStatus;
  event?: string;
  pr?: number;
  actor?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  url?: string;
  jobs?: { name: string; status: ApiCiRunStatus; durationMs?: number }[];
  tests?: { passed: number; failed: number; skipped: number };
  source?: DataSource;
}

// ── Monitors ─────────────────────────────────────────────────────────────
export type ApiMonitorStatus = 'up' | 'degraded' | 'down' | 'pending' | 'paused';

/** GET /api/monitors (items) */
export interface ApiMonitor {
  id: string;
  product: ApiProduct;
  name: string;
  url: string;
  method?: 'GET' | 'HEAD';
  intervalSec: number;
  timeoutMs?: number;
  expectedStatus?: number;
  failureThreshold?: number;
  paused?: boolean;
  status: ApiMonitorStatus;
  lastCheckedAt?: string;
  lastLatencyMs?: number;
  /** 0–100 over the server's window. */
  uptimePct?: number;
  consecutiveFailures?: number;
  incidentId?: string;
  createdBy?: string;
  createdAt?: string;
}

/** POST /api/monitors, PATCH /api/monitors/:id */
export interface MonitorInput {
  name: string;
  url: string;
  product: ApiProduct;
  intervalSec: number;
  expectedStatus?: number;
  paused?: boolean;
}

/** GET /api/monitors/:id/checks (items, newest first) */
export interface ApiMonitorCheck {
  id?: string;
  at: string;
  ok: boolean;
  /** The server's verdict, including `degraded` (slow but up). */
  status?: 'up' | 'degraded' | 'down';
  httpStatus?: number;
  latencyMs?: number;
  error?: string;
}

// ── Integrations & outbound webhooks ─────────────────────────────────────
export type ApiIntegrationStatus =
  'connected' | 'degraded' | 'error' | 'disconnected' | 'available';

/** GET /api/integrations (items) */
export interface ApiIntegration {
  id: string;
  kind: string;
  name: string;
  status: ApiIntegrationStatus;
  account?: string;
  scopes?: string[];
  connectedAt?: string;
  connectedBy?: string;
  lastEventAt?: string;
  description?: string;
  source?: DataSource;
  category?: string;
  /** DevHQ built-ins (GitHub App, uptime checks) can't be connected/disconnected here. */
  builtIn?: boolean;
  /** Catalogue entry that can be connected with POST /connect. */
  connectable?: boolean;
  /** Outbound events this integration is subscribed to. */
  events?: string[];
  products?: string[];
  credentialHint?: string;
  authority?: string;
}

/** POST /api/integrations/:kind/connect — may hand back an OAuth/App install URL. */
export interface ApiConnectResponse extends Partial<ApiIntegration> {
  redirectUrl?: string;
  /** HMAC signing secret for receivers — shown once. */
  signingSecret?: string;
}

export interface ApiWebhookDelivery {
  id: string;
  event: string;
  at: string;
  /** HTTP status the receiver answered with; absent on network failure. */
  httpStatus?: number;
  ok: boolean;
  attempt?: number;
  durationMs?: number;
  nextRetryAt?: string;
  error?: string;
  state?: 'pending' | 'succeeded' | 'failed';
  webhookId?: string;
}

/** GET /api/integrations/:id/webhooks (items) */
export interface ApiWebhook {
  id: string;
  integrationId: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  createdBy?: string;
  /** Last four characters of the signing secret. The secret itself is shown once on create. */
  secretHint?: string;
  deliveries?: ApiWebhookDelivery[];
}

/** POST /api/integrations/:id/webhooks */
export interface ApiWebhookCreated extends ApiWebhook {
  secret?: string;
}

// ── Code security ────────────────────────────────────────────────────────
export type ApiFindingKind = 'dependency' | 'secret' | 'code' | 'license';
export type ApiFindingSeverity = 'critical' | 'high' | 'medium' | 'low';

/** GET /api/security/code-findings (items) */
export interface ApiCodeFinding {
  id: string;
  repoId?: string;
  repo: string;
  product?: ApiProduct;
  kind: ApiFindingKind;
  severity: ApiFindingSeverity;
  status: 'open' | 'fixed' | 'dismissed';
  title: string;
  detail?: string;
  file?: string;
  line?: number;
  package?: string;
  version?: string;
  fixedIn?: string;
  advisory?: string;
  detectedAt: string;
  origin?: 'ci' | 'webhook' | 'github' | 'demo';
  /** Remediation advice. */
  fix?: string;
  source?: DataSource;
}

// ── Incidents (existing backend) ─────────────────────────────────────────
/** GET /api/incidents/_stats */
export interface ApiIncidentStats {
  open: number;
  resolved: number;
  mttrMinutes: number | null;
  bySeverity: Record<'SEV1' | 'SEV2' | 'SEV3', number>;
}

// ── ML insights ──────────────────────────────────────────────────────────
/** GET /api/insights/deployments/:id */
export interface ApiDeployRisk {
  deploymentId?: string;
  /** 0–1 */
  score: number;
  level: 'low' | 'medium' | 'high';
  source: 'model' | 'heuristic';
  reasons: string[];
  modelVersion?: string;
}
