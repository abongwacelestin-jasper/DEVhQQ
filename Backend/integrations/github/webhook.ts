/**
 * GitHub webhook receiver.
 *
 * Verification order (fail closed):
 *  1. GITHUB_WEBHOOK_SECRET must be set — otherwise 503 (we never accept unsigned events).
 *  2. `X-Hub-Signature-256: sha256=<hex>` is recomputed over the RAW body bytes
 *     (`ctx.rawBody`, never re-serialised JSON) and compared in constant time → 401.
 *  3. `X-GitHub-Delivery` must be new → 409 on replay. Delivery ids are kept 7 days.
 * Only then is the event applied. Each applied delivery is audited.
 */

import { createHmac } from 'node:crypto';
import { audit } from '../../audit/auditLog.ts';
import { publish } from '../../lib/events.ts';
import { safeEqual } from '../../security/crypto.ts';
import { HttpError, type ProductId } from '../../types.ts';
import {
  bumpWeekly,
  ciRuns,
  findRepo,
  ghDeliveries,
  ghInstallations,
  memberForLogin,
  pulls,
  repos,
  weekStart,
} from '../../domain/engineering/store.ts';
import type {
  CiRun,
  CiStatus,
  CommitSummary,
  PullRequestRow,
  PullReview,
  Repo,
  ReviewState,
} from '../../domain/engineering/types.ts';
import { upsertFinding, type FindingInput } from '../../domain/engineering/findings.ts';
import { githubEnv } from './config.ts';
import { forgetInstallationToken } from './client.ts';
import { linkPullToTask } from './linker.ts';

const DELIVERY_TTL_MS = 7 * 86_400_000;
const DELIVERY_MAX = 10_000;

// ── Minimal payload shapes (only the fields we read) ────────────────────────

interface GhUser {
  login: string;
}
interface GhRepo {
  id: number;
  full_name: string;
  default_branch?: string;
  language?: string | null;
  private?: boolean;
  html_url?: string;
}
interface GhPull {
  number: number;
  title: string;
  state: 'open' | 'closed';
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  user: GhUser;
  head: { ref: string; sha: string };
  base: { ref: string };
  requested_reviewers?: GhUser[];
  additions?: number;
  deletions?: number;
  html_url?: string;
  created_at: string;
  updated_at: string;
}
interface GhRun {
  id: number;
  name?: string;
  head_branch?: string | null;
  head_sha: string;
  status: string;
  conclusion: string | null;
  event?: string;
  html_url?: string;
  url?: string;
  pull_requests?: { number: number }[];
  run_started_at?: string;
  started_at?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  check_suite?: { head_branch?: string | null; pull_requests?: { number: number }[] };
  app?: { name?: string };
}
interface GhPayload {
  action?: string;
  sender?: GhUser;
  repository?: GhRepo;
  installation?: {
    id: number;
    account?: { login: string; type?: string };
    suspended_at?: string | null;
  };
  repositories?: { full_name: string }[];
  repositories_added?: { full_name: string }[];
  repositories_removed?: { full_name: string }[];
  // push
  ref?: string;
  ref_type?: string;
  head_commit?: {
    id: string;
    message: string;
    timestamp: string;
    author?: { username?: string; name?: string };
  } | null;
  commits?: {
    id: string;
    message: string;
    timestamp: string;
    author?: { username?: string; name?: string };
  }[];
  // pull_request / review
  pull_request?: GhPull;
  review?: { user: GhUser; state: string; submitted_at?: string; body?: string | null };
  // CI
  check_suite?: GhRun;
  check_run?: GhRun;
  workflow_run?: GhRun;
  // alerts
  alert?: {
    number: number;
    state?: string;
    html_url?: string;
    secret_type_display_name?: string;
    secret_type?: string;
    rule?: {
      id?: string;
      name?: string;
      description?: string;
      severity?: string;
      security_severity_level?: string;
    };
    most_recent_instance?: { location?: { path?: string; start_line?: number } };
    security_advisory?: {
      summary?: string;
      description?: string;
      severity?: string;
      cve_id?: string | null;
    };
    security_vulnerability?: {
      package?: { name?: string };
      first_patched_version?: { identifier?: string } | null;
    };
    dependency?: { manifest_path?: string; package?: { name?: string } };
    dismissed_reason?: string | null;
  };
}

