/**
 * Engineering domain types (Wave 4, lane B-DOMAIN).
 *
 * Field names deliberately mirror the frontend mocks so F-ENG can swap the
 * data source with minimal adaptation:
 *   - Repository / PullRequest  → Frontend/src/types/engineering.ts
 *   - Monitor                   → Frontend/src/types/operations.ts
 *   - SecurityFinding           → Frontend/src/data/codeSecurity.ts
 *   - Integration / deliveries  → Frontend/src/types/{team,security}.ts
 *
 * Display-only strings the mocks carried (`age`, `ago`, `lastSync`, `when`)
 * are derived on read from the ISO timestamps stored alongside them.
 */

import type { ProductId } from '../../types.ts';

/** Where a row came from. `demo` rows are seeded only outside production and always labelled. */
export type DataSource = 'github' | 'manual' | 'demo';

export type CiStatus = 'passing' | 'failing' | 'running' | 'none';
export type ReviewState = 'review-required' | 'changes-requested' | 'approved' | 'merged';

export interface CommitSummary {
  sha: string;
  message: string;
  /** Member id when the author maps to a TavetaHQ member, otherwise the GitHub login. */
  author: string;
  at: string;
  signed?: boolean;
}

export interface Repo {
  /** Stable id: `gh-<github id>` for GitHub repos, `repo-<slug>` otherwise. */
  id: string;
  /** `owner/name`, as in the frontend's `Repository.name`. */
  name: string;
  product: ProductId;
  defaultBranch: string;
  language: string;
  private: boolean;
  url?: string;
  githubId?: number;
  installationId?: number;
  lastCommit?: CommitSummary;
  recentCommits: CommitSummary[];
  /** Commits per ISO week, oldest first, always 8 buckets. */
  weeklyCommits: number[];
  /** ISO week start (Monday) of the last bucket in `weeklyCommits`. */
  weeklyAnchor: string;
  latestTag: string;
  branchProtection?: { label: string; ok: boolean }[];
  linkedBy: string;
  linkedAt: string;
  updatedAt: string;
  source: DataSource;
}

export interface PullReview {
  by: string;
  state: 'approved' | 'changes_requested' | 'commented' | 'dismissed';
  at: string;
  body?: string;
}

export interface PullRequestRow {
  /** `<repoId>#<number>` */
  id: string;
  repoId: string;
  repo: string;
  product: ProductId;
  number: number;
  title: string;
  branch: string;
  base: string;
  headSha: string;
  taskKey?: string;
  author: string;
  authorLogin?: string;
  reviewers: string[];
  reviews: PullReview[];
  ci: CiStatus;
  review: ReviewState;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  additions: number;
  deletions: number;
  url?: string;
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;
  source: DataSource;
}

export interface CiRun {
  /** `gh-wr-<id>`, `gh-cs-<id>`, `gh-cr-<id>` or `demo-…` */
  id: string;
  repoId: string;
  repo: string;
  product: ProductId;
  kind: 'workflow_run' | 'check_suite' | 'check_run';
  name: string;
  branch: string;
  sha: string;
  event: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  ci: CiStatus;
  prNumbers: number[];
  url?: string;
  startedAt: string;
  completedAt?: string;
  durationSec?: number;
  source: DataSource;
}

export type FindingKind = 'dependency' | 'secret' | 'code' | 'license';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface CodeFinding {
  id: string;
  /** Stable hash of repo + kind + rule/title + location, used to de-duplicate re-ingests. */
  fingerprint: string;
  kind: FindingKind;
  severity: FindingSeverity;
  title: string;
  repoId: string;
  repo: string;
  product: ProductId;
  location: string;
  detail: string;
  fix: string;
  detectedAt: string;
  updatedAt: string;
  status: 'open' | 'fixed' | 'dismissed';
  owner?: string;
  cve?: string;
  ruleId?: string;
  dismissReason?: string;
  /** `ci` (POST ingest), `github` (alert webhook) or `demo`. */
  origin: 'ci' | 'github' | 'demo';
  source: DataSource;
}

export interface GithubInstallation {
  id: number;
  account: string;
  accountType: string;
  repositories: string[];
  suspended: boolean;
  createdAt: string;
  updatedAt: string;
  removedAt?: string;
}

export interface GithubDelivery {
  id: string;
  event: string;
  action?: string;
  at: string;
  handled: boolean;
  note?: string;
}

// ── Monitors ────────────────────────────────────────────────────────────────

export type UptimeTick = 'up' | 'degraded' | 'down';

export interface MonitorRow {
  id: string;
  product: ProductId;
  name: string;
  /** Display target, e.g. `api.renewberry.app/health` (mirrors the mock). */
  target: string;
  url: string;
  kind: 'HTTP' | 'API' | 'Cron';
  method: 'GET' | 'HEAD';
  intervalSec: number;
  failureThreshold: number;
  degradedMs: number;
  expectStatus: number[];
  paused: boolean;
  status: UptimeTick | 'pending' | 'paused';
  responseMs: number;
  consecutiveFailures: number;
  lastCheckedAt?: string;
  lastError?: string;
  nextCheckAt: number;
  openIncidentId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  source: DataSource;
}

export interface MonitorCheck {
  at: string;
  status: UptimeTick;
  httpStatus?: number;
  responseMs: number;
  error?: string;
  /** The pinned IP the check actually connected to. */
  ip?: string;
}

export interface MonitorHistory {
  monitorId: string;
  checks: MonitorCheck[];
}

// ── Integrations + outbound webhooks ────────────────────────────────────────

export type IntegrationKind = 'slack' | 'webhook' | 'pagerduty';

export type OutboundEvent =
  | 'deployment.approved'
  | 'deployment.failed'
  | 'incident.opened'
  | 'incident.resolved'
  | 'monitor.down'
  | 'monitor.up';

export interface IntegrationRow {
  id: string;
  kind: IntegrationKind;
  name: string;
  /** Sealed (AES-256-GCM) credential: Slack URL, PagerDuty routing key or generic endpoint URL. */
  credential: string;
  /** Last 4 characters of the credential, for display only. */
  credentialHint: string;
  products: ProductId[];
  connectedBy: string;
  connectedAt: string;
  updatedAt: string;
}

export interface OutboundWebhook {
  id: string;
  integrationId: string;
  /** Destination URL for generic webhooks; for Slack/PagerDuty it is derived from the integration. */
  url?: string;
  events: OutboundEvent[];
  /** Sealed HMAC signing secret. */
  secret: string;
  secretHint: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  lastRotated: string;
}

export interface WebhookDeliveryRow {
  id: string;
  integrationId: string;
  webhookId: string;
  event: OutboundEvent | 'ping';
  /** JSON payload actually sent (no secrets). */
  payload: string;
  state: 'pending' | 'succeeded' | 'failed';
  attempts: number;
  maxAttempts: number;
  nextAttemptAt?: number;
  lastStatus: number;
  lastError?: string;
  durationMs: number;
  createdAt: string;
  updatedAt: string;
}
