/**
 * Engineering collections (persistence seam, WAVE4 §3) and small shared helpers.
 *
 * Every collection name is prefixed `eng_` so it can never collide with
 * another lane's. In-place mutations are always followed by `.save(key)`.
 */

import { createCollection } from '../../store/collection.ts';
import { db } from '../../store/db.ts';
import { repos as data } from '../../data/index.ts';
import { canSeeProduct } from '../../auth/rbac.ts';
import { HttpError, type Principal, type ProductId } from '../../types.ts';
import type {
  CiRun,
  CodeFinding,
  GithubDelivery,
  GithubInstallation,
  IntegrationRow,
  MonitorHistory,
  MonitorRow,
  OutboundWebhook,
  PullRequestRow,
  Repo,
  WebhookDeliveryRow,
} from './types.ts';

export const repos = createCollection<Repo>('eng_repos');
export const pulls = createCollection<PullRequestRow>('eng_pulls');
export const ciRuns = createCollection<CiRun>('eng_ci_runs');
export const findings = createCollection<CodeFinding>('eng_code_findings');
export const ghInstallations = createCollection<GithubInstallation>('eng_gh_installations');
export const ghDeliveries = createCollection<GithubDelivery>('eng_gh_deliveries');
/** GitHub login (lower-case) → member id. */
export const ghIdentities = createCollection<{ login: string; memberId: string }>(
  'eng_gh_identities',
);
export const monitors = createCollection<MonitorRow>('eng_monitors');
export const monitorHistory = createCollection<MonitorHistory>('eng_monitor_history');
export const integrations = createCollection<IntegrationRow>('eng_integrations');
export const outboundWebhooks = createCollection<OutboundWebhook>('eng_outbound_webhooks');
export const webhookDeliveries = createCollection<WebhookDeliveryRow>('eng_webhook_deliveries');

export const PRODUCTS = ['renewberry', 'blog', 'mirror'] as const satisfies readonly ProductId[];

/** "3h", "2d", "12m", "now" — the compact relative age the mocks display. */
export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** Offset cursor pagination: `{items, nextCursor?}` (WAVE4 §6 list shape). */
export function paginate<T>(
  rows: T[],
  query: URLSearchParams,
  def = 100,
): { items: T[]; nextCursor?: string } {
  const limit = Math.min(200, Math.max(1, Number.parseInt(query.get('limit') ?? '', 10) || def));
  const offset = Math.max(0, Number.parseInt(query.get('cursor') ?? '', 10) || 0);
  const items = rows.slice(offset, offset + limit);
  return offset + limit < rows.length ? { items, nextCursor: String(offset + limit) } : { items };
}

/** Finds a repo by id or by `owner/name` (case-insensitive). */
export function findRepo(
  idOrName: string,
  include: (r: Repo) => boolean = () => true,
): Repo | undefined {
  const direct = repos.get(idOrName);
  if (direct && include(direct)) return direct;
  const n = idOrName.toLowerCase();
  for (const r of repos.values()) if (r.name.toLowerCase() === n && include(r)) return r;
  return undefined;
}

/** Resolves a repo the caller may see, or throws 404 (never 403 — existence stays hidden). */
export function visibleRepo(p: Principal, idOrName: string, include: (r: Repo) => boolean): Repo {
  const r = findRepo(idOrName, include);
  if (!r || !canSeeProduct(p, r.product)) throw new HttpError(404, 'not_found', 'Not found');
  return r;
}

/** Maps a GitHub login to a TavetaHQ member id when one is known. */
export function memberForLogin(login: string | undefined): string | undefined {
  if (!login) return undefined;
  return ghIdentities.get(login.toLowerCase())?.memberId;
}

/** The Operations member responsible for a product (incident owner for automated incidents). */
export async function operationsOwner(product: ProductId): Promise<string> {
  const active = await data.members.list({ status: 'active' });
  return (
    active.find((m) => m.role === 'Operations' && m.products.includes(product))?.id ??
    active.find((m) => m.role === 'Owner')?.id ??
    'system'
  );
}

/** Next `INC-n` id, computed the same way as routes/operations.routes.ts. */
export function nextIncidentId(): string {
  const n =
    [...db.incidents.keys()]
      .map((k) => Number(k.split('-')[1]))
      .filter((x) => Number.isFinite(x))
      .reduce((a, b) => Math.max(a, b), 0) + 1;
  return `INC-${n}`;
}

/** Monday 00:00 UTC of the week containing `d`, as an ISO date. */
export function weekStart(d = new Date()): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x.toISOString().slice(0, 10);
}

/** Shifts `weeklyCommits` so the last bucket is the current week, then adds `n`. */
export function bumpWeekly(repo: Repo, n: number, at = new Date()) {
  const current = weekStart(at);
  const weeks = Math.round(
    (new Date(current).getTime() - new Date(repo.weeklyAnchor).getTime()) / (7 * 86_400_000),
  );
  if (weeks > 0) {
    const shift = Math.min(weeks, 8);
    repo.weeklyCommits = [...repo.weeklyCommits.slice(shift), ...Array<number>(shift).fill(0)];
    repo.weeklyAnchor = current;
  }
  if (weeks >= 0) repo.weeklyCommits[7] += n;
}