export interface WebhookResult {
  ok: true;
  delivery: string;
  event: string;
  action?: string;
  handled: boolean;
  note?: string;
  linkedTask?: string;
}

// ── Verification ────────────────────────────────────────────────────────────

export function signBody(secret: string, raw: Buffer | string): string {
  return `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
}

export function verifySignature(secret: string, raw: Buffer, header: string | undefined): boolean {
  if (!header || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  return safeEqual(signBody(secret, raw), header.toLowerCase());
}

function pruneDeliveries() {
  if (ghDeliveries.size < DELIVERY_MAX && Math.random() > 0.05) return;
  const cutoff = Date.now() - DELIVERY_TTL_MS;
  for (const [id, d] of ghDeliveries)
    if (new Date(d.at).getTime() < cutoff) ghDeliveries.delete(id);
  // Still over budget (a flood within the TTL): drop the oldest.
  if (ghDeliveries.size >= DELIVERY_MAX) {
    const oldest = [...ghDeliveries.values()].sort((a, b) => a.at.localeCompare(b.at));
    for (const d of oldest.slice(0, ghDeliveries.size - DELIVERY_MAX + 1))
      ghDeliveries.delete(d.id);
  }
}

/** Verifies and applies a webhook. Throws HttpError 400/401/409/503 per the contract. */
export async function receiveWebhook(input: {
  rawBody?: Buffer;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  requestId: string;
}): Promise<WebhookResult> {
  const secret = githubEnv().webhookSecret;
  if (!secret)
    throw new HttpError(503, 'integration_unconfigured', 'GITHUB_WEBHOOK_SECRET is not set');
  const header = (k: string) => {
    const v = input.headers[k];
    return Array.isArray(v) ? v[0] : v;
  };
  if (!input.rawBody || !input.rawBody.length)
    throw new HttpError(400, 'empty_body', 'Webhook body is empty');
  if (!verifySignature(secret, input.rawBody, header('x-hub-signature-256')))
    throw new HttpError(401, 'invalid_signature', 'Webhook signature does not match');
  const delivery = header('x-github-delivery');
  const event = header('x-github-event');
  if (
    !delivery ||
    !/^[A-Za-z0-9-]{1,64}$/.test(delivery) ||
    !event ||
    !/^[a-z_]{1,64}$/.test(event)
  )
    throw new HttpError(400, 'bad_headers', 'X-GitHub-Delivery and X-GitHub-Event are required');
  if (ghDeliveries.has(delivery))
    throw new HttpError(409, 'replayed_delivery', 'This delivery was already processed');

  const payload = (input.body ?? {}) as GhPayload;
  if (typeof payload !== 'object' || Array.isArray(payload))
    throw new HttpError(400, 'invalid_payload', 'Webhook payload must be a JSON object');

  // Record the delivery id before applying so a concurrent retry is also rejected.
  pruneDeliveries();
  ghDeliveries.set(delivery, {
    id: delivery,
    event,
    action: payload.action,
    at: new Date().toISOString(),
    handled: false,
  });

  const actor = `github:${payload.sender?.login ?? 'app'}`;
  let outcome: Outcome;
  try {
    outcome = await apply(event, payload, actor, input.requestId);
  } catch (e) {
    // A malformed payload must not burn the delivery id: GitHub's "Redeliver" should still work.
    ghDeliveries.delete(delivery);
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'invalid_payload', `Could not apply ${event} payload`);
  }
  const row = ghDeliveries.get(delivery);
  if (row) {
    row.handled = outcome.handled;
    row.note = outcome.note;
    ghDeliveries.save(delivery);
  }
  if (outcome.handled) {
    audit.append({
      actor,
      action: `github.${event}${payload.action ? `.${payload.action}` : ''}`,
      target: `${payload.repository?.full_name ?? payload.installation?.account?.login ?? 'app'} · ${outcome.note ?? delivery}`,
      requestId: input.requestId,
    });
    publish('github', {
      event,
      action: payload.action,
      delivery,
      repo: payload.repository?.full_name,
    });
  }
  return { ok: true, delivery, event, action: payload.action, ...outcome };
}

// ── Event application ───────────────────────────────────────────────────────

type Outcome = { handled: boolean; note?: string; linkedTask?: string };

async function apply(
  event: string,
  p: GhPayload,
  actor: string,
  requestId: string,
): Promise<Outcome> {
  switch (event) {
    case 'ping':
      return { handled: false, note: 'pong' };
    case 'installation':
    case 'installation_repositories':
      return onInstallation(event, p);
    case 'push':
      return withRepo(p, (repo) => onPush(repo, p));
    case 'pull_request':
      return withRepo(p, (repo) => onPullRequest(repo, p, actor, requestId));
    case 'pull_request_review':
      return withRepo(p, (repo) => onReview(repo, p));
    case 'check_suite':
      return withRepo(p, (repo) => onRun(repo, 'check_suite', p.check_suite));
    case 'check_run':
      return withRepo(p, (repo) => onRun(repo, 'check_run', p.check_run));
    case 'workflow_run':
      return withRepo(p, (repo) => onRun(repo, 'workflow_run', p.workflow_run));
    case 'secret_scanning_alert':
    case 'dependabot_alert':
    case 'code_scanning_alert':
      return withRepo(p, (repo) => onAlert(repo, event, p));
    default:
      return { handled: false, note: `event ${event} not used` };
  }
}

const productAliases: [RegExp, ProductId][] = [
  [/^renewberry\b|\/renewberry/i, 'renewberry'],
  [/^blog\b|\/blog\b/i, 'blog'],
  [/^mirror(-acture)?\b|\/mirror/i, 'mirror'],
];

/** Default product for a repo the App sees for the first time (owner/name prefix). */
export function inferProduct(fullName: string): ProductId | undefined {
  return productAliases.find(([re]) => re.test(fullName))?.[1];
}

function withRepo(
  p: GhPayload,
  fn: (repo: Repo) => Outcome | Promise<Outcome>,
): Outcome | Promise<Outcome> {
  if (!p.repository?.full_name) return { handled: false, note: 'no repository in payload' };
  const repo = ensureRepo(p.repository, p.installation?.id);
  if (!repo)
    return {
      handled: false,
      note: `repository ${p.repository.full_name} is not linked to a product`,
    };
  return fn(repo);
}

/** Finds the linked repo for a payload, auto-linking when the product can be inferred. */
function ensureRepo(gh: GhRepo, installationId?: number): Repo | undefined {
  const now = new Date().toISOString();
  const existing = repos.get(`gh-${gh.id}`) ?? findRepoLive(gh.full_name);
  if (existing) {
    existing.githubId ??= gh.id;
    if (installationId) existing.installationId = installationId;
    if (gh.default_branch) existing.defaultBranch = gh.default_branch;
    if (gh.language) existing.language = gh.language;
    if (gh.html_url) existing.url = gh.html_url;
    existing.updatedAt = now;
    repos.save(existing.id);
    return existing;
  }
  const product = inferProduct(gh.full_name);
  if (!product) return undefined;
  const repo: Repo = {
    id: `gh-${gh.id}`,
    name: gh.full_name,
    product,
    defaultBranch: gh.default_branch ?? 'main',
    language: gh.language ?? 'Unknown',
    private: gh.private ?? true,
    url: gh.html_url,
    githubId: gh.id,
    installationId,
    recentCommits: [],
    weeklyCommits: Array<number>(8).fill(0),
    weeklyAnchor: weekStart(),
    latestTag: '',
    linkedBy: 'github-app',
    linkedAt: now,
    updatedAt: now,
    source: 'github',
  };
  repos.set(repo.id, repo);
  return repo;
}

/** Live (non-demo) repo by full name. */
function findRepoLive(fullName: string): Repo | undefined {
  return findRepo(fullName, (r) => r.source !== 'demo');
}

function onInstallation(event: string, p: GhPayload): Outcome {
  const inst = p.installation;
  if (!inst) return { handled: false, note: 'no installation in payload' };
  const now = new Date().toISOString();
  const row = ghInstallations.get(String(inst.id)) ?? {
    id: inst.id,
    account: inst.account?.login ?? 'unknown',
    accountType: inst.account?.type ?? 'Organization',
    repositories: [],
    suspended: false,
    createdAt: now,
    updatedAt: now,
  };
  const names = new Set(row.repositories);
  if (event === 'installation') {
    if (p.action === 'deleted') {
      row.removedAt = now;
      forgetInstallationToken(inst.id);
    }
    if (p.action === 'suspend') row.suspended = true;
    if (p.action === 'unsuspend') row.suspended = false;
    if (p.action === 'created') for (const r of p.repositories ?? []) names.add(r.full_name);
  } else {
    for (const r of p.repositories_added ?? []) names.add(r.full_name);
    for (const r of p.repositories_removed ?? []) names.delete(r.full_name);
  }
  row.repositories = [...names].sort();
  row.updatedAt = now;
  ghInstallations.set(String(inst.id), row);
  return {
    handled: true,
    note: `installation ${inst.id} ${p.action ?? ''} · ${row.repositories.length} repos`,
  };
}

function commitOf(c: NonNullable<GhPayload['head_commit']>): CommitSummary {
  const login = c.author?.username;
  return {
    sha: c.id.slice(0, 7),
    message: c.message.split('\n')[0].slice(0, 200),
    author: memberForLogin(login) ?? login ?? c.author?.name ?? 'unknown',
    at: c.timestamp,
  };
}

function onPush(repo: Repo, p: GhPayload): Outcome {
  const ref = p.ref ?? '';
  if (ref.startsWith('refs/tags/')) {
    repo.latestTag = ref.slice('refs/tags/'.length);
    repo.updatedAt = new Date().toISOString();
    repos.save(repo.id);
    return { handled: true, note: `tag ${repo.latestTag}` };
  }
  if (ref !== `refs/heads/${repo.defaultBranch}`)
    return { handled: false, note: `push to ${ref} ignored` };
  const commits = (p.commits ?? []).map(commitOf);
  if (p.head_commit) repo.lastCommit = commitOf(p.head_commit);
  repo.recentCommits = [...commits.reverse(), ...repo.recentCommits].slice(0, 20);
  bumpWeekly(repo, commits.length);
  repo.updatedAt = new Date().toISOString();
  repos.save(repo.id);
  return { handled: true, note: `${commits.length} commit(s) to ${repo.defaultBranch}` };
}

/** Review state from the latest review per reviewer (GitHub semantics). */
export function deriveReview(pr: Pick<PullRequestRow, 'state' | 'reviews'>): ReviewState {
  if (pr.state === 'merged') return 'merged';
  const latest = new Map<string, PullReview['state']>();
  for (const r of pr.reviews) if (r.state !== 'commented') latest.set(r.by, r.state);
  const states = [...latest.values()];
  if (states.includes('changes_requested')) return 'changes-requested';
  if (states.includes('approved')) return 'approved';
  return 'review-required';
}

/** CI status for a commit from its runs: failing beats running beats passing. */
export function ciForSha(repoId: string, sha: string): CiStatus {
  const runs = [...ciRuns.values()].filter((r) => r.repoId === repoId && r.sha === sha);
  if (!runs.length) return 'none';
  if (runs.some((r) => r.ci === 'failing')) return 'failing';
  if (runs.some((r) => r.ci === 'running')) return 'running';
  return 'passing';
}

async function onPullRequest(
  repo: Repo,
  p: GhPayload,
  actor: string,
  requestId: string,
): Promise<Outcome> {
  const gh = p.pull_request;
  if (!gh) return { handled: false, note: 'no pull_request in payload' };
  const id = `${repo.id}#${gh.number}`;
  const prev = pulls.get(id);
  const state: PullRequestRow['state'] = gh.merged || gh.merged_at ? 'merged' : gh.state;
  const authorLogin = gh.user.login;
  const pr: PullRequestRow = {
    id,
    repoId: repo.id,
    repo: repo.name,
    product: repo.product,
    number: gh.number,
    title: gh.title.slice(0, 300),
    branch: gh.head.ref,
    base: gh.base.ref,
    headSha: gh.head.sha,
    taskKey: prev?.taskKey,
    author: memberForLogin(authorLogin) ?? authorLogin,
    authorLogin,
    reviewers: [
      ...new Set([
        ...(prev?.reviewers ?? []),
        ...(gh.requested_reviewers ?? []).map((u) => memberForLogin(u.login) ?? u.login),
      ]),
    ],
    reviews: prev?.reviews ?? [],
    ci: ciForSha(repo.id, gh.head.sha),
    review: 'review-required',
    state,
    draft: !!gh.draft,
    additions: gh.additions ?? prev?.additions ?? 0,
    deletions: gh.deletions ?? prev?.deletions ?? 0,
    url: gh.html_url,
    createdAt: gh.created_at,
    updatedAt: gh.updated_at,
    mergedAt: gh.merged_at ?? undefined,
    source: 'github',
  };
  pr.review = deriveReview(pr);
  const linkedTask = await linkPullToTask(pr, memberForLogin(authorLogin) ?? actor, requestId);
  pulls.set(id, pr);
  publish('pull_request', {
    id,
    repo: repo.name,
    number: pr.number,
    state: pr.state,
    product: repo.product,
  });
  return {
    handled: true,
    note: `PR #${pr.number} ${p.action ?? ''}${linkedTask ? ` · linked ${linkedTask}` : ''}`,
    ...(linkedTask ? { linkedTask } : {}),
  };
}

