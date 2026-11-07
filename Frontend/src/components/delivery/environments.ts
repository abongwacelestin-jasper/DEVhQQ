import type { DeploymentRow } from '../../hooks/useDeployments';
import type { EnvironmentLane, LaneStatus } from '../../types/operations';
import type { ProductId } from '../../types/portfolio';

/**
 * Environment lanes derived from real deployment records.
 *
 * The API records `staging` and `production` deployments only, so those are
 * the lanes shown — no development/preview lanes are invented. Each lane shows
 * the newest deployment for that product+env. URLs aren't recorded, so the
 * lane shows the CI/CD provider instead.
 */
const ENV_ORDER = ['staging', 'production'] as const;

function laneStatus(d: DeploymentRow): LaneStatus {
  switch (d.status) {
    case 'failed':
      return 'failed';
    case 'awaiting-approval':
    case 'running':
      return 'pending';
    case 'rolled-back':
      return 'degraded';
    default:
      return 'healthy';
  }
}

export function lanesFromDeployments(rows: DeploymentRow[], product: ProductId): EnvironmentLane[] {
  const lanes: EnvironmentLane[] = [];
  for (const env of ENV_ORDER) {
    const latest = rows
      .filter((d) => d.product === product && d.env === env)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!latest) continue;
    lanes.push({
      product,
      env,
      sha: latest.sha,
      version: latest.version,
      status: laneStatus(latest),
      ago: latest.ago,
      url: '',
      provider: latest.provider,
    });
  }
  return lanes;
}

/** Deployments per day for the last `days` days ending at the newest record (or today). */
export function frequencyByDay(rows: DeploymentRow[], days = 14, end = new Date()) {
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const buckets: { day: string; date: Date; total: number; failed: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    buckets.push({ day: dayKey(d), date: d, total: 0, failed: 0 });
  }
  const index = new Map(buckets.map((b, i) => [b.day, i]));
  for (const r of rows) {
    const i = index.get(dayKey(new Date(r.createdAt)));
    if (i === undefined) continue;
    buckets[i].total += 1;
    if (r.status === 'failed' || r.status === 'rolled-back') buckets[i].failed += 1;
  }
  return buckets;
}