function onReview(repo: Repo, p: GhPayload): Outcome {
  const gh = p.pull_request;
  const review = p.review;
  if (!gh || !review) return { handled: false, note: 'no review in payload' };
  const pr = pulls.get(`${repo.id}#${gh.number}`);
  if (!pr) return { handled: false, note: `PR #${gh.number} not tracked yet` };
  const state = review.state.toLowerCase();
  const mapped: PullReview['state'] =
    p.action === 'dismissed' || state === 'dismissed'
      ? 'dismissed'
      : state === 'approved'
        ? 'approved'
        : state === 'changes_requested'
          ? 'changes_requested'
          : 'commented';
  const by = memberForLogin(review.user.login) ?? review.user.login;
  pr.reviews.push({ by, state: mapped, at: review.submitted_at ?? new Date().toISOString() });
  if (!pr.reviewers.includes(by)) pr.reviewers.push(by);
  pr.review = deriveReview(pr);
  pr.updatedAt = new Date().toISOString();
  pulls.save(pr.id);
  publish('pull_request', { id: pr.id, review: pr.review });
  return { handled: true, note: `PR #${pr.number} review ${mapped} by ${by}` };
}

function ciStatus(status: string, conclusion: string | null): CiStatus {
  if (status !== 'completed') return 'running';
  if (conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped')
    return 'passing';
  return 'failing';
}

function onRun(repo: Repo, kind: CiRun['kind'], run: GhRun | undefined): Outcome {
  if (!run) return { handled: false, note: `no ${kind} in payload` };
  const prefix = kind === 'workflow_run' ? 'wr' : kind === 'check_suite' ? 'cs' : 'cr';
  const id = `gh-${prefix}-${run.id}`;
  const started =
    run.run_started_at ?? run.started_at ?? run.created_at ?? new Date().toISOString();
  const status: CiRun['status'] =
    run.status === 'completed'
      ? 'completed'
      : run.status === 'queued' ||
          run.status === 'requested' ||
          run.status === 'waiting' ||
          run.status === 'pending'
        ? 'queued'
        : 'in_progress';
  const completedAt =
    run.status === 'completed'
      ? (run.completed_at ?? run.updated_at ?? new Date().toISOString())
      : undefined;
  const row: CiRun = {
    id,
    repoId: repo.id,
    repo: repo.name,
    product: repo.product,
    kind,
    name: (run.name ?? run.app?.name ?? kind).slice(0, 120),
    branch: run.head_branch ?? run.check_suite?.head_branch ?? '',
    sha: run.head_sha,
    event: run.event ?? kind,
    status,
    conclusion: run.conclusion,
    ci: ciStatus(run.status, run.conclusion),
    prNumbers: (run.pull_requests ?? run.check_suite?.pull_requests ?? []).map((x) => x.number),
    url: run.html_url,
    startedAt: started,
    ...(completedAt
      ? {
          completedAt,
          durationSec: Math.max(
            0,
            Math.round((new Date(completedAt).getTime() - new Date(started).getTime()) / 1000),
          ),
        }
      : {}),
    source: 'github',
  };
  ciRuns.set(id, row);
  // Refresh CI status on every tracked PR whose head is this commit.
  for (const pr of pulls.values())
    if (pr.repoId === repo.id && pr.headSha === run.head_sha) {
      pr.ci = ciForSha(repo.id, pr.headSha);
      pulls.save(pr.id);
    }
  publish('ci', { id, repo: repo.name, status: row.status, ci: row.ci, product: repo.product });
  return {
    handled: true,
    note: `${kind} ${row.name} ${row.status}${row.conclusion ? `/${row.conclusion}` : ''}`,
  };
}

const sevMap: Record<string, FindingInput['severity']> = {
  critical: 'critical',
  high: 'high',
  error: 'high',
  medium: 'medium',
  moderate: 'medium',
  warning: 'medium',
  low: 'low',
  note: 'low',
};

function onAlert(repo: Repo, event: string, p: GhPayload): Outcome {
  const a = p.alert;
  if (!a) return { handled: false, note: 'no alert in payload' };
  const state = (a.state ?? 'open').toLowerCase();
  const status: FindingInput['status'] =
    state === 'fixed' || state === 'resolved'
      ? 'fixed'
      : state === 'dismissed' || state === 'auto_dismissed'
        ? 'dismissed'
        : 'open';
  let input: FindingInput;
  if (event === 'secret_scanning_alert') {
    input = {
      kind: 'secret',
      severity: 'high',
      title: `${a.secret_type_display_name ?? a.secret_type ?? 'Secret'} detected`,
      location: `alert #${a.number}`,
      detail: 'A secret was pushed. Treat it as compromised even if it was removed later.',
      fix: 'Rotate the credential, then purge it from history',
      ruleId: `secret:${a.secret_type ?? 'unknown'}`,
    };
  } else if (event === 'dependabot_alert') {
    const pkg =
      a.security_vulnerability?.package?.name ?? a.dependency?.package?.name ?? 'dependency';
    const patched = a.security_vulnerability?.first_patched_version?.identifier;
    input = {
      kind: 'dependency',
      severity: sevMap[(a.security_advisory?.severity ?? 'medium').toLowerCase()] ?? 'medium',
      title: a.security_advisory?.summary ?? `Vulnerable ${pkg}`,
      location: `${a.dependency?.manifest_path ?? 'manifest'} · ${pkg}`,
      detail: (a.security_advisory?.description ?? '').slice(0, 2000),
      fix: patched ? `Upgrade ${pkg} to ${patched}` : `No patched version of ${pkg} yet`,
      cve: a.security_advisory?.cve_id ?? undefined,
      ruleId: `dependabot:${a.number}`,
    };
  } else {
    const loc = a.most_recent_instance?.location;
    input = {
      kind: 'code',
      severity:
        sevMap[(a.rule?.security_severity_level ?? a.rule?.severity ?? 'medium').toLowerCase()] ??
        'medium',
      title: a.rule?.description ?? a.rule?.name ?? `Code scanning alert #${a.number}`,
      location: loc?.path
        ? `${loc.path}${loc.start_line ? `:${loc.start_line}` : ''}`
        : `alert #${a.number}`,
      detail: a.rule?.description ?? '',
      fix: '',
      ruleId: `codeql:${a.rule?.id ?? a.number}`,
    };
  }
  input.status = status;
  if (status === 'dismissed' && a.dismissed_reason) input.dismissReason = a.dismissed_reason;
  const { row, created } = upsertFinding(repo, input, 'github');
  publish('code_finding', {
    id: row.id,
    repo: repo.name,
    severity: row.severity,
    status: row.status,
  });
  return {
    handled: true,
    note: `${row.id} ${created ? 'created' : 'updated'} (${row.kind}, ${row.status})`,
  };
}
